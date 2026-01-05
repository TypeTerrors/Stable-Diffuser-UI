# perf_metrics_service.py
from __future__ import annotations

import os
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional

import torch


_MB = 1024 * 1024


class PerfMetricsService:
    """
    Lightweight measurement/logging helper for GPU inference.

    Measures per-scope:
        - wall_ms (host time)
        - gpu_ms (CUDA event elapsed time) when CUDA available
        - peak_alloc_mb / peak_reserved_mb (PyTorch CUDA allocator peaks)
        - optional NVML stats before/after: util, power, temp, mem used/total

    Usage:
        perf = PerfMetricsService(logger)
        with perf.scope("generate.pipe", {"req_id": "abc"}):
            ... run pipeline ...
    """

    def __init__(
        self,
        log,
        *,
        enable_nvml: Optional[bool] = None,
        device_index: Optional[int] = None,
    ):
        self.log = log
        self.device_index = device_index

        if enable_nvml is None:
            # Default on; can disable by env var for ultra-low overhead
            enable_nvml = os.getenv("IMG_GEN_LOG_NVML", "1") != "0"

        self._nvml_ok = False
        self._pynvml = None
        self._nvml_handle = None

        if enable_nvml:
            self._try_init_nvml()

    def _try_init_nvml(self) -> None:
        try:
            import pynvml  # provided by nvidia-ml-py

            pynvml.nvmlInit()
            idx = self._resolve_device_index()
            self._nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(idx)
            self._pynvml = pynvml
            self._nvml_ok = True
        except Exception:
            # Don't fail inference if NVML isn't available/allowed in the environment.
            self._nvml_ok = False
            self._pynvml = None
            self._nvml_handle = None

    def _resolve_device_index(self) -> int:
        if self.device_index is not None:
            return int(self.device_index)
        if torch.cuda.is_available():
            return int(torch.cuda.current_device())
        return 0

    def nvml_snapshot(self) -> Dict[str, Any]:
        """One-shot GPU snapshot. Safe to call even if NVML isn't available."""
        if not self._nvml_ok or self._nvml_handle is None or self._pynvml is None:
            return {}

        pynvml = self._pynvml
        h = self._nvml_handle

        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            out: Dict[str, Any] = {
                "gpu_util_pct": int(getattr(util, "gpu", 0)),
                "mem_util_pct": int(getattr(util, "memory", 0)),
                "mem_used_mb": int(mem.used / _MB),
                "mem_total_mb": int(mem.total / _MB),
            }

            # NVML power usage is in milliwatts; convert to watts.
            out["power_w"] = float(pynvml.nvmlDeviceGetPowerUsage(h)) / 1000.0
            out["temp_c"] = int(
                pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
            )
            return out
        except Exception:
            return {}

    def _log_kv(self, prefix: str, payload: Dict[str, Any]) -> None:
        # Stable sort keys for easy diffing in logs.
        parts = [f"{k}={payload[k]}" for k in sorted(payload.keys())]
        self.log.info(f"{prefix} " + " ".join(parts))

    @contextmanager
    def scope(self, name: str, extra: Optional[Dict[str, Any]] = None):
        """
        Context manager to measure + log a code region.
        """
        extra = dict(extra or {})

        if not torch.cuda.is_available():
            t0 = time.monotonic()
            try:
                yield
            finally:
                wall_ms = (time.monotonic() - t0) * 1000.0
                payload = {"scope": name, "wall_ms": round(wall_ms, 2), **extra}
                self._log_kv("perf", payload)
            return

        device = torch.cuda.current_device()
        # Reset peak memory stats so peaks are per-scope.
        torch.cuda.memory.reset_peak_memory_stats(device=device)

        start_evt = torch.cuda.Event(enable_timing=True)
        end_evt = torch.cuda.Event(enable_timing=True)

        # Ensure prior work isn't counted in this scope.
        torch.cuda.synchronize(device=device)

        nvml_before = self.nvml_snapshot()

        t0 = time.monotonic()
        start_evt.record()
        try:
            yield
        finally:
            end_evt.record()
            torch.cuda.synchronize(device=device)

            wall_ms = (time.monotonic() - t0) * 1000.0
            gpu_ms = float(start_evt.elapsed_time(end_evt))

            peak_alloc_mb = torch.cuda.max_memory_allocated(device=device) / _MB
            peak_reserved_mb = torch.cuda.max_memory_reserved(device=device) / _MB

            nvml_after = self.nvml_snapshot()

            payload: Dict[str, Any] = {
                "scope": name,
                "wall_ms": round(wall_ms, 2),
                "gpu_ms": round(gpu_ms, 2),
                "peak_alloc_mb": round(peak_alloc_mb, 1),
                "peak_reserved_mb": round(peak_reserved_mb, 1),
                **extra,
            }

            # Prefix nvml stats so you can compare before/after quickly.
            for k, v in nvml_before.items():
                payload[f"nvml_before_{k}"] = v
            for k, v in nvml_after.items():
                payload[f"nvml_after_{k}"] = v

            self._log_kv("perf", payload)