from concurrent import futures
import logging

import grpc
from proto.img_service_pb2_grpc import add_ImageServiceServicer_to_server
from .image_service import ImageService

logger = logging.getLogger(__name__)


def serve():
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    add_ImageServiceServicer_to_server(
        ImageService(logger),
        server=server
    )
    server.add_insecure_port("[::]:50051")
    logger.info("gRPC server listening on [::]:50051")
    server.start()
    logger.info("gRPC server ready")
    server.wait_for_termination()
