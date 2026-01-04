# img-generator

Bring your own **Stable Diffusion XL** checkpoint + **LoRAs**, then generate images from a clean web UI.

This repo is a full‑stack playground that intentionally splits responsibilities:
- **`py/`** does the heavy GPU inference (Diffusers + SDXL) behind a **gRPC** boundary.
- **`be/`** is a small **Go + Fiber** HTTP API that talks to the worker over gRPC.
- **`fe/`** is a **Next.js** UI (shadcn/ui) that lets you pick a model/LoRAs and prompt for images.

If you want a practical template for “GPU worker + typed RPC + web UI”, you’re in the right place.

---

## What You Can Do

- Browse available `.safetensors` **models** and **LoRAs** from the UI.
- **Apply** a base model, then **stack LoRAs** with weights.
- Generate an image from a **positive** and **negative** prompt (API returns a raw PNG).

---

## Architecture (High Level)

```
Browser (Next.js UI)
  | HTTP (JSON + PNG bytes)
  v
Go API (Fiber)
  | gRPC (typed calls)
  v
Python Worker (Diffusers SDXL on GPU)
```

The Go API also **scans the mounted model/LoRA folders on disk** to populate the UI pickers.

---

## Quickstart (Docker Compose)

### Prerequisites

- Docker + Docker Compose v2
- An NVIDIA GPU machine for the Python worker (Linux + NVIDIA Container Toolkit)
- At least one **SDXL `.safetensors` checkpoint** (not included)

### 1) Put model files in place

```bash
mkdir -p py/models py/loras
```

- Put SDXL checkpoints in `py/models/` (example: `py/models/sdxl/sd_xl_base_1.0.safetensors`)
- Put LoRAs in `py/loras/sdxl` (optional)

### 2) Create a root `.env`

Copy the example env file, then tweak if needed:

```bash
cp .env.example .env
```

`./.env` is ignored by git via `*.env` in `.gitignore`. `./.env.example` is committed and looks like:

```dotenv
# App mode
APP_ENV=dev

# Go API (HTTP)
API_PORT=8080
API_ALLOWED_ORIGINS=http://localhost:3000

# Python worker (gRPC)
RPC_PEER=py
RPC_PORT=50051
PY_PORT=50051

# Container paths used by the Go API to discover files (also used for volume mounts)
MODEL_MOUNT_PATH=/workspace/models
LORA_MOUNT_PATH=/workspace/loras

# Frontend
FE_PORT=3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080

# Optional tuning
IMG_GEN_MAX_PROMPT_CHUNKS=128

# Optional / reserved
PY_MODEL_PATH=
NEXT_PUBLIC_BASE_URL=http://localhost:8080
```

Notes:
- `RPC_PEER=py` is important inside Compose (it’s the service name).
- The UI reads `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_BASE_URL` is currently unused by the UI (it’s kept to match `docker-compose.yaml`).
- The worker does **not** auto-load a model at startup — you must apply one from the UI (or call `/setmodel`).

### 3) Run everything

```bash
docker compose up --build
```

Open `http://localhost:3000` (or `http://localhost:$FE_PORT`) and:
1. Click “Refresh data” (top right).
2. Select a model → “Apply model”.
3. (Optional) Add LoRAs, adjust weights → “Apply LoRAs”.
4. Enter prompts → “Generate”.

Stop services:

```bash
docker compose down
```

---

## Services (How Each One Works)

### `fe/` — Frontend (Next.js)

- **Tech:** Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui
- **What it does:** Calls the Go API to list/apply models + LoRAs, then posts prompts to generate images.
- **Config:** `NEXT_PUBLIC_API_BASE_URL` (example `http://localhost:8080`)
- **Key file:** `fe/src/app/page.tsx`

Run locally:

```bash
cd fe
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev
```

### `be/` — Go HTTP API (Fiber)

- **Tech:** Go + Fiber, gRPC client to the Python worker
- **What it does:**
  - Exposes HTTP endpoints used by the UI
  - Proxies model/LoRA actions + generation to the Python worker via gRPC
  - Lists files by walking `MODEL_MOUNT_PATH` and `LORA_MOUNT_PATH`
- **Config file:** `be/config/config.yaml` (env interpolation via `gonfig`)

Run locally (example when the Python worker is on your machine):

```bash
cd be
RPC_PEER=localhost RPC_PORT=50051 API_PORT=8080 API_ALLOWED_ORIGINS=http://localhost:3000 go run ./cmd/server
```

### `py/` — Python gRPC Worker (Diffusers SDXL)

- **Tech:** `diffusers`, `torch`, `transformers`, `peft`, `grpcio`
- **What it does:**
  - Runs a gRPC server on `:50051`
  - Loads an SDXL checkpoint when you call `SetModel`
  - Generates a PNG for `GenerateImage`
  - Applies LoRAs via PEFT/Diffusers (`SetLora`)
- **Important:** The worker currently calls `.to("cuda")` when loading a model, so it expects CUDA/GPU.
- **Prompt length:** Long prompts are chunked; cap is controlled by `IMG_GEN_MAX_PROMPT_CHUNKS` (default `128`).
- **Key file:** `py/services/grpc/image_service.py`

Run locally:

```bash
cd py
pip install -r requirements.txt
python main.py
```

---

## HTTP API (Go Service)

Base URL: `http://localhost:$API_PORT`

| Method | Path | What it does |
| ------ | ---- | ------------ |
| `GET`  | `/health` | Status + timestamp JSON |
| `GET`  | `/models` | Lists `.safetensors` under `MODEL_MOUNT_PATH` |
| `GET`  | `/loras` | Lists `.safetensors` under `LORA_MOUNT_PATH` |
| `GET`  | `/currentmodel` | Current model loaded in the Python worker |
| `GET`  | `/currentloras` | Current LoRAs applied in the Python worker |
| `POST` | `/setmodel` | Loads a model in the Python worker |
| `POST` | `/setloras` | Applies LoRAs (array of `{ path, weight }`) |
| `POST` | `/clearmodel` | Unloads model + clears LoRAs |
| `POST` | `/clearloras` | Clears LoRAs |
| `POST` | `/generateimage` | Generates a PNG (binary response) |

Examples:

```bash
# Health
curl http://localhost:8080/health

# List models / loras
curl http://localhost:8080/models
curl http://localhost:8080/loras

# Apply a model (use a path returned by /models)
curl -X POST http://localhost:8080/setmodel \
  -H 'Content-Type: application/json' \
  -d '{"modelPath":"/workspace/models/sdxl/sd_xl_base_1.0.safetensors"}'

# Apply LoRAs
curl -X POST http://localhost:8080/setloras \
  -H 'Content-Type: application/json' \
  -d '[{"path":"/workspace/loras/sdxl/my_lora.safetensors","weight":0.8}]'

# Generate an image (writes a PNG file)
curl -X POST http://localhost:8080/generateimage \
  -H 'Content-Type: application/json' \
  -d '{"positivePrompt":"a cinematic portrait photo","negativePrompt":"blurry"}' \
  --output out.png
```

---

## gRPC API (Python Worker)

The shared contract lives in:
- `py/proto/img_service.proto`
- `be/proto/image_service.proto`

The worker implements:
- `GenerateImage`
- `SetModel`, `GetCurrentModel`, `ClearModel`
- `SetLora`, `GetCurrentLoras`, `ClearLoras`

---

## Developing / Contributing

### Working on the whole app

- Run infra with Compose: `docker compose up --build`
- UI changes hot-reload via the `fe/` bind mount.
- Python changes are mounted into the container; restart the `py` service to pick them up.
- Go API changes require rebuilding the image (or run the Go service locally while the others run in Compose).

### Regenerating protobufs

If you change a `.proto`, regenerate both sides:

```bash
make -C py generate_proto
make -C be generate_proto
```

Go generation requires `protoc` to be installed. The Go `Makefile` installs the plugins into `be/.bin/`.

### Adding a feature (suggested path)

1. Decide where it belongs: UI (`fe/`), HTTP API (`be/`), worker (`py/`), or the shared `.proto`.
2. If you add a new worker capability, prefer adding it to the proto first, then thread it through Go → UI.
3. Keep the happy-path runnable via `docker compose up --build`.

---

## Troubleshooting

- “Model must be set before generating images.” → Apply a model in the UI or call `POST /setmodel` first.
- CORS errors in the browser → set `API_ALLOWED_ORIGINS` to match your UI origin (default `http://localhost:3000`).
- `CUDA` / GPU errors in `py` → verify NVIDIA drivers + Container Toolkit; the worker loads models with `.to("cuda")`.
- “Model not found” when setting a model → use the exact path returned by `GET /models` (those are paths inside the containers).

---

## Safety Notes

This project is a local playground:
- No auth, no TLS, and minimal input validation.
- Don’t expose it to the public internet without hardening.
