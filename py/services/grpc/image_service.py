import io
import math
import os
import tempfile
from logging import Logger
from pathlib import Path
from ltx_pipelines.ti2vid_one_stage import TI2VidOneStagePipeline
from ltx_pipelines.utils.media_io import encode_video
from ltx_pipelines.utils.constants import AUDIO_SAMPLE_RATE


import grpc
import torch
from diffusers import StableDiffusionXLPipeline
from proto.img_service_pb2 import (
    ClearModelRequest,
    ClearModelResponse,
    ClearLorasRequest,
    ClearLorasResponse,
    GenerateImageRequest,
    GenerateImageResponse,
    GetCurrentModelRequest,
    GetCurrentModelResponse,
    GetCurrentLorasRequest,
    GetCurrentLorasResponse,
    SetLora,
    SetLoraRequest,
    SetLoraResponse,
    SetModelRequest,
    SetModelResponse,
    GenerateImageToVideoRequest,
    GenerateImageToVideoResonse,
    ModelType
)
from proto.img_service_pb2_grpc import ImageServiceServicer

class ImageService(ImageServiceServicer):

    def __init__(self, log: Logger):
        self.log = log

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

    def GenerateImage(self, request: GenerateImageRequest, context):
        if not hasattr(self, "pipe") or self.pipe is None:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, "Model must be set before generating images.")

        try:
            (
                prompt_embeds,
                negative_prompt_embeds,
                pooled_prompt_embeds,
                negative_pooled_prompt_embeds,
            ) = self._encode_long_prompts_for_sdxl(request.positive_prompt, request.negative_prompt)
            prompt = None
            negative_prompt = None
        except Exception:
            self.log.exception("Failed to encode long prompts; falling back to raw string prompts (may truncate).")
            prompt_embeds = None
            negative_prompt_embeds = None
            pooled_prompt_embeds = None
            negative_pooled_prompt_embeds = None
            prompt = request.positive_prompt
            negative_prompt = request.negative_prompt

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

        return GenerateImageResponse(
            image=buf.getvalue(),
            mime_type="image/png",
            filename_hint="sdxl.png"
        )
    def GenerateImageToVideo(self, request: GenerateImageToVideoRequest, context):
        if not hasattr(self, "pipe") or self.pipe is None:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, "Model must be set before generating images.")

        if not isinstance(self.pipe, TI2VidOneStagePipeline):
            context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "Current model is not an image-to-video pipeline; call SetModel with model_type=i2v first.",
            )

        if not request.image:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Bad Request: image is required.")

        negative_prompt = request.negative_prompt or ""

        with tempfile.TemporaryDirectory(prefix="img2vid_") as tmpdir:
            image_path = os.path.join(tmpdir, "input.png")
            output_path = os.path.join(tmpdir, "output.mp4")

            try:
                with open(image_path, "wb") as f:
                    f.write(request.image)
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"Failed to write temp image. ({exc})")

            try:
                video, audio = self.pipe(
                    prompt=request.positive_prompt or "",
                    negative_prompt=negative_prompt,
                    seed=42,
                    height=512,
                    width=768,
                    num_frames=121,
                    frame_rate=25.0,
                    num_inference_steps=40,
                    cfg_guidance_scale=3.0,
                    images=[(image_path, 0, 1.0)],
                )

                encode_video(
                    video=video,
                    fps=25,
                    audio=audio,
                    audio_sample_rate=AUDIO_SAMPLE_RATE,
                    output_path=output_path,
                    video_chunks_number=1,
                )

                with open(output_path, "rb") as f:
                    video_bytes = f.read()
            except grpc.RpcError:
                raise
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"Failed to generate video. ({exc})")

        return GenerateImageToVideoResonse(
            video=video_bytes,
            mime_type="video/mp4",
            filename_hint="ltx_i2v.mp4",
        )
            
    def SetModel(self, request: SetModelRequest, context):
        model_path = Path(request.model_path)
        if not model_path.exists() or model_path.is_dir():
            context.abort(grpc.StatusCode.NOT_FOUND, f"Model not found: {request.model_path}")

        if hasattr(self, "pipe") and self.pipe is not None:
            del self.pipe

        # use the stable diffusion pipeline from SDXL
        if request.model_type == ModelType.t2i:
            self.pipe = StableDiffusionXLPipeline.from_single_file(
                str(model_path),
                torch_dtype=torch.float16,
            ).to("cuda")
            self.model_path = str(model_path)
            self.current_loras = []

            return SetModelResponse(
                model_path=str(model_path)
            )
        
        # use the image to video library from lighttricks ltx-2
        if request.model_type == ModelType.i2v:
            gemma_root = os.getenv("LTX_GEMMA_ROOT") or os.getenv("GEMMA_ROOT") or ""
            if not gemma_root:
                context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    "LTX i2v requires a Gemma root path; set LTX_GEMMA_ROOT (or GEMMA_ROOT) in the container env.",
                )

            self.pipe = TI2VidOneStagePipeline(
                checkpoint_path=str(model_path),
                gemma_root=gemma_root,
                loras=[],
                device=torch.device("cuda"),
            )
            self.model_path = str(model_path)
            self.current_loras = []
            return SetModelResponse(
                model_path=str(model_path)
            )

        return context.abort(grpc.StatusCode.ABORTED, f"Model not found: {request.model_path}")

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
