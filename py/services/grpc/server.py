import grpc
from concurrent import futures
from proto.img_service_pb2_grpc import add_ImageServiceServicer_to_server
from .image_generator import ImageService
from sdxl.model_loader import SDXLModel

def serve():

    model = SDXLModel("/workspace/models/sdlx/sd_xl_base_1.0.safetensors")
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    add_ImageServiceServicer_to_server(
        ImageService(model),
        server=server
    )
    server.add_insecure_port("[::]:50051")
    server.start()
    server.wait_for_termination()