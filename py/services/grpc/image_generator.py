from proto.img_service_pb2_grpc import ImageServiceServicer
from proto.img_service_pb2 import GenerateImageResponse

from py.services.sdxl.img_generator import generate_image

class ImageService(ImageServiceServicer):
    def GenerateImage(self, request, context):
        image_bytes, mime_type, filename_hint = generate_image(
            pos_prompt=request.positive_prompt,
            neg_prompt=request.negative_prompt,
        )
        return GenerateImageResponse(
            image=image_bytes,
            mime_type=mime_type,
            filename_hint=filename_hint
        )