PROTO_DIR ?= proto
OUT_DIR ?= proto

# Keep protoc plugins local to this module so generation works even when GOPATH/bin
# isn't on PATH.
BIN_DIR ?= $(CURDIR)/.bin
PROTOC_GEN_GO := $(BIN_DIR)/protoc-gen-go
PROTOC_GEN_GO_GRPC := $(BIN_DIR)/protoc-gen-go-grpc

.PHONY: generate_proto
generate_proto: $(PROTOC_GEN_GO) $(PROTOC_GEN_GO_GRPC)
	protoc \
		-I $(PROTO_DIR) \
		--plugin=protoc-gen-go=$(PROTOC_GEN_GO) \
		--go_out=$(OUT_DIR) \
		--go_opt=paths=source_relative \
		--plugin=protoc-gen-go-grpc=$(PROTOC_GEN_GO_GRPC) \
		--go-grpc_out=$(OUT_DIR) \
		--go-grpc_opt=paths=source_relative \
		$(PROTO_DIR)/image_service.proto

.PHONY: tidy
tidy:
	go mod tidy  # or just `go mod tidy` if be/ has its own module

.PHONY: install
install: $(PROTOC_GEN_GO) $(PROTOC_GEN_GO_GRPC)

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

$(PROTOC_GEN_GO): | $(BIN_DIR)
	GOBIN=$(BIN_DIR) go install google.golang.org/protobuf/cmd/protoc-gen-go@latest

$(PROTOC_GEN_GO_GRPC): | $(BIN_DIR)
	GOBIN=$(BIN_DIR) go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest