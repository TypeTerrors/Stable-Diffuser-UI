import inspect
import io
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Any

import numpy as np
import torch
from diffusers import WanImageToVideoPipeline
from PIL import Image

logger = logging.getLogger(__name__)

class ImageToVideoModel:
    def __init__(self, model_path: str, device: str = "cuda"):
        self._path = Path(model_path)
        self.pipe = self._load_pipeline(self._path, device=device)

        self._load_loras()

        self._num_frames = int(os.getenv("I2V_NUM_FRAMES", "25") or "25")
        self._fps = int(os.getenv("I2V_FPS", "6") or "6")
        self._steps = int(os.getenv("I2V_NUM_INFERENCE_STEPS", "25") or "25")
        self._guidance = float(os.getenv("I2V_GUIDANCE_SCALE", "1.5") or "1.5")

    @classmethod
    def _load_pipeline(cls, path: Path, device: str):
        if not path.exists():
            raise FileNotFoundError(path)
        if path.is_file():
            raise ValueError(
                f"Image-to-video models are expected to be a directory (got file: {path})."
            )

        return WanImageToVideoPipeline.from_pretrained(
            str(path),
            torch_dtype=torch.float16,
            local_files_only=True,
        ).to(device)

    def _load_loras(self) -> None:
        # You can keep this separate from txt2img by using I2V_* env vars.
        specs = (os.getenv("I2V_LORAS") or "").strip()
        single = (os.getenv("I2V_LORA_PATH") or "").strip()
        if not specs and not single:
            return
        if single and not specs:
            specs = single

        if not hasattr(self.pipe, "load_lora_weights"):
            logger.warning(
                "I2V LoRA requested but this pipeline does not support `load_lora_weights()`; skipping."
            )
            return

        adapter_names: list[str] = []
        adapter_scales: list[float] = []

        for idx, raw in enumerate([s.strip() for s in specs.split(",") if s.strip()]):
            if "@" in raw:
                raw_path, raw_scale = raw.rsplit("@", 1)
                scale = float(raw_scale)
            else:
                raw_path = raw
                scale = float(os.getenv("I2V_LORA_SCALE", "1.0"))

            lora_path = Path(raw_path)
            if lora_path.suffix != ".safetensors":
                raise ValueError(f"LoRA must be a .safetensors file: {raw_path}")
            if not lora_path.exists():
                logger.warning("I2V LoRA not found at %s; skipping.", lora_path)
                continue

            name = f"i2v_lora_{idx}_{lora_path.stem}"
            try:
                self.pipe.load_lora_weights(
                    str(lora_path.parent),
                    weight_name=lora_path.name,
                    adapter_name=name,
                )
            except Exception:
                logger.exception("Failed to load I2V LoRA %s; skipping.", lora_path)
                continue
            adapter_names.append(name)
            adapter_scales.append(scale)

        if not adapter_names:
            logger.warning("No I2V LoRAs were loaded (check I2V_LORA_PATH/I2V_LORAS).")
            return

        if hasattr(self.pipe, "set_adapters"):
            self.pipe.set_adapters(adapter_names, adapter_weights=adapter_scales)

        logger.info("Loaded %d i2v LoRA(s): %s", len(adapter_names), ", ".join(adapter_names))

    def generate_video(
        self, image_bytes: bytes, positive_prompt: str, negative_prompt: str
    ) -> tuple[bytes, str, str]:
        image = bytes_to_pil_image(image_bytes)

        signature = inspect.signature(self.pipe.__call__)
        call_kwargs: dict[str, Any] = {
            "image": image,
            "num_frames": self._num_frames,
            "num_inference_steps": self._steps,
        }
        if "max_guidance_scale" in signature.parameters:
            call_kwargs["max_guidance_scale"] = self._guidance
        elif "guidance_scale" in signature.parameters:
            call_kwargs["guidance_scale"] = self._guidance

        if "prompt" in signature.parameters and positive_prompt:
            call_kwargs["prompt"] = positive_prompt
        if "negative_prompt" in signature.parameters and negative_prompt:
            call_kwargs["negative_prompt"] = negative_prompt

        result = self.pipe(**call_kwargs)
        frames = getattr(result, "frames", None)
        if frames is None:
            raise RuntimeError("Pipeline output did not include `frames`")

        frames_pil = normalize_frames_to_pil(frames)
        mp4 = frames_to_mp4_bytes(frames_pil, fps=self._fps)
        file_id = secrets.token_hex(4)
        return mp4, "video/mp4", f"{file_id}.mp4"


def bytes_to_pil_image(image_bytes: bytes) -> Image.Image:
    if not image_bytes:
        raise ValueError("empty image bytes")
    image = Image.open(io.BytesIO(image_bytes))
    image.load()
    return image.convert("RGB")


def normalize_frames_to_pil(frames: Any) -> list[Image.Image]:
    if isinstance(frames, list) and frames and isinstance(frames[0], list):
        frames = frames[0]

    def _float_to_uint8(a: np.ndarray) -> np.ndarray:
        if a.dtype == np.uint8:
            return a
        af = a.astype(np.float32)
        max_v = float(np.max(af))
        min_v = float(np.min(af))
        if max_v <= 1.0 and min_v >= 0.0:
            af = af * 255.0
        elif max_v <= 1.0 and min_v < 0.0:
            # Common normalized range for images: [-1, 1]
            af = (af + 1.0) * 127.5
        af = np.clip(af, 0.0, 255.0)
        return af.astype(np.uint8)

    def _ndarray_to_pil(a: np.ndarray) -> list[Image.Image]:
        if a.ndim == 5 and a.shape[0] == 1:
            a = a[0]
        if a.ndim == 4:
            # T,H,W,C or T,C,H,W
            if a.shape[-1] in (1, 3, 4):
                frames_thwc = a
            elif a.shape[1] in (1, 3, 4):
                frames_thwc = np.transpose(a, (0, 2, 3, 1))
            else:
                raise TypeError(f"Unexpected ndarray shape: {tuple(a.shape)}")
            frames_thwc = _float_to_uint8(frames_thwc)
            return [Image.fromarray(frames_thwc[i]).convert("RGB") for i in range(frames_thwc.shape[0])]
        if a.ndim == 3:
            # Single frame H,W,C (or H,W,1)
            frame = _float_to_uint8(a)
            return [Image.fromarray(frame).convert("RGB")]
        raise TypeError(f"Unexpected ndarray shape: {tuple(a.shape)}")

    def _tensor_to_pil(t: torch.Tensor) -> list[Image.Image]:
        t = t.detach().float().cpu()
        if t.ndim == 5 and t.shape[0] == 1:
            t = t[0]
        if t.ndim == 4 and t.shape[-1] in (1, 3, 4):  # T,H,W,C
            pass
        elif t.ndim == 4 and t.shape[1] in (1, 3, 4):  # T,C,H,W
            t = t.permute(0, 2, 3, 1)
        else:
            raise TypeError(f"Unexpected tensor shape: {tuple(t.shape)}")

        if float(t.max()) <= 1.0 and float(t.min()) >= 0.0:
            t = t * 255.0
        elif float(t.max()) <= 1.0 and float(t.min()) < 0.0:
            t = (t + 1.0) * 127.5
        t = t.clamp(0, 255).to(torch.uint8).numpy()
        return [Image.fromarray(t[i]).convert("RGB") for i in range(t.shape[0])]

    if torch.is_tensor(frames):
        return _tensor_to_pil(frames)

    if isinstance(frames, np.ndarray):
        return _ndarray_to_pil(frames)

    if not isinstance(frames, list) or not frames:
        raise TypeError(f"Unexpected frames type: {type(frames)}")

    first = frames[0]
    if isinstance(first, Image.Image):
        return [frame.convert("RGB") for frame in frames]
    if torch.is_tensor(first):
        return _tensor_to_pil(torch.stack(frames))
    if isinstance(first, np.ndarray):
        return _ndarray_to_pil(np.stack(frames))

    raise TypeError(f"Don’t know how to convert frame element type: {type(first)}")



def frames_to_mp4_bytes(frames_pil: list[Image.Image], fps: int) -> bytes:
    try:
        import av  # type: ignore
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "PyAV is required to encode MP4 in-memory. Install `av` (and ensure FFmpeg libs are available)."
        ) from e

    if not frames_pil:
        raise ValueError("no frames to encode")

    buffer = io.BytesIO()
    container = av.open(buffer, mode="w", format="mp4")
    stream = container.add_stream("h264", rate=fps)
    stream.pix_fmt = "yuv420p"

    width, height = frames_pil[0].size
    stream.width = width
    stream.height = height

    for frame_pil in frames_pil:
        rgb = np.asarray(frame_pil.convert("RGB"))
        frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
        for packet in stream.encode(frame):
            container.mux(packet)

    for packet in stream.encode():
        container.mux(packet)

    container.close()
    return buffer.getvalue()
