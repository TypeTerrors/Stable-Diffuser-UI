# TypeTerrors Frontend

Next.js App Router UI for the local media generation stack.

## What It Talks To

Set `NEXT_PUBLIC_API_BASE_URL` to the Go API, usually:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

The UI calls the Go service for:

- model and LoRA catalog scans
- model, LoRA, and LLM model selection
- Civitai model downloads by model version ID
- image generation and video generation through `/generatemedia`
- WebSocket notifications for downloads and streamed LLM responses

## Main Routes

- `/` - workflow chooser
- `/image` - model/LoRA management plus text-to-image, text-to-video, and image-to-video controls
- `/llm` - redirects to a session-scoped chat route
- `/llm/[username]` - streamed LLM conversation UI

## Run Locally

```bash
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev
```
