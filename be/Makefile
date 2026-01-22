.PHONY: generate_proto
generate_proto:
	go generate ./cmd/server

.PHONY: tidy
tidy:
	go mod tidy  # or just `go mod tidy` if be/ has its own module

.PHONY: install
install:
	@if command -v brew >/dev/null 2>&1; then \
		BIN_DIR="$$(brew --prefix)/bin"; \
	else \
		BIN_DIR="$$(go env GOPATH)/bin"; \
	fi; \
	GOBIN="$$BIN_DIR" go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.10; \
	GOBIN="$$BIN_DIR" go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.0
