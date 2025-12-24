import io
import json
import os
import logging
from pathlib import Path
from typing import Any

import torch
from diffusers import DiffusionPipeline, StableDiffusionXLPipeline

logger = logging.getLogger(__name__)

class SDXLModel:
    def __init__(self, model_path: str, device: str = "cuda"):
        self._path = Path(model_path)
        self._model_index = self._read_model_index(self._path)
        self._pipeline_class_name = (self._model_index or {}).get("_class_name")
        self._is_zimage = self._pipeline_class_name == "ZImagePipeline"

        self.pipe = self._load_pipeline(self._path, device=device)
        self._load_loras()

        self._prompt_chunking = (os.getenv("MODEL_PROMPT_CHUNKING") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self._compel = None
        if self._prompt_chunking and not self._is_zimage:
            self._compel = self._build_sdxl_compel()

        self._default_steps = 9 if self._is_zimage else 30
        self._default_guidance = 0.0 if self._is_zimage else 7.0
        self._default_filename = "z-image.png" if self._is_zimage else "sdxl.png"

    @staticmethod
    def _read_model_index(path: Path) -> dict[str, Any] | None:
        if not path.is_dir():
            return None
        index_path = path / "model_index.json"
        if not index_path.exists():
            return None
        return json.loads(index_path.read_text(encoding="utf-8"))

    @classmethod
    def _load_pipeline(cls, path: Path, device: str):
        if not path.exists():
            raise FileNotFoundError(path)

        if path.is_file():
            return StableDiffusionXLPipeline.from_single_file(
                path,
                torch_dtype=torch.float16,
            ).to(device)

        model_index = cls._read_model_index(path) or {}
        is_zimage = model_index.get("_class_name") == "ZImagePipeline"
        dtype = torch.bfloat16 if is_zimage else torch.float16

        kwargs: dict[str, Any] = {"torch_dtype": dtype, "local_files_only": True}
        if is_zimage:
            kwargs["low_cpu_mem_usage"] = False

        return DiffusionPipeline.from_pretrained(path, **kwargs).to(device)

    def _load_loras(self) -> None:
        specs = (os.getenv("MODEL_LORAS") or "").strip()
        single = (os.getenv("MODEL_LORA_PATH") or "").strip()
        if not specs and not single:
            return

        if single and not specs:
            specs = single

        adapter_names: list[str] = []
        adapter_scales: list[float] = []

        for idx, raw in enumerate([s.strip() for s in specs.split(",") if s.strip()]):
            if "@" in raw:
                raw_path, raw_scale = raw.rsplit("@", 1)
                scale = float(raw_scale)
            else:
                raw_path, scale = raw, float(os.getenv("MODEL_LORA_SCALE", "1.0"))

            lora_path = Path(raw_path)
            if lora_path.suffix != ".safetensors":
                raise ValueError(f"LoRA must be a .safetensors file: {raw_path}")

            adapter_name = f"lora_{idx}_{lora_path.stem}"
            self.pipe.load_lora_weights(
                str(lora_path.parent),
                weight_name=lora_path.name,
                adapter_name=adapter_name,
            )
            adapter_names.append(adapter_name)
            adapter_scales.append(scale)

        if hasattr(self.pipe, "set_adapters"):
            self.pipe.set_adapters(adapter_names, adapter_weights=adapter_scales)

        logger.info("Loaded %d LoRA(s): %s", len(adapter_names), ", ".join(adapter_names))

    def _build_sdxl_compel(self):
        from compel import Compel, ReturnedEmbeddingsType

        return Compel(
            tokenizer=[self.pipe.tokenizer, self.pipe.tokenizer_2],
            text_encoder=[self.pipe.text_encoder, self.pipe.text_encoder_2],
            returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
            requires_pooled=[False, True],
            truncate_long_prompts=False,
        )

    def generate_image(self, positive_prompt: str, negative_prompt: str):
        height = int(os.getenv("MODEL_HEIGHT", "1024"))
        width = int(os.getenv("MODEL_WIDTH", "1024"))
        steps = int(os.getenv("MODEL_NUM_INFERENCE_STEPS", str(self._default_steps)))
        guidance = float(os.getenv("MODEL_GUIDANCE_SCALE", str(self._default_guidance)))

        if self._is_zimage:
            image = self.pipe(
                prompt=positive_prompt,
                height=height,
                width=width,
                num_inference_steps=steps,
                guidance_scale=guidance,
            ).images[0]
        else:
            if self._compel is not None:
                prompt_embeds, pooled_prompt_embeds = self._compel(positive_prompt)
                negative_prompt_embeds, negative_pooled_prompt_embeds = self._compel(
                    negative_prompt
                )
                image = self.pipe(
                    prompt_embeds=prompt_embeds,
                    pooled_prompt_embeds=pooled_prompt_embeds,
                    negative_prompt_embeds=negative_prompt_embeds,
                    negative_pooled_prompt_embeds=negative_pooled_prompt_embeds,
                    height=height,
                    width=width,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                ).images[0]
            else:
                image = self.pipe(
                    prompt=positive_prompt,
                    negative_prompt=negative_prompt,
                    height=height,
                    width=width,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="png")
        return buf.getvalue(), "image/png", self._default_filename
