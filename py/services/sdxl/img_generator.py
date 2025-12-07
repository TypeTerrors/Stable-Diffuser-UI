import io
import torch
from diffusers import StableDiffusionXLPipeline

def generate_image(neg_prompt: str, pos_prompt: str) -> tuple[bytes, str, str]: # add type response later
    pipe = StableDiffusionXLPipeline.from_single_file(
        "../../models/sd_xl_base_1.0.safetensors",
        torch_dtype=torch.float16,
    ).to("cuda")

    pipe.load_textual_inversion()

    image = pipe(
        height=1024,
        width=1024,
        prompt=pos_prompt,
        negative_prompt=neg_prompt,
        num_inference_steps=30,
        guidance_scale=7,
    ).images[0]

    buf = io.BytesIO()
    image.save(buf, format="png")
    return buf.getvalue(), "image/png", "sdxl.png"