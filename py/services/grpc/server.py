from concurrent import futures
import logging
import os
from pathlib import Path

import grpc
from proto.img_service_pb2_grpc import add_InferenceServiceServicer_to_server
from .image_service import InferenceService
from services.models.text_to_image import TextToImageModel

logger = logging.getLogger(__name__)


def _grpc_max_msg_size_bytes() -> int:
    raw = (os.getenv("RPC_MAX_MSG_SIZE_MB") or "").strip()
    if not raw:
        return 256 * 1024 * 1024
    try:
        mb = int(raw)
    except ValueError:
        return 256 * 1024 * 1024
    if mb <= 0:
        return 256 * 1024 * 1024
    return mb * 1024 * 1024


def _resolve_text_to_image_model_path() -> str:
    env_path = (
        os.getenv("TEXT_TO_IMAGE_MODEL_PATH")
        or os.getenv("TXT_TO_IMAGE_MODEL_PATH")
        or os.getenv("MODEL_PATH")
    )
    if not env_path:
        raise EnvironmentError(
            "Text-to-image model path is not set. Set TEXT_TO_IMAGE_MODEL_PATH (or MODEL_PATH for compatibility)."
        )

    model_path = Path(env_path)
    if not model_path.exists():
        raise FileNotFoundError(
            f"Text-to-image model not found at {env_path}. Confirm the host path is mounted into the container."
        )

    return str(model_path)


def _resolve_image_to_video_model_path() -> str | None:
    env_path = os.getenv("IMAGE_TO_VIDEO_MODEL_PATH") or os.getenv("I2V_MODEL_PATH")
    if not env_path:
        return None

    model_path = Path(env_path)
    if not model_path.exists():
        raise FileNotFoundError(
            f"Image-to-video model not found at {env_path}. Confirm the host path is mounted into the container."
        )

    if model_path.is_file():
        logger.warning(
            "IMAGE_TO_VIDEO_MODEL_PATH points to a file (%s); using parent directory (%s) instead.",
            model_path,
            model_path.parent,
        )
        model_path = model_path.parent

    return str(model_path)


def serve():
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO)

    text_to_image_model_path = _resolve_text_to_image_model_path()
    logger.info("Loading text to image model from %s", text_to_image_model_path)

    text_to_image_model = TextToImageModel(text_to_image_model_path)

    image_to_video_model = None
    image_to_video_model_path = _resolve_image_to_video_model_path()
    if image_to_video_model_path:
        from services.models.image_to_video import ImageToVideoModel

        logger.info("Loading image-to-video model from %s", image_to_video_model_path)
        try:
            image_to_video_model = ImageToVideoModel(image_to_video_model_path)
        except Exception:
            logger.exception(
                "Failed to load image-to-video model; disabling GenerateImageToVideo."
            )
            image_to_video_model = None
    else:
        logger.warning(
            "IMAGE_TO_VIDEO_MODEL_PATH not set; GenerateImageToVideo will be unavailable."
        )


    max_msg_size = _grpc_max_msg_size_bytes()
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=4),
        options=[
            ("grpc.max_send_message_length", max_msg_size),
            ("grpc.max_receive_message_length", max_msg_size),
        ],
    )
    add_InferenceServiceServicer_to_server(
        InferenceService(text_to_image_model, image_to_video_model),
        server=server
    )

    server.add_insecure_port("[::]:50051")
    logger.info("gRPC server listening on [::]:50051")
    server.start()
    logger.info("gRPC server ready")
    server.wait_for_termination()
