# img-generator

AI-assisted playground that ties together a Python SDXL worker, a Go API, and a Next.js + shadcn/ui front end. The goal is run heavy PyTorch inference on a DGX Spark GPU box while getting gRPC, Fiber, and modern Next.js applications to cooperate with eachother.

---

## Quick Tour

| Folder | Purpose |
| ------ | ------- |
| `py/`  | Python microservice that loads Stable Diffusion XL, exposes a gRPC server, and returns raw PNG bytes. Includes a devcontainer for GPU-friendly editing. |
| `be/`  | Go microservice (Fiber + gRPC client). Calls the Python worker, streams bytes back over HTTP, and houses shared config/proto tooling. |
| `fe/`  | Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui). Provides the prompt form and preview panel, fetching from the Go API. |
| `docker-compose.yaml` | Spins up all three services together with consistent env variables plus GPU access. |
| `.env` | Central config consumed by Compose, the Go service (via `gonfig`), and the Next.js client. |

```
img-generator
├── be/
│   ├── cmd/server/main.go         # API entrypoint
│   ├── internal/dependencies/     # gRPC client wrapper
│   ├── internal/services/         # Fiber server + handlers
│   ├── proto/                     # Go-generated proto bindings
│   ├── types/                     # Request/response DTOs
│   └── Makefile                   # `generate_proto`
├── py/
│   ├── main.py                    # starts the gRPC worker
│   ├── services/grpc/             # ImageService Servicer + server
│   ├── services/sdxl/             # SDXL model loader + helpers
│   ├── proto/                     # Python proto + generated stubs
│   ├── models/                    # Expected .safetensors weights
│   ├── .devcontainer/             # VS Code container config
│   └── Makefile                   # `generate_proto`
├── fe/
│   ├── src/app/                   # Next.js pages/layout/globals
│   ├── src/components/ui/         # shadcn/ui primitives
│   └── package.json
└── docker-compose.yaml
```

---

## System Architecture

```
[Next.js FE] --HTTP POST /generateimage--> [Go API (Fiber)]
      ^                                            |
      |                                            v
      <--HTTP 200 image/png bytes-- [Go API streams binary response]
                                                   |
                                                   v
                                           [gRPC call]
                                                   |
                                         [Python SDXL worker]
                                                   |
                                         (PNG bytes + metadata)
```

1. **Frontend** posts positive/negative prompts to the Go API with JSON.
2. **Go API** validates the request, calls the Python worker via gRPC, and streams raw PNG bytes back to the browser (setting `Content-Type` and `Content-Disposition`).
3. **Python worker** reuses a preloaded `StableDiffusionXLPipeline`, generates an image, serializes it to bytes, and replies via `GenerateImageResponse`.
4. **Frontend** converts the HTTP response into a `Blob`, makes a temporary `blob:` URL, and displays it in the right-side AspectRatio preview.

---

## Python Service (`py/`)

- **Runtime:** NVIDIA’s `nvcr.io/nvidia/pytorch:25.09-py3` base image, CUDA-ready.
- **Entry point:** `python main.py` → `services.grpc.server.serve()`.
- **Key code paths:**
  - `services/sdxl/model_loader.py` – wraps SDXL model loading and caching (`self.pipe`).
  - `services/grpc/image_service.py` – gRPC servicer that calls the cached model.
  - `proto/img_service.proto` – shared proto definition (request prompts + response bytes/mime/filename).
- **Dependencies:** pinned in `py/requirements.txt` (`torch`, `diffusers`, `grpcio`, `grpcio-tools`, `mypy-protobuf`).
- **Proto generation:** `make -C py generate_proto` uses `grpcio-tools` with `--mypy_out` to emit `.py` and `.pyi` stubs under `py/proto`.
- **Devcontainer:** `py/.devcontainer` builds the NVIDIA base image, binds the repo into `/workspace`, and enables GPU access inside VS Code.
- **Models:** default path `/workspace/models/sd_xl_base_1.0.safetensors`. The compose file mounts `./py/models` into that location; drop your `.safetensors` there.

**Important:** the worker expects a GPU (or change `device="cuda"` to `cpu` but expect slow inference). Loading happens once at startup so requests reuse the same pipeline.

---

## Go API (`be/`)

- **Runtime:** Go 1.25, Fiber 2.x for HTTP, gRPC client for Python calls.
- **Configuration:** `config/config.yaml` + `.env` via `gonfig`. Required values:
  - `API_PORT` – HTTP port to expose.
  - `RPC_PEER` / `RPC_PORT` – gRPC host/port of the Python worker.
- **Entry point:** `be/cmd/server/main.go` → `mediator.App`. `App.Start()` spins up Fiber, `App.Shutdown()` closes the gRPC connection.
- **Handlers:** `internal/services/api_handlers.go`
  - `GET /health` – simple timestamp/status JSON.
  - `POST /generateimage` – accepts `positivePrompt` and `negativePrompt`, delegates to RPC, streams binary response.
- **RPC wrapper:** `internal/dependencies/rpc.go`
  - Dials Python once, exposes `GenerateImage`, handles close via `Rpc.Close()`.
- **DTOs:** `be/types/api.go` defines typed request/response structs instead of loose maps.
- **Proto tooling:** `be/Makefile` generates Go bindings into `be/proto` using `protoc`, `protoc-gen-go`, `protoc-gen-go-grpc`. Ensure both plugins are installed (`go install ...`).
- **Docker image:** Two-stage `be/Dockerfile` (`golang:1.25.3-alpine` builder → `alpine` runtime). Builds the binary `myapp` and runs it.

---

## Front End (`fe/`)

- **Stack:** Next.js 15 (App Router), TypeScript, Tailwind via `@next/font`, shadcn/ui components.
- **UX:** minimalist two-column layout (`src/app/page.tsx`):
  - Left: positive/negative `Textarea` inputs, Submit button.
  - Right: `AspectRatio` preview showing the current image (defaults to `/placeholder.png`).
- **Networking:** `fetch` to `NEXT_PUBLIC_BASE_URL + /generateimage`, expecting binary response. Converts to `Blob`, creates `blob:` URL, assigns to `<Image>`.
- **Env:** define `NEXT_PUBLIC_BASE_URL` (e.g., `http://localhost:8080`) in `.env` so the client knows where to POST.
- **Running dev server:** `npm install`, then `npm run dev`. When running inside Compose, the Node container handles installation and serves on `FE_PORT`.
- **shadcn/ui:** components pulled via `npx shadcn@latest add ...` (e.g., `button`, `textarea`, `label`, `aspect-ratio`, `separator`).

---

## Configuration & Environment

Root `.env` (consumed by Compose + services):

```dotenv
APP_ENV=dev
API_PORT=8080
RPC_PEER=py
RPC_PORT=50051
PY_PORT=50051
PY_MODEL_PATH=/workspace/models/sd_xl_base_1.0.safetensors
MODEL_MOUNT_PATH=/workspace/models
FE_PORT=3000
NEXT_PUBLIC_BASE_URL=http://localhost:8080
```

Adjust the model path or hostnames as needed. The Go service also reads `config/config.yaml`, which references these env vars via `${VAR}` interpolation.

---

## Running Everything with Docker Compose

1. Ensure Docker (with GPU runtime if you want CUDA) is available.
2. Place your `.safetensors` model inside `py/models/`.
3. From repo root, run:

```bash
docker compose up --build
```

- **py** – builds from `py/Dockerfile`, mounts your source + model folder, runs `python main.py`.
- **be** – builds from `be/Dockerfile` and exposes `API_PORT`.
- **fe** – uses `node:20`, installs deps, runs `npm run dev` on `FE_PORT`.

Visit `http://localhost:3000` to use the UI. Requests flow through Go → Python and back as described earlier.

To stop:

```bash
docker compose down
```

Add `-v` if you want to drop the `node_modules` named volume.

---

## Developing Services Individually

### Python
```bash
cd py
pip install -r requirements.txt
python main.py
```
Or open VS Code, run “Dev Containers: Reopen in Container”, and you’ll get a CUDA-ready shell.

### Go API
```bash
cd be
go run ./cmd/server
```
Ensure `.env` and `config/config.yaml` point to a reachable Python worker.

### Front End
```bash
cd fe
npm install
npm run dev
```

---

## Regenerating Protos

- **Python:** `make -C py generate_proto`
  - Generates `img_service_pb2.py`, `_grpc.py`, and `.pyi` typing stubs under `py/proto`.
- **Go:** `make -C be generate_proto`
  - Emits `image_service.pb.go` and `image_service_grpc.pb.go` into `be/proto`.

Keep the proto definitions harmonized between languages (currently duplicated in both `py/proto/img_service.proto` and `be/proto/image_service.proto`; consider centralizing later).

---

## API Reference

### HTTP (Go API)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/health` | Returns `{ "status": 200, "timestamp": <unix> }`. |
| `POST` | `/generateimage` | Body: `{ "positivePrompt": "...", "negativePrompt": "..." }`. Response: `image/png` bytes, `Content-Disposition: inline; filename=sdxl.png`. On error, JSON `{ "error": "...", "message": "..." }`. |

### gRPC (Python worker)

```proto
service ImageService {
  rpc GenerateImage (GenerateImageRequest) returns (GenerateImageResponse);
}

message GenerateImageRequest {
  string positive_prompt = 1;
  string negative_prompt = 2;
}

message GenerateImageResponse {
  bytes image = 1;
  string mime_type = 2;
  string filename_hint = 3;
}
```

---

## Tips & Next Steps

- **Model path & caching:** The SDXL model loads at startup; ensure GPU memory is sufficient. Consider exposing settings (height, steps, guidance scale) via env or request fields.
- **Error handling:** The Go API currently sends the same error message for parse/RPC failures. Add better HTTP codes and logging as you iterate.
- **Security:** Everything runs insecure (plain gRPC, no auth). Before exposing externally, add TLS for both gRPC and HTTP plus input validation/rate limits.
- **Persistence:** If you want to save generated images, either upload to object storage (S3, GCS) or stream to a `static/` folder and return URLs instead of bytes.
- **Testing:** Add unit tests (py: pytest for model wrapper, go: `go test ./...`, fe: Playwright/React Testing Library) when ready.
- **CI/CD:** Compose makes it easy to deploy locally; consider GH Actions to build each image and push to a registry.

Enjoy experimenting with SDXL on your DGX Spark while learning the entire stack—from GPU inference and gRPC to Fiber APIs and Next.js UI. Have fun extending it!
