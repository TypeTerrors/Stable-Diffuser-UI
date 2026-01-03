PROTO_DIR := proto
OUT_DIR := proto

generate_proto:
	python -m grpc_tools.protoc \
		-I $(PROTO_DIR) \
		--python_out=$(OUT_DIR) \
		--grpc_python_out=$(OUT_DIR) \
		--mypy_out=$(OUT_DIR) \
		$(PROTO_DIR)/img_service.proto
	python -c "from pathlib import Path; p=Path('proto/img_service_pb2_grpc.py'); t=p.read_text(encoding='utf-8'); t=t.replace('import img_service_pb2 as img__service__pb2','from . import img_service_pb2 as img__service__pb2'); p.write_text(t, encoding='utf-8')"
