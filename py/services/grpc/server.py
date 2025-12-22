from concurrent import futures
import logging
import os
from pathlib import Path

import grpc
from proto.img_service_pb2_grpc import add_ImageServiceServicer_to_server
from .image_service import ImageService
from services.sdxl.model_loader import SDXLModel

logger = logging.getLogger(__name__)


def _resolve_model_path() -> str:
    """Resolve the model path strictly from MODEL_PATH."""
    env_path = os.getenv("MODEL_PATH")
    if not env_path:
        raise EnvironmentError(
            "MODEL_PATH is not set. Ensure docker-compose passes PY_MODEL_PATH to the py service."
        )

    model_path = Path(env_path)
    if not model_path.exists():
        raise FileNotFoundError(
            f"Diffusers model not found at {env_path}. Confirm the host path is mounted into the container."
        )

    return str(model_path)


def serve():
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO)

    model_path = _resolve_model_path()
    logger.info("Loading SDXL model from %s", model_path)
    model = SDXLModel(model_path)
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    add_ImageServiceServicer_to_server(
        ImageService(model),
        server=server
    )
    server.add_insecure_port("[::]:50051")
    logger.info("gRPC server listening on [::]:50051")
    server.start()
    logger.info("gRPC server ready")
    server.wait_for_termination()
