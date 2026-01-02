from proto.img_service_pb2_grpc import ImageServiceServicer
from proto.img_service_pb2 import GenerateImageResponse, GenerateImageRequest, ListModelsRequest, ListModelResponse, SetModelRequest, SetModelResponse, ListLorasRequest, ListLorasResponse, SetLoraRequest, SetLoraResponse
from pathlib import Path
from logging import Logger
from diffusers import StableDiffusionXLPipeline


import os
import torch

class ImageService(ImageServiceServicer):

    def __init__(self, log: Logger):
        self.log = log

    def GenerateImage(self, request: GenerateImageRequest, context):
        image, mime_type, filename_hint = self.model.generate_image(
            positive_prompt=request.positive_prompt,
            negative_prompt=request.negative_prompt
        )

        return GenerateImageResponse(
            image=image,
            mime_type=mime_type,
            filename_hint=filename_hint
        )
    def ListModels(self, request: ListModelsRequest):

        model_paths: list[str] = []
        for root, dirs, files in os.walk('./models'):
            for file in files:
                if ".safetensors" in file:
                    full_path = os.path.join(root,file)
                    model_paths.append(full_path)
        
        return ListModelResponse(
            model_paths=model_paths
        )
            
    def SetModel(self, request: SetModelRequest):
        if not Path.exists(request.model_path):
            
            return SetModelResponse(
                model_path=None
            )

        mode_path = Path(request.model_path)    

        if hasattr(self, "pipe") and not None:
            del self.pipe
            self.pipe = StableDiffusionXLPipeline.from_single_file(
                mode_path,
                torch_dtype=torch.float16,
            ).to("cuda")
        else:
            self.pipe = StableDiffusionXLPipeline.from_single_file(
                mode_path,
                torch_dtype=torch.float16,
            ).to("cuda")
        
        return SetModelResponse(
            model_path=request.model_path
        )

    def ListLoras(self, request: ListLorasRequest):
        lora_path: list[str] = []
        for root, dirs, files in os.walk('./loras'):
            for file in files:
                if ".safetensors" in file:
                    full_path = os.path.join(root,file)
                    lora_path.append(full_path)
        
        return ListModelResponse(
            lora_path=lora_path
        )
    def SetLora(self, request: SetLoraRequest, context):
            
            if not hasattr(self, "pipe") or self.pipe == None:
                return SetLoraResponse(
                    lora_path=None
                )
        
            applied_loars: list[str] = []
            for lora in request.loras:
                try:
                    self.pipe.load_lora_weights(
                        lora.path,
                        weight_name=lora.path,
                        adapter_name=lora.path,
                    )
                    self.pipe.set_adapters(lora.path, adapter_weights=lora.weight)
                    self.log.info(f"Applied LoRa {lora.path}")
                    applied_loars.append(lora.path)
                except:
                    self.log.warning(f"Failed to apply LoRa {lora.path}")
            
            return SetLoraResponse(
                loras=applied_loars
            )