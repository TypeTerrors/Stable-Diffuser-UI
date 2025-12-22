import io
import inspect
import json
import os
from pathlib import Path
from typing import Any

import torch
from diffusers import DiffusionPipeline, StableDiffusionXLPipeline

class SDXLModel:
    def __init__(self, model_path: str, device: str = "cuda"):
        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(path)

        self._model_path = path
        self._device = device
        self._model_index = self._read_model_index(path)
        self._pipeline_class_name = (
            (self._model_index or {}).get("_class_name") if self._model_index else None
        )

        self.pipe = self._load_pipeline(path, device=device)

        is_zimage = self._pipeline_class_name == "ZImagePipeline"
        self._default_steps = 9 if is_zimage else 30
        self._default_guidance = 0.0 if is_zimage else 7.0
        self._default_filename = "z-image.png" if is_zimage else "sdxl.png"

    @staticmethod
    def _read_model_index(path: Path) -> dict[str, Any] | None:
        if not path.is_dir():
            return None
        index_path = path / "model_index.json"
        if not index_path.exists():
            return None
        return json.loads(index_path.read_text(encoding="utf-8"))

    @staticmethod
    def _parse_dtype(value: str | None) -> torch.dtype | None:
        if not value:
            return None
        normalized = value.strip().lower()
        if normalized in {"fp16", "float16"}:
            return torch.float16
        if normalized in {"bf16", "bfloat16"}:
            return torch.bfloat16
        if normalized in {"fp32", "float32"}:
            return torch.float32
        raise ValueError(f"Unsupported MODEL_DTYPE={value!r} (use fp16|bf16|fp32)")

    @classmethod
    def _load_pipeline(cls, path: Path, device: str):
        if path.is_file():
            return StableDiffusionXLPipeline.from_single_file(
                path,
                torch_dtype=torch.float16,
            ).to(device)

        dtype = cls._parse_dtype(os.getenv("MODEL_DTYPE"))
        model_index = cls._read_model_index(path)
        pipeline_class_name = (model_index or {}).get("_class_name")

        if dtype is None:
            dtype = torch.bfloat16 if pipeline_class_name == "ZImagePipeline" else torch.float16

        kwargs: dict[str, Any] = {
            "torch_dtype": dtype,
            "local_files_only": True,
        }

        # Z-Image recommends disabling low_cpu_mem_usage.
        if pipeline_class_name == "ZImagePipeline":
            kwargs["low_cpu_mem_usage"] = False

        try:
            return DiffusionPipeline.from_pretrained(path, **kwargs).to(device)
        except Exception as exc:  # pragma: no cover
            if pipeline_class_name == "ZImagePipeline":
                raise RuntimeError(
                    "Failed to load Z-Image from the local model directory. "
                    "Per the model README, you may need a newer diffusers build "
                    "(e.g. `pip install git+https://github.com/huggingface/diffusers`)."
                ) from exc
            raise

    @staticmethod
    def _filter_call_kwargs(fn: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            return kwargs

        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            return kwargs

        allowed = set(sig.parameters.keys())
        return {k: v for k, v in kwargs.items() if k in allowed}

    @staticmethod
    def _get_env_int(name: str, default: int) -> int:
        value = os.getenv(name)
        return default if value is None else int(value)

    @staticmethod
    def _get_env_float(name: str, default: float) -> float:
        value = os.getenv(name)
        return default if value is None else float(value)

    def generate_image(self, positive_prompt: str, negative_prompt: str):
        height = self._get_env_int("MODEL_HEIGHT", 1024)
        width = self._get_env_int("MODEL_WIDTH", 1024)
        steps = self._get_env_int("MODEL_NUM_INFERENCE_STEPS", self._default_steps)
        guidance = self._get_env_float("MODEL_GUIDANCE_SCALE", self._default_guidance)

        call_kwargs: dict[str, Any] = {
            "height": height,
            "width": width,
            "prompt": positive_prompt,
            "negative_prompt": negative_prompt,
            "num_inference_steps": steps,
            "guidance_scale": guidance,
        }
        call_kwargs = self._filter_call_kwargs(self.pipe.__call__, call_kwargs)

        image = self.pipe(**call_kwargs).images[0]

        buf = io.BytesIO()
        image.save(buf, format="png")
        return buf.getvalue(), "image/png", self._default_filename
