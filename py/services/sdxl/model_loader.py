from diffusers import StableDiffusionXLPipeline
import torch
import io
from pathlib import Path

class SDXLModel:
    def __init__(self, weights_path: str, device: str = "cuda"):
        weights = Path(weights_path)
        if not weights.exists():
            raise FileNotFoundError(weights)

        self.pipe = (
            StableDiffusionXLPipeline.from_single_file(
                weights,
                torch_dtype=torch.float16,
            )
            .to(device)
            .eval()
        )
        self.pipe.load_textual_inversion()

    def generate_image(self, positive_prompt: str, negative_prompt: str):
        image = self.pipe(
            height=1024,
            width=1024,
            prompt=positive_prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=30,
            guidance_scale=7,
        ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="png")
        return buf.getvalue(), "image/png", "sdxl.png"