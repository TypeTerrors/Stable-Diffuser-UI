import asyncio
import inspect
import io
import math
import os
import threading
import time
import tempfile
import uuid
from dataclasses import dataclass
from logging import Logger
from pathlib import Path
from typing import AsyncIterator, Tuple

import grpc
import torch
from diffusers import DiffusionPipeline, StableDiffusionXLPipeline
from diffusers.utils import export_to_video
from PIL import Image
from proto.img_service_pb2 import (
    ClearModelRequest,
    ClearModelResponse,
    ClearLorasRequest,
    ClearLorasResponse,
    GenerateImageRequest,
    GenerateImageResponse,
    GenerateMediaRequest,
    GenerateMediaResponse,
    GetCurrentModelRequest,
    GetCurrentModelResponse,
    GetCurrentLorasRequest,
    GetCurrentLorasResponse,
    SetLlmModelRequest,
    SetLlmModelResponse,
    SetLora,
    SetLoraRequest,
    SetLoraResponse,
    SetModelRequest,
    SetModelResponse,
    ConversationRequest,
    ConversationResponse,
)
from proto.img_service_pb2_grpc import ImageServiceServicer

# vLLM is optional and may be incompatible with the container CUDA runtime.
#
# Example failure: prebuilt vLLM wheels commonly target CUDA 12 and will fail to
# import in CUDA 13 containers with `ImportError: libcudart.so.12: cannot open
# shared object file`.
_VLLM_IMPORT_ERROR: str | None = None
try:
    from vllm.engine.async_llm_engine import AsyncLLMEngine  # type: ignore
    from vllm.sampling_params import SamplingParams  # type: ignore

    # vLLM arg utils import path varies by version; handle both common cases.
    try:
        from vllm.engine.arg_utils import AsyncEngineArgs as EngineArgs  # type: ignore
    except Exception:
        from vllm.engine.arg_utils import EngineArgs  # type: ignore
except Exception as exc:  # pragma: no cover
    AsyncLLMEngine = None  # type: ignore[assignment]
    SamplingParams = None  # type: ignore[assignment]
    EngineArgs = None  # type: ignore[assignment]
    _VLLM_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"

# ---- LLM Config ----
_DEFAULT_LLM_DIR = Path(__file__).resolve().parents[2] / "models" / "llm"
LLM_MODEL_DIR = Path(os.getenv("LLM_MODEL_DIR", str(_DEFAULT_LLM_DIR))).resolve()
LLM_DEFAULT_MODEL = os.getenv("LLM_DEFAULT_MODEL", "").strip()
LLM_DTYPE = os.getenv("LLM_DTYPE", "auto")
LLM_MAX_MODEL_LEN = int(os.getenv("LLM_MAX_MODEL_LEN", "8192"))
LLM_GPU_MEM_UTIL = float(os.getenv("LLM_GPU_MEM_UTIL", "0.90"))
LLM_MAX_NUM_SEQS = int(os.getenv("LLM_MAX_NUM_SEQS", "64"))
LLM_MAX_BATCHED_TOKENS = int(os.getenv("LLM_MAX_BATCHED_TOKENS", "8192"))
LLM_TP_SIZE = int(os.getenv("LLM_TP_SIZE", "1"))

LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "256"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_TOP_P = float(os.getenv("LLM_TOP_P", "0.95"))

LLM_FLUSH_EVERY_MS = int(os.getenv("LLM_FLUSH_EVERY_MS", "25"))
LLM_FLUSH_MAX_CHARS = int(os.getenv("LLM_FLUSH_MAX_CHARS", "512"))

VIDEO_MODEL_HINTS = (
    "video",
    "ltx",
    "ltxv",
    "wan",
    "hunyuan",
    "cogvideo",
    "mochi",
    "zeroscope",
    "animatediff",
    "svd",
)


@dataclass
class StreamBuffer:
    parts: list[str]
    char_count: int
    last_flush_monotonic: float

    @classmethod
    def new(cls) -> "StreamBuffer":
        return cls(parts=[], char_count=0, last_flush_monotonic=time.monotonic())

    def add(self, s: str) -> None:
        if not s:
            return
        self.parts.append(s)
        self.char_count += len(s)

    def has_data(self) -> bool:
        return self.char_count > 0

    def take_all(self) -> str:
        out = "".join(self.parts)
        self.parts.clear()
        self.char_count = 0
        self.last_flush_monotonic = time.monotonic()
        return out


class ImageService(ImageServiceServicer):

    def __init__(self, log: Logger):
        self.log = log
        self._llm_loop = None
        self._llm_loop_thread = None
        self._llm_lock = threading.Lock()
        self.llm = None
        self.llm_model_path = ""
        self.pipe = None
        self.model_path = ""
        self.current_loras = []
        self.model_media_type = ""

    def _execution_device_for_pipe(self) -> torch.device:
        device = getattr(self.pipe, "_execution_device", None)
        if isinstance(device, torch.device):
            return device

        unet = getattr(self.pipe, "unet", None)
        if unet is not None:
            try:
                return next(unet.parameters()).device
            except Exception:
                pass

        return torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _maybe_convert_prompt(self, prompt: str, tokenizer) -> str:
        if prompt is None:
            prompt = ""

        maybe_convert = getattr(self.pipe, "maybe_convert_prompt", None)
        if callable(maybe_convert):
            try:
                return maybe_convert(prompt, tokenizer)
            except Exception:
                self.log.exception("Failed to apply textual-inversion prompt conversion")
        return prompt

    def _chunk_params_for_tokenizer(self, tokenizer) -> tuple[int, int, int | None, int | None, int]:
        max_length = int(getattr(tokenizer, "model_max_length", 77))
        num_special = 2
        num_special_fn = getattr(tokenizer, "num_special_tokens_to_add", None)
        if callable(num_special_fn):
            try:
                num_special = int(num_special_fn(pair=False))
            except Exception:
                pass

        chunk_size = max(1, max_length - max(0, num_special))
        bos_id = getattr(tokenizer, "bos_token_id", None)
        eos_id = getattr(tokenizer, "eos_token_id", None)
        pad_id = getattr(tokenizer, "pad_token_id", None)
        if pad_id is None:
            pad_id = eos_id if eos_id is not None else 0
        return max_length, chunk_size, bos_id, eos_id, int(pad_id)

    def _token_ids_no_special(self, prompt: str, tokenizer) -> list[int]:
        prompt = self._maybe_convert_prompt(prompt, tokenizer)
        input_ids = tokenizer(prompt, add_special_tokens=False, return_tensors="pt").input_ids
        return input_ids[0].tolist()

    def _required_chunks(self, prompt: str, tokenizer) -> int:
        _, chunk_size, _, _, _ = self._chunk_params_for_tokenizer(tokenizer)
        token_ids = self._token_ids_no_special(prompt, tokenizer)
        if not token_ids:
            return 1
        return max(1, int(math.ceil(len(token_ids) / chunk_size)))

    def _pooled_from_text_encoder_output(self, encoder_output) -> torch.Tensor | None:
        for attr in ("text_embeds", "pooler_output"):
            value = getattr(encoder_output, attr, None)
            if isinstance(value, torch.Tensor) and value.ndim == 2:
                return value

        if isinstance(encoder_output, (tuple, list)):
            for value in encoder_output:
                if isinstance(value, torch.Tensor) and value.ndim == 2:
                    return value
        return None

    def _encode_prompt_chunked(
        self,
        prompt: str,
        tokenizer,
        text_encoder,
        *,
        num_chunks: int,
        device: torch.device,
        clip_skip: int | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor | None]:
        token_ids = self._token_ids_no_special(prompt, tokenizer)
        max_length, chunk_size, bos_id, eos_id, pad_id = self._chunk_params_for_tokenizer(tokenizer)

        chunk_prompt_embeds: list[torch.Tensor] = []
        chunk_pooled: list[torch.Tensor] = []

        with torch.inference_mode():
            for chunk_index in range(num_chunks):
                start = chunk_index * chunk_size
                end = start + chunk_size
                chunk_tokens = token_ids[start:end] if start < len(token_ids) else []

                ids: list[int] = []
                if bos_id is not None:
                    ids.append(int(bos_id))
                ids.extend(int(t) for t in chunk_tokens)
                if eos_id is not None:
                    ids.append(int(eos_id))

                if len(ids) > max_length:
                    ids = ids[:max_length]
                if len(ids) < max_length:
                    ids.extend([pad_id] * (max_length - len(ids)))

                input_ids = torch.tensor([ids], dtype=torch.long, device=device)
                output = text_encoder(input_ids, output_hidden_states=True)

                pooled = self._pooled_from_text_encoder_output(output)
                if pooled is not None:
                    chunk_pooled.append(pooled)

                if clip_skip is None:
                    prompt_embeds = output.hidden_states[-2]
                else:
                    prompt_embeds = output.hidden_states[-(clip_skip + 2)]
                chunk_prompt_embeds.append(prompt_embeds)

        prompt_embeds = torch.cat(chunk_prompt_embeds, dim=1)
        pooled_prompt_embeds = None
        if chunk_pooled:
            pooled_prompt_embeds = torch.mean(torch.stack(chunk_pooled, dim=0), dim=0)
        return prompt_embeds, pooled_prompt_embeds

    def _encode_long_prompts_for_sdxl(
        self,
        positive_prompt: str,
        negative_prompt: str | None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        tokenizers = []
        text_encoders = []
        if getattr(self.pipe, "tokenizer", None) is not None and getattr(self.pipe, "text_encoder", None) is not None:
            tokenizers.append(self.pipe.tokenizer)
            text_encoders.append(self.pipe.text_encoder)
        if getattr(self.pipe, "tokenizer_2", None) is not None and getattr(self.pipe, "text_encoder_2", None) is not None:
            tokenizers.append(self.pipe.tokenizer_2)
            text_encoders.append(self.pipe.text_encoder_2)

        if not tokenizers or len(tokenizers) != len(text_encoders):
            raise RuntimeError("Pipeline is missing expected SDXL tokenizers/text encoders")

        device = self._execution_device_for_pipe()
        force_zeros = bool(getattr(getattr(self.pipe, "config", None), "force_zeros_for_empty_prompt", False))
        zero_out_negative = negative_prompt is None and force_zeros

        positive_chunks = max(self._required_chunks(positive_prompt or "", tok) for tok in tokenizers)
        negative_chunks = (
            1
            if zero_out_negative
            else max(self._required_chunks((negative_prompt or ""), tok) for tok in tokenizers)
        )
        num_chunks = max(positive_chunks, negative_chunks)

        max_chunks_env = os.getenv("IMG_GEN_MAX_PROMPT_CHUNKS", "")
        max_chunks = int(max_chunks_env) if max_chunks_env.isdigit() else 16
        if num_chunks > max_chunks:
            self.log.warning(
                f"Prompt requires {num_chunks} chunks; capping to {max_chunks} chunks (set IMG_GEN_MAX_PROMPT_CHUNKS to raise)."
            )
            num_chunks = max_chunks

        clip_skip = getattr(self.pipe, "clip_skip", None)

        positive_embeds_parts: list[torch.Tensor] = []
        pooled_positive = None
        for tokenizer, text_encoder in zip(tokenizers, text_encoders):
            embeds, pooled = self._encode_prompt_chunked(
                positive_prompt or "",
                tokenizer,
                text_encoder,
                num_chunks=num_chunks,
                device=device,
                clip_skip=clip_skip,
            )
            positive_embeds_parts.append(embeds)
            if pooled is not None:
                pooled_positive = pooled

        prompt_embeds = (
            torch.cat(positive_embeds_parts, dim=-1) if len(positive_embeds_parts) > 1 else positive_embeds_parts[0]
        )
        if pooled_positive is None:
            raise RuntimeError("Failed to compute pooled_prompt_embeds for SDXL (expected from text_encoder_2)")

        if zero_out_negative:
            negative_prompt_embeds = torch.zeros_like(prompt_embeds)
            negative_pooled = torch.zeros_like(pooled_positive)
            return prompt_embeds, negative_prompt_embeds, pooled_positive, negative_pooled

        negative_embeds_parts: list[torch.Tensor] = []
        pooled_negative = None
        for tokenizer, text_encoder in zip(tokenizers, text_encoders):
            embeds, pooled = self._encode_prompt_chunked(
                negative_prompt or "",
                tokenizer,
                text_encoder,
                num_chunks=num_chunks,
                device=device,
                clip_skip=clip_skip,
            )
            negative_embeds_parts.append(embeds)
            if pooled is not None:
                pooled_negative = pooled

        negative_prompt_embeds = (
            torch.cat(negative_embeds_parts, dim=-1) if len(negative_embeds_parts) > 1 else negative_embeds_parts[0]
        )
        if pooled_negative is None:
            pooled_negative = torch.zeros_like(pooled_positive)

        return prompt_embeds, negative_prompt_embeds, pooled_positive, pooled_negative

    def _adapter_name_for_path(self, lora_path: Path) -> str:
        # PEFT stores adapter modules under names that must be valid torch module keys.
        # In particular they cannot contain "." (and paths contain "." via ".safetensors").
        return lora_path.as_posix().lstrip("/").replace("/", "__").replace(".", "_")

    def _adapter_already_loaded(self, adapter_name: str) -> bool:
        if not hasattr(self, "pipe") or self.pipe is None:
            return False

        for attr in ("unet", "text_encoder", "text_encoder_2"):
            module = getattr(self.pipe, attr, None)
            peft_config = getattr(module, "peft_config", None)
            if isinstance(peft_config, dict) and adapter_name in peft_config:
                return True
        return False

    def _is_video_model_path(self, model_path: Path) -> bool:
        normalized = model_path.as_posix().lower()
        return any(hint in normalized for hint in VIDEO_MODEL_HINTS)

    def _candidate_video_pipeline_classes(self, model_path: Path) -> list[type]:
        normalized = model_path.as_posix().lower()
        class_names: list[str] = []
        if "ltx" in normalized:
            class_names.extend(["LTXImageToVideoPipeline", "LTXVideoPipeline", "LTXPipeline"])
        if "wan" in normalized:
            class_names.extend(["WanImageToVideoPipeline", "WanPipeline"])
        if "cogvideo" in normalized:
            class_names.extend(["CogVideoXImageToVideoPipeline", "CogVideoXPipeline"])
        if "hunyuan" in normalized:
            class_names.append("HunyuanVideoPipeline")
        if "mochi" in normalized:
            class_names.append("MochiPipeline")
        if "zeroscope" in normalized or "text-to-video" in normalized or "text_to_video" in normalized:
            class_names.append("TextToVideoSDPipeline")
        if "svd" in normalized or "stable-video" in normalized:
            class_names.append("StableVideoDiffusionPipeline")

        # Keep a generic fallback last. Diffusers can resolve repository folders
        # with model_index.json even when no specific class is chosen.
        class_names.append("DiffusionPipeline")

        seen: set[str] = set()
        classes: list[type] = []
        import diffusers

        for class_name in class_names:
            if class_name in seen:
                continue
            seen.add(class_name)
            pipeline_cls = getattr(diffusers, class_name, None)
            if pipeline_cls is not None:
                classes.append(pipeline_cls)
        return classes

    def _load_video_pipeline(self, model_path: Path):
        errors: list[str] = []
        for pipeline_cls in self._candidate_video_pipeline_classes(model_path):
            class_name = getattr(pipeline_cls, "__name__", str(pipeline_cls))
            try:
                if model_path.is_dir():
                    pipe = pipeline_cls.from_pretrained(
                        str(model_path),
                        torch_dtype=torch.float16,
                    )
                elif hasattr(pipeline_cls, "from_single_file"):
                    pipe = pipeline_cls.from_single_file(
                        str(model_path),
                        torch_dtype=torch.float16,
                    )
                else:
                    errors.append(f"{class_name}: from_single_file is not available")
                    continue

                return pipe.to("cuda")
            except Exception as exc:
                errors.append(f"{class_name}: {type(exc).__name__}: {exc}")

        detail = "; ".join(errors[-4:])
        raise RuntimeError(
            "Failed to load video pipeline. This model may need a Diffusers folder export "
            f"or a model-specific loader. Attempts: {detail}"
        )

    def _pipe_accepts_kwarg(self, name: str) -> bool:
        try:
            sig = inspect.signature(self.pipe.__call__)
        except Exception:
            return True
        if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in sig.parameters.values()):
            return True
        return name in sig.parameters

    def _filtered_pipe_kwargs(self, kwargs: dict) -> dict:
        return {key: value for key, value in kwargs.items() if value is not None and self._pipe_accepts_kwarg(key)}

    def _decode_input_image(self, image_bytes: bytes) -> Image.Image:
        if not image_bytes:
            raise ValueError("input_image is required for image-to-video generation")
        with Image.open(io.BytesIO(image_bytes)) as image:
            return image.convert("RGB")

    def _first_batch_frames(self, value):
        if value is None:
            return None
        if isinstance(value, torch.Tensor):
            tensor = value.detach().cpu()
            if tensor.ndim == 5:
                tensor = tensor[0]
            if tensor.ndim == 4 and tensor.shape[0] in (1, 3, 4):
                tensor = tensor.permute(1, 2, 3, 0)
            if tensor.ndim == 4:
                frames = []
                for frame in tensor:
                    frame = frame.float()
                    if frame.max() <= 1:
                        frame = frame * 255
                    frame = frame.clamp(0, 255).byte().numpy()
                    frames.append(Image.fromarray(frame))
                return frames
        if isinstance(value, (list, tuple)):
            if len(value) == 0:
                return []
            first = value[0]
            if isinstance(first, (list, tuple)):
                return list(first)
            return list(value)
        return None

    def _frames_from_output(self, output) -> list:
        for attr in ("frames", "videos"):
            frames = self._first_batch_frames(getattr(output, attr, None))
            if frames is not None:
                return frames
        if isinstance(output, (list, tuple)) and output:
            frames = self._first_batch_frames(output[0])
            if frames is not None:
                return frames
        raise RuntimeError("Video pipeline did not return frames or videos.")

    def _export_frames_to_mp4(self, frames: list) -> bytes:
        if not frames:
            raise RuntimeError("Video pipeline returned no frames.")
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name
            export_to_video(frames, tmp_path, fps=8)
            return Path(tmp_path).read_bytes()
        finally:
            if tmp_path:
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass

    def _generate_image_bytes(self, positive_prompt: str, negative_prompt: str) -> bytes:
        if not hasattr(self, "pipe") or self.pipe is None:
            raise RuntimeError("Model must be set before generating images.")

        try:
            (
                prompt_embeds,
                negative_prompt_embeds,
                pooled_prompt_embeds,
                negative_pooled_prompt_embeds,
            ) = self._encode_long_prompts_for_sdxl(positive_prompt, negative_prompt)
            prompt = None
            negative_prompt = None
        except Exception:
            self.log.exception("Failed to encode long prompts; falling back to raw string prompts (may truncate).")
            prompt_embeds = None
            negative_prompt_embeds = None
            pooled_prompt_embeds = None
            negative_pooled_prompt_embeds = None
            prompt = positive_prompt
            negative_prompt = negative_prompt

        image = self.pipe(
            height=1024,
            width=1024,
            prompt=prompt,
            negative_prompt=negative_prompt,
            prompt_embeds=prompt_embeds,
            negative_prompt_embeds=negative_prompt_embeds,
            pooled_prompt_embeds=pooled_prompt_embeds,
            negative_pooled_prompt_embeds=negative_pooled_prompt_embeds,
            num_inference_steps=30,
            guidance_scale=7,
        ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="png")
        return buf.getvalue()

    def _generate_video_bytes(self, request: GenerateMediaRequest) -> bytes:
        if not hasattr(self, "pipe") or self.pipe is None:
            raise RuntimeError("Model must be set before generating videos.")
        if self.model_media_type != "video":
            raise RuntimeError("Current model is not marked as video-capable. Select a video model before generating video.")

        mode = (request.mode or "").strip().lower().replace("-", "_")
        has_image = bool(request.input_image)
        image = self._decode_input_image(request.input_image) if has_image else None

        if mode in ("image_to_video", "i2v") and image is None:
            # User selected an image-to-video-ish mode but did not attach an image.
            # Fall back to text-to-video exactly as requested.
            mode = "text_to_video"
        elif mode in ("auto", "", "video") and image is not None:
            mode = "image_to_video"
        elif mode in ("auto", "", "video"):
            mode = "text_to_video"

        kwargs = {
            "prompt": request.positive_prompt or "",
            "negative_prompt": request.negative_prompt or "",
            "image": image,
            "num_frames": int(os.getenv("VIDEO_NUM_FRAMES", "49")),
            "num_inference_steps": int(os.getenv("VIDEO_NUM_INFERENCE_STEPS", "30")),
            "guidance_scale": float(os.getenv("VIDEO_GUIDANCE_SCALE", "6.0")),
            "height": int(os.getenv("VIDEO_HEIGHT", "512")),
            "width": int(os.getenv("VIDEO_WIDTH", "512")),
        }

        if mode == "image_to_video" and image is not None:
            kwargs["height"] = None
            kwargs["width"] = None

        with torch.inference_mode():
            output = self.pipe(**self._filtered_pipe_kwargs(kwargs))

        frames = self._frames_from_output(output)
        return self._export_frames_to_mp4(frames)

    def GenerateImage(self, request: GenerateImageRequest, context):
        if not hasattr(self, "pipe") or self.pipe is None:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, "Model must be set before generating images.")

        try:
            image_bytes = self._generate_image_bytes(request.positive_prompt, request.negative_prompt)
        except RuntimeError as exc:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except Exception:
            self.log.exception("Failed to generate image")
            context.abort(grpc.StatusCode.INTERNAL, "Failed to generate image.")

        return GenerateImageResponse(
            image=image_bytes,
            mime_type="image/png",
            filename_hint="sdxl.png"
        )

    def GenerateMedia(self, request: GenerateMediaRequest, context):
        mode = (request.mode or "auto").strip().lower().replace("-", "_")
        wants_video = mode in ("video", "text_to_video", "image_to_video", "t2v", "i2v")
        if mode == "auto":
            wants_video = self.model_media_type == "video"

        if wants_video:
            try:
                video_bytes = self._generate_video_bytes(request)
            except RuntimeError as exc:
                context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))
            except Exception:
                self.log.exception("Failed to generate video")
                context.abort(grpc.StatusCode.INTERNAL, "Failed to generate video.")

            return GenerateMediaResponse(
                media=video_bytes,
                mime_type="video/mp4",
                filename_hint="generated.mp4",
                media_type="video",
            )

        try:
            image_bytes = self._generate_image_bytes(request.positive_prompt, request.negative_prompt)
        except RuntimeError as exc:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except Exception:
            self.log.exception("Failed to generate image")
            context.abort(grpc.StatusCode.INTERNAL, "Failed to generate image.")

        return GenerateMediaResponse(
            media=image_bytes,
            mime_type="image/png",
            filename_hint="sdxl.png",
            media_type="image",
        )
            
    def SetModel(self, request: SetModelRequest, context):
        model_path = Path(request.model_path)
        if not model_path.exists():
            context.abort(grpc.StatusCode.NOT_FOUND, f"Model not found: {request.model_path}")
        if model_path.is_dir() and not self._is_video_model_path(model_path):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"Image models must be .safetensors files: {request.model_path}")

        if hasattr(self, "pipe") and self.pipe is not None:
            del self.pipe

        if self._is_video_model_path(model_path):
            try:
                self.pipe = self._load_video_pipeline(model_path)
            except Exception as exc:
                self.log.exception("Failed to load video model")
                context.abort(grpc.StatusCode.INTERNAL, str(exc))
            self.model_media_type = "video"
        else:
            self.pipe = StableDiffusionXLPipeline.from_single_file(
                str(model_path),
                torch_dtype=torch.float16,
            ).to("cuda")
            self.model_media_type = "image"
        self.model_path = str(model_path)
        self.current_loras = []

        return SetModelResponse(
            model_path=str(model_path)
        )

    def SetLlmModel(self, request: SetLlmModelRequest, context):
        if AsyncLLMEngine is None or EngineArgs is None or SamplingParams is None:
            detail = _VLLM_IMPORT_ERROR or "vLLM is unavailable in this environment."
            context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "LLM support is not available because vLLM could not be imported. "
                f"({detail})",
            )

        model_path = (request.model_path or "").strip()
        try:
            resolved = self._resolve_llm_model_path(model_path)
        except ValueError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except FileNotFoundError as exc:
            context.abort(grpc.StatusCode.NOT_FOUND, str(exc))

        try:
            self._load_llm_engine(resolved)
        except Exception:
            self.log.exception("Failed to load LLM model")
            context.abort(grpc.StatusCode.INTERNAL, "Failed to load LLM model.")

        self.log.info("Loaded LLM model", extra={"model_path": str(resolved)})
        return SetLlmModelResponse(model_path=str(resolved))

    def GetCurrentModel(self, request: GetCurrentModelRequest, context):
        return GetCurrentModelResponse(model_path=getattr(self, "model_path", ""))

    def ClearModel(self, request: ClearModelRequest, context):
        model_path = getattr(self, "model_path", "")
        loras = getattr(self, "current_loras", [])

        if hasattr(self, "pipe"):
            try:
                del self.pipe
            except Exception:
                self.log.exception("Failed to delete pipeline")
            self.pipe = None

        self.model_path = ""
        self.current_loras = []
        self.model_media_type = ""
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass

        return ClearModelResponse(model_path=model_path, loras=loras)

    def GetCurrentLoras(self, request: GetCurrentLorasRequest, context):
        return GetCurrentLorasResponse(loras=getattr(self, "current_loras", []))

    def ClearLoras(self, request: ClearLorasRequest, context):
        removed = getattr(self, "current_loras", [])
        self.current_loras = []

        if hasattr(self, "pipe") and self.pipe is not None:
            if hasattr(self.pipe, "unload_lora_weights"):
                try:
                    self.pipe.unload_lora_weights()
                except Exception:
                    self.log.exception("Failed to unload LoRA weights")
            elif hasattr(self.pipe, "set_adapters"):
                try:
                    self.pipe.set_adapters([], adapter_weights=[])
                except Exception:
                    self.log.exception("Failed to clear adapters")

        return ClearLorasResponse(loras=removed)

    def SetLora(self, request: SetLoraRequest, context):
            
        if not hasattr(self, "pipe") or self.pipe is None:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, "Model must be set before applying loras.")

        try:
            import peft  # noqa: F401
        except Exception:
            context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "LoRA support requires the 'peft' package. Rebuild the py image with peft installed.",
            )

        applied: list[SetLora] = []
        adapter_names: list[str] = []
        adapter_weights: list[float] = []
        seen_adapter_names: set[str] = set()
        for lora in request.loras:
            lora_path = Path(lora.path)
            if not lora_path.exists() or lora_path.is_dir():
                self.log.warning(f"Failed to find safetensor {lora.path}")
                continue
            if float(lora.weight) < 0.1:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, "LoRA weight must be >= 0.1")

            try:
                adapter_name = self._adapter_name_for_path(lora_path)
                if adapter_name in seen_adapter_names:
                    continue
                seen_adapter_names.add(adapter_name)

                # Allow reapplying the same LoRA across requests by reusing the already-loaded adapter.
                if not self._adapter_already_loaded(adapter_name):
                    self.pipe.load_lora_weights(str(lora_path), adapter_name=adapter_name)
                adapter_names.append(adapter_name)
                adapter_weights.append(float(lora.weight))
                applied.append(SetLora(weight=lora.weight, path=str(lora_path)))
            except ValueError as e:
                if "PEFT backend is required" in str(e):
                    self.log.exception(f"Failed to apply LoRa {lora.path}")
                    context.abort(
                        grpc.StatusCode.FAILED_PRECONDITION,
                        "Diffusers requires the PEFT backend for LoRA loading; install 'peft' in the py container.",
                    )
                if "already in use in the model" in str(e):
                    # If diffusers/peft reports the name is taken, it usually means this adapter was loaded previously.
                    # Treat it as reusable and just activate it.
                    adapter_names.append(adapter_name)
                    adapter_weights.append(float(lora.weight))
                    applied.append(SetLora(weight=lora.weight, path=str(lora_path)))
                    continue
                self.log.exception(f"Failed to apply LoRa {lora.path}")
            except Exception:
                self.log.exception(f"Failed to apply LoRa {lora.path}")

        if adapter_names:
            self.pipe.set_adapters(adapter_names, adapter_weights=adapter_weights)
            for name in adapter_names:
                self.log.info(f"Applied LoRa {name}")

        self.current_loras = applied
        return SetLoraResponse(loras=applied)

    def _ensure_llm_loop(self) -> None:
        if self._llm_loop is not None:
            return
        self._llm_loop = asyncio.new_event_loop()
        self._llm_loop_thread = threading.Thread(
            target=self._llm_loop.run_forever,
            daemon=True,
        )
        self._llm_loop_thread.start()

    def _resolve_llm_model_path(self, model_path: str) -> Path:
        if not model_path:
            raise ValueError("model_path is required")
        path = Path(model_path)
        if not path.is_absolute():
            path = LLM_MODEL_DIR / path
        path = path.resolve()
        base_dir = LLM_MODEL_DIR.resolve()
        if base_dir not in path.parents and path != base_dir:
            raise ValueError(f"model_path must be within {base_dir}")
        if not path.exists():
            raise FileNotFoundError(f"LLM model not found: {path}")
        return path

    def _load_llm_engine(self, model_path: Path) -> None:
        self._ensure_llm_loop()
        prev_engine = None
        prev_path = ""
        with self._llm_lock:
            if self.llm is not None and self.llm_model_path == str(model_path):
                return
            prev_engine = self.llm
            prev_path = self.llm_model_path
            fut = asyncio.run_coroutine_threadsafe(
                self._build_llm_engine(str(model_path)),
                self._llm_loop,
            )
            try:
                engine = fut.result()
            except Exception:
                self.llm = prev_engine
                self.llm_model_path = prev_path
                raise
            self.llm = engine
            self.llm_model_path = str(model_path)
        if prev_engine is not None:
            self._shutdown_llm_engine(prev_engine)

    def _shutdown_llm_engine(self, engine: AsyncLLMEngine) -> None:
        if self._llm_loop is None:
            return

        async def _shutdown() -> None:
            for name in ("shutdown", "close"):
                fn = getattr(engine, name, None)
                if callable(fn):
                    res = fn()
                    if asyncio.iscoroutine(res):
                        await res
                    return

        fut = asyncio.run_coroutine_threadsafe(_shutdown(), self._llm_loop)
        try:
            fut.result()
        except Exception:
            self.log.exception("Failed to shutdown previous LLM engine")

    def _ensure_llm_engine(self) -> None:
        if self.llm is not None:
            return
        model_path = self.llm_model_path or LLM_DEFAULT_MODEL
        if not model_path:
            raise RuntimeError("LLM model not set. Call SetLlmModel first.")
        resolved = self._resolve_llm_model_path(model_path)
        self._load_llm_engine(resolved)

    async def _build_llm_engine(self, model_path: str) -> AsyncLLMEngine:
        if AsyncLLMEngine is None or EngineArgs is None:
            detail = _VLLM_IMPORT_ERROR or "vLLM is unavailable in this environment."
            raise RuntimeError(f"vLLM could not be imported. ({detail})")
        args = EngineArgs(
            model=model_path,
            dtype=LLM_DTYPE,
            max_model_len=LLM_MAX_MODEL_LEN,
            gpu_memory_utilization=LLM_GPU_MEM_UTIL,
            max_num_seqs=LLM_MAX_NUM_SEQS,
            max_num_batched_tokens=LLM_MAX_BATCHED_TOKENS,
            tensor_parallel_size=LLM_TP_SIZE,
            enable_prefix_caching=True,
        )
        # vLLM versions differ here:
        # - Some builds return an awaitable.
        # - Others (notably some NVIDIA builds) return an object directly.
        built = AsyncLLMEngine.from_engine_args(args)
        if asyncio.iscoroutine(built):
            return await built
        return built  # type: ignore[return-value]

    def _default_sampling_params(self) -> SamplingParams:
        if SamplingParams is None:
            detail = _VLLM_IMPORT_ERROR or "vLLM is unavailable in this environment."
            raise RuntimeError(f"vLLM could not be imported. ({detail})")
        return SamplingParams(
            max_tokens=LLM_MAX_TOKENS,
            temperature=LLM_TEMPERATURE,
            top_p=LLM_TOP_P,
        )

    def _context_cancelled(self, context: grpc.ServicerContext) -> bool:
        try:
            return not context.is_active()
        except Exception:
            return False

    def _should_flush(self, buf: StreamBuffer) -> bool:
        if not buf.has_data():
            return False
        if LLM_FLUSH_MAX_CHARS > 0 and buf.char_count >= LLM_FLUSH_MAX_CHARS:
            return True
        if LLM_FLUSH_EVERY_MS > 0:
            elapsed_ms = (time.monotonic() - buf.last_flush_monotonic) * 1000.0
            if elapsed_ms >= LLM_FLUSH_EVERY_MS:
                return True
        return False

    def _delta_from_output(self, full_text: str, prev_text: str) -> Tuple[str, str]:
        if not full_text or len(full_text) <= len(prev_text):
            return "", prev_text
        delta = full_text[len(prev_text):]
        return delta, full_text

    async def _safe_abort(self, request_id: str) -> None:
        engine = self.llm
        if engine is None:
            return
        try:
            await engine.abort(request_id)
        except Exception:
            pass

    async def _stream_llm_text(
        self,
        request_id: str,
        prompt: str,
        sampling: SamplingParams,
        context: grpc.ServicerContext,
    ) -> AsyncIterator[str]:
        buf = StreamBuffer.new()
        prev_text = ""

        try:
            async for out in self.llm.generate(prompt, sampling, request_id=request_id):
                if self._context_cancelled(context):
                    if buf.has_data():
                        yield buf.take_all()
                    return

                if not getattr(out, "outputs", None):
                    continue

                full_text = out.outputs[0].text or ""
                delta, prev_text = self._delta_from_output(full_text, prev_text)
                if not delta:
                    continue

                buf.add(delta)

                if self._should_flush(buf):
                    yield buf.take_all()

            if buf.has_data():
                yield buf.take_all()
        finally:
            await self._safe_abort(request_id)

    def _iter_async_generator(self, agen: AsyncIterator[str]):
        while True:
            try:
                fut = asyncio.run_coroutine_threadsafe(agen.__anext__(), self._llm_loop)
                yield fut.result()
            except StopAsyncIteration:
                return

    def _normalize_llm_request(self, request: ConversationRequest) -> Tuple[str, str]:
        request_id = str(uuid.uuid4())
        prompt = getattr(request, "prompt", None)
        if not prompt:
            prompt = getattr(request, "message", None)
        if isinstance(prompt, bytes):
            prompt = prompt.decode("utf-8", errors="ignore")
        if not prompt:
            prompt = request.username or ""
        return request_id, prompt

    def Conversation(self, request: ConversationRequest, context: grpc.ServicerContext):
        try:
            self._ensure_llm_engine()
        except (RuntimeError, ValueError, FileNotFoundError) as exc:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except Exception:
            self.log.exception("Failed to initialize LLM engine")
            context.abort(grpc.StatusCode.INTERNAL, "Failed to initialize LLM engine.")
        request_id, prompt = self._normalize_llm_request(request)
        if not prompt:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Prompt is required.")

        sampling = self._default_sampling_params()
        self.log.info("Conversation request received", extra={"username": request.username, "request_id": request_id})

        try:
            for delta_text in self._iter_async_generator(
                self._stream_llm_text(request_id, prompt, sampling, context)
            ):
                if not delta_text:
                    continue
                yield ConversationResponse(
                    username=request.username,
                    message=delta_text.encode("utf-8"),
                )
        except Exception:
            self.log.exception("Conversation stream failed")
            context.abort(grpc.StatusCode.INTERNAL, "Conversation stream failed.")
