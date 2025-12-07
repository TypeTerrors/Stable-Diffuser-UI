PROTO_DIR := proto
OUT_DIR := proto

generate_proto:
	python -m grpc_tools.protoc \
		-I $(PROTO_DIR) \
		--python_out=$(OUT_DIR) \
		--grpc_python_out=$(OUT_DIR) \
		--mypy_out=$(OUT_DIR) \
		$(PROTO_DIR)/img_service.proto