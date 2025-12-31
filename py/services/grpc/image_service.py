import grpc
from typing import TYPE_CHECKING

from proto.img_service_pb2 import (
    GenerateImageRequest,
    GenerateImageResponse,
    GenerateImageToVideoRequest,
    GenerateImageToVideoResponse,
)
from proto.img_service_pb2_grpc import InferenceServiceServicer
from services.models.text_to_image import TextToImageModel

if TYPE_CHECKING:
    from services.models.image_to_video import ImageToVideoModel


class InferenceService(InferenceServiceServicer):
    def __init__(
        self,
        text_to_image_model: TextToImageModel,
        image_to_video_model: "ImageToVideoModel | None",
    ):
        self.text_to_image_model = text_to_image_model
        self.image_to_video_model = image_to_video_model
    
    def GenerateImage(self, request: GenerateImageRequest, context):
        image, mime_type, filename_hint = self.text_to_image_model.generate_image(
            positive_prompt=request.positive_prompt,
            negative_prompt=request.negative_prompt
        )

        return GenerateImageResponse(
            image=image,
            mime_type=mime_type,
            filename_hint=filename_hint
        )
    def GenerateImageToVideo(self, request: GenerateImageToVideoRequest, context):
        if self.image_to_video_model is None:
            context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "Image-to-video model is not configured (set IMAGE_TO_VIDEO_MODEL_PATH).",
            )

        video, mime_type, filename_hint = self.image_to_video_model.generate_video(
            image_bytes=request.image,
            positive_prompt=request.positive_prompt,
            negative_prompt=request.negative_prompt
        )

        return GenerateImageToVideoResponse(
            video=video,
            mime_type=mime_type,
            filename_hint=filename_hint
        )
