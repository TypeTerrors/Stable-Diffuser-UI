import os
from pathlib import Path

from .model_loader import SDXLModel

def generate_image(neg_prompt: str, pos_prompt: str) -> tuple[bytes, str, str]: # add type response later
    model_path = os.getenv(
        "MODEL_PATH",
        str(Path(__file__).resolve().parents[2] / "models"),
    )
    model = SDXLModel(model_path)
    return model.generate_image(positive_prompt=pos_prompt, negative_prompt=neg_prompt)
