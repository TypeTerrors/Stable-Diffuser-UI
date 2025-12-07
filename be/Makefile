PROTO_DIR := proto
OUT_DIR := proto
PROTOC_GEN_GO := $(shell which protoc-gen-go)
PROTOC_GEN_GO_GRPC := $(shell which protoc-gen-go-grpc)

.PHONY: proto
generate_proto: $(PROTOC_GEN_GO) $(PROTOC_GEN_GO_GRPC)
	protoc \
		-I $(PROTO_DIR) \
		--go_out=$(OUT_DIR) \
		--go_opt=paths=source_relative \
		--go-grpc_out=$(OUT_DIR) \
		--go-grpc_opt=paths=source_relative \
		$(PROTO_DIR)/image_service.proto

.PHONY: tidy
tidy:
	go mod tidy  # or just `go mod tidy` if be/ has its own module

$(PROTOC_GEN_GO):
	GO111MODULE=on go install google.golang.org/protobuf/cmd/protoc-gen-go@latest

$(PROTOC_GEN_GO_GRPC):
	GO111MODULE=on go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
