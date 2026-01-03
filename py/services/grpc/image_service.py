import io
from logging import Logger
from pathlib import Path

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
)
from proto.img_service_pb2_grpc import ImageServiceServicer

class ImageService(ImageServiceServicer):

    def __init__(self, log: Logger):
        self.log = log

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

        image = self.pipe(
            height=1024,
            width=1024,
            prompt=request.positive_prompt,
            negative_prompt=request.negative_prompt,
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
            
    def SetModel(self, request: SetModelRequest, context):
        model_path = Path(request.model_path)
        if not model_path.exists() or model_path.is_dir():
            context.abort(grpc.StatusCode.NOT_FOUND, f"Model not found: {request.model_path}")

        if hasattr(self, "pipe") and self.pipe is not None:
            del self.pipe

        self.pipe = StableDiffusionXLPipeline.from_single_file(
            str(model_path),
            torch_dtype=torch.float16,
        ).to("cuda")
        self.model_path = str(model_path)
        self.current_loras = []
        
        return SetModelResponse(
            model_path=str(model_path)
        )

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
