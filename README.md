# img-generator

AI-assisted playground that ties together a Python diffusion worker (text-to-image + image-to-video), a Go API, and a Next.js + shadcn/ui front end. The goal is run heavy PyTorch inference on a DGX Spark GPU box while getting gRPC, Fiber, and modern Next.js applications to cooperate with eachother.

---

## Quick Tour

| Folder | Purpose |
| ------ | ------- |
| `py/`  | Python inference worker (text-to-image + image-to-video) exposed over gRPC. Includes a devcontainer for GPU-friendly editing. |
| `be/`  | Go microservice (Fiber + gRPC client). Calls the Python worker, streams bytes back over HTTP, and houses shared config/proto tooling. |
| `fe/`  | Next.js 16 (App Router, TypeScript, Tailwind, shadcn/ui). Provides the prompt form and preview panel, fetching from the Go API. |
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
│   ├── services/grpc/             # gRPC servicer + server
│   ├── services/models/           # Model loaders (text-to-image, image-to-video)
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
[Next.js FE] --HTTP--> [Go API (Fiber)] --gRPC--> [Python worker]
      ^                 |      ^                     |
      |                 |      |                     |
      |     /generateimage      |      GenerateImage  |
      |  (image/png bytes)      |                     |
      |                 |      |                     |
      |  /generateimagetovideo  |  GenerateImageToVideo
      |   (video/mp4 bytes)     |                     |
      +-------------------------+---------------------+
```

1. **Frontend** calls the Go API over HTTP.
2. **Go API** calls the Python worker via gRPC (`InferenceService`) and streams bytes back to the browser.
3. **Python worker** loads models once at startup and serves:
   - Text-to-image → returns PNG bytes
   - Image-to-video → returns MP4 bytes

---

## Python Service (`py/`)

- **Runtime:** NVIDIA’s `nvcr.io/nvidia/pytorch:25.09-py3` base image, CUDA-ready.
- **Entry point:** `python main.py` → `services.grpc.server.serve()`.
- **Key code paths:**
  - `services/models/text_to_image.py` – text-to-image model loading and caching (`self.pipe`).
  - `services/models/image_to_video.py` – image-to-video model loading + MP4 encoding (PyAV).
  - `services/grpc/image_service.py` – gRPC servicer that calls the cached model.
  - `proto/img_service.proto` – shared proto definition (request prompts + response bytes/mime/filename).
- **Dependencies:** pinned in `py/requirements.txt` (`torch`, `diffusers`, `grpcio`, `grpcio-tools`, `mypy-protobuf`, plus `pillow`/`numpy`/`av` for image/video handling).
- **Proto generation:** `make -C py generate_proto` uses `grpcio-tools` with `--mypy_out` to emit `.py` and `.pyi` stubs under `py/proto`.
- **Devcontainer:** `py/.devcontainer` builds the NVIDIA base image, binds the repo into `/workspace`, and enables GPU access inside VS Code.
- **Models:**
  - Text-to-image uses `TEXT_TO_IMAGE_MODEL_PATH` (or falls back to `MODEL_PATH` for compatibility). This can be a single `.safetensors` file or a local Diffusers directory.
  - Image-to-video uses `IMAGE_TO_VIDEO_MODEL_PATH` (or `I2V_MODEL_PATH`). This should be a Diffusers directory (not a single file).
  - The compose file mounts `./py/models` into `${MODEL_MOUNT_PATH}` (default `/workspace/models:ro`) so you can reference either model by an in-container path.
- **Long prompts (SDXL/CLIP):** CLIP encoders cap at 77 tokens. To avoid truncation on SDXL checkpoints, set `MODEL_PROMPT_CHUNKING=1` (uses `compel` to chunk prompts into embeddings).
- **Chunking mode:** optionally set `MODEL_PROMPT_SPLIT_MODE=brutal|words|phrases|sentences` (default `brutal`, best for very long prompts).

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
  - `POST /generateimagetovideo` – accepts `imageBytes` (base64), `positivePrompt`, `negativePrompt`, delegates to RPC, streams binary response.
- **RPC wrapper:** `internal/dependencies/rpc.go`
  - Dials Python once, exposes `GenerateImage` and `GenerateImageToVideo`, handles close via `Rpc.Close()`.
- **DTOs:** `be/types/api.go` defines typed request/response structs instead of loose maps.
- **Proto tooling:** `be/Makefile` generates Go bindings into `be/proto` using `protoc`, `protoc-gen-go`, `protoc-gen-go-grpc`. Ensure both plugins are installed (`go install ...`).
- **Docker image:** Two-stage `be/Dockerfile` (`golang:1.25.3-alpine` builder → `alpine` runtime). Builds the binary `myapp` and runs it.

---

## Front End (`fe/`)

- **Stack:** Next.js 16 (App Router), TypeScript, Tailwind, shadcn/ui components.
- **Pages:**
  - `/` – service chooser
  - `/text-to-image` – prompts + image preview (includes loading spinner)
  - `/image-to-video` – upload image + prompts (left), video preview (right, includes loading spinner)
- **Networking:**
  - Text-to-image calls `POST ${NEXT_PUBLIC_API_BASE_URL}/generateimage`, expects `image/png` bytes.
  - Image-to-video calls `POST ${NEXT_PUBLIC_API_BASE_URL}/generateimagetovideo`, expects `video/mp4` bytes and sends `imageBytes` as base64 (because Go’s `[]byte` JSON decoding expects base64).
- **Env:** define `NEXT_PUBLIC_API_BASE_URL` (e.g., `http://localhost:8090`) so the browser knows where to POST.
- **Running dev server:** `npm install`, then `npm run dev`. When running inside Compose, the Node container handles installation and serves on `FE_PORT`.
- **shadcn/ui:** components pulled via `npx shadcn@latest add ...` (e.g., `button`, `textarea`, `label`, `aspect-ratio`, `separator`).

---

## Configuration & Environment

Root `.env` (consumed by Compose + services):

Start by copying the example:

```bash
cp .env.example .env
```

```dotenv
APP_ENV=dev
API_PORT=8090
API_ALLOWED_ORIGINS=*
RPC_PEER=py
RPC_PORT=50051
PY_PORT=50051
# Optional: gRPC tuning (video inference can take a long time)
RPC_DIAL_TIMEOUT=240s
RPC_T2I_TIMEOUT=240s
RPC_I2V_TIMEOUT=30m
RPC_MAX_MSG_SIZE_MB=256
# Used by docker-compose to set the container's MODEL_PATH (text-to-image fallback).
PY_MODEL_PATH=/workspace/models/<your-txt2img-model>.safetensors
# Optional: override text-to-image model path (otherwise uses MODEL_PATH).
TEXT_TO_IMAGE_MODEL_PATH=
# Optional: enable image-to-video by pointing at a Diffusers model directory.
IMAGE_TO_VIDEO_MODEL_PATH=/workspace/models/<your-i2v-model-dir>
MODEL_MOUNT_PATH=/workspace/models
FE_PORT=3002
NEXT_PUBLIC_BASE_URL=http://localhost:8090
NEXT_PUBLIC_API_BASE_URL=http://localhost:8090
```

Adjust the model path/ports as needed. When running outside of Compose, set `RPC_PEER=localhost` (Compose uses `py` because that’s the service DNS name on the Compose network). The Go service also reads `config/config.yaml`, which references these env vars via `${VAR}` interpolation.

---

## Running Everything with Docker Compose

1. Ensure Docker (with GPU runtime if you want CUDA) is available.
2. Create your local `.env` from the example: `cp .env.example .env`.
3. Place your text-to-image weights under `py/models/` (either a `.safetensors` file or a Diffusers directory).
4. (Optional i2v) Place your image-to-video Diffusers directory under `py/models/` and set `IMAGE_TO_VIDEO_MODEL_PATH` in `.env`.
5. From repo root, run:

```bash
docker compose up --build
```

- **py** – builds from `py/Dockerfile`, mounts your source + model folder, runs `python main.py`.
- **be** – builds from `be/Dockerfile` and exposes `API_PORT`.
- **fe** – uses `node:20`, installs deps, runs `npm run dev` on `FE_PORT`.

Visit `http://localhost:<FE_PORT>` (default `http://localhost:3002`) to use the UI. Requests flow through Go → Python and back as described earlier.

To stop:

```bash
docker compose down
```

Add `-v` if you want to drop the `node_modules` named volume.

---

## Development Guide (Local + Adding Features)

### Create a new feature branch

```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c feat/<short-name>
```

When you’re ready to open a PR:

```bash
git push -u origin feat/<short-name>
```

### Local development options

- **Option A (simplest end-to-end):** `docker compose up --build`
  - Compose is the easiest way to run the full stack together (and is the most realistic setup for GPU inference).
  - If you change Go code in `be/`, you’ll generally need to rebuild that image: `docker compose up --build be`.
- **Option B (fast iteration on FE/BE):** run Python in Docker, run Go + Next.js on your host.
  1. Start the Python worker:
     - `docker compose up --build py`
  2. Run the Go API locally (note the `.env` path is relative to `be/`):
     - `cp be/.env.example be/.env` then set `RPC_PEER=localhost` (keep `RPC_PORT=50051`, and set `API_PORT` to whatever your FE points at).
     - `cd be && go run ./cmd/server`
  3. Run the Next.js dev server locally:
     - Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:<API_PORT>` (either in `fe/.env.local` or in your shell).
     - `cd fe && npm install && npm run dev`

### Changing the gRPC API (and generating code)

The proto definition is currently duplicated in two places:
- `py/proto/img_service.proto`
- `be/proto/image_service.proto`

After changing the proto(s), regenerate code:

```bash
make -C py generate_proto
make -C be generate_proto
```

Notes:
- Python generation uses `grpcio-tools` (installed via `py/requirements.txt`).
- Go generation requires `protoc` plus `protoc-gen-go` and `protoc-gen-go-grpc` (the `be/Makefile` will `go install` the plugins if they’re missing).

### Where to add new features

- **Front end (`fe/`)**: routes are in `fe/src/app/page.tsx`, `fe/src/app/text-to-image/page.tsx`, and `fe/src/app/image-to-video/page.tsx`; shared API helpers in `fe/src/lib/api.ts`.
- **Go API (`be/`)**: routes + handlers in `be/internal/services/api.go` and `be/internal/services/api_handlers.go`; request/response DTOs in `be/types/`.
- **Python worker (`py/`)**: gRPC servicer in `py/services/grpc/image_service.py`; model loaders in `py/services/models/`.

## Developing Services Individually

### Python
```bash
cd py
pip install -r requirements.txt
PYTHONDONTWRITEBYTECODE=1 python main.py
```
Or open VS Code, run “Dev Containers: Reopen in Container”, and you’ll get a CUDA-ready shell.

If you’ve run the Python service via Docker with a bind mount and then switch back to running locally, you may hit `Permission denied` writing `__pycache__` files (created as `root`). Fix by deleting the `__pycache__` folders or `chown`-ing them back to your user.

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
  - The `py/Makefile` also patches the generated `_grpc.py` import so it works when importing via the `proto` package.
- **Go:** `make -C be generate_proto`
  - Emits `image_service.pb.go` and `image_service_grpc.pb.go` into `be/proto`.
  - The `be/Makefile` installs `protoc` plugins into `be/.bin/` so generation works even if `protoc-gen-go` isn’t on your PATH.

Keep the proto definitions harmonized between languages (currently duplicated in both `py/proto/img_service.proto` and `be/proto/image_service.proto`; consider centralizing later).

---

## API Reference

### HTTP (Go API)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/health` | Returns `{ "status": 200, "timestamp": <unix> }`. |
| `POST` | `/generateimage` | Body: `{ "positivePrompt": "...", "negativePrompt": "..." }`. Response: `image/png` bytes. |
| `POST` | `/generateimagetovideo` | Body: `{ "imageBytes": "<base64>", "positivePrompt": "...", "negativePrompt": "..." }`. Response: `video/mp4` bytes. |

### gRPC (Python worker)

```proto
service InferenceService {
  rpc GenerateImage (GenerateImageRequest) returns (GenerateImageResponse);
  rpc GenerateImageToVideo (GenerateImageToVideoRequest) returns (GenerateImageToVideoResponse);
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

message GenerateImageToVideoRequest {
  bytes image = 3;
  string positive_prompt = 1;
  string negative_prompt = 2;
}

message GenerateImageToVideoResponse {
  bytes video = 1;
  string mime_type = 2;
  string filename_hint = 3;
}
```

---

## Tips & Next Steps

- **Model loading & caching:** Models load at startup; ensure GPU memory is sufficient (especially if you enable both text-to-image and image-to-video).
- **Error handling:** The Go API currently sends the same error message for parse/RPC failures. Add better HTTP codes and logging as you iterate.
- **Security:** Everything runs insecure (plain gRPC, no auth). Before exposing externally, add TLS for both gRPC and HTTP plus input validation/rate limits.
- **Persistence:** If you want to save generated images, either upload to object storage (S3, GCS) or stream to a `static/` folder and return URLs instead of bytes.
- **Testing:** Add unit tests (py: pytest for model wrapper, go: `go test ./...`, fe: Playwright/React Testing Library) when ready.
- **CI/CD:** Compose makes it easy to deploy locally; consider GH Actions to build each image and push to a registry.

Enjoy experimenting with SDXL on your DGX Spark while learning the entire stack—from GPU inference and gRPC to Fiber APIs and Next.js UI. Have fun extending it!
