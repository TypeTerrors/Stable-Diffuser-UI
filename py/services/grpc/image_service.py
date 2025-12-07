from proto.img_service_pb2_grpc import ImageServiceServicer
from proto.img_service_pb2 import GenerateImageResponse, GenerateImageRequest
from services.sdxl.model_loader import SDXLModel

class ImageService(ImageServiceServicer):
    def __init__(self, model: SDXLModel):
        self.model = model
    
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