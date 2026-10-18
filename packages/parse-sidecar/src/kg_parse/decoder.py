"""GLM-OCR 4-bit on Apple GPU through mlx-vlm. Imports MLX lazily so the rest of the package works without it."""

from __future__ import annotations

import pathlib
import tempfile

from PIL import Image

from .errors import RecipeError

MAX_TOKENS = 1024


class MlxFormulaDecoder:
    """Loads the model from the local Hugging Face cache at the pinned commit. Never downloads."""

    def __init__(self, model_name: str, revision: str):
        from huggingface_hub import snapshot_download

        try:
            local = snapshot_download(model_name, revision=revision, local_files_only=True)
        except Exception as exc:
            raise RecipeError(
                f"model {model_name} at revision {revision} is not in the local Hugging Face cache"
            ) from exc
        commit = pathlib.Path(local).name
        if commit != revision:
            raise RecipeError(f"revision {revision} resolves to commit {commit}; recipe must pin the full commit hash")

        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config

        self.model_name = model_name
        self.revision = commit
        self._generate = generate
        self._apply_chat_template = apply_chat_template
        self._model, self._processor = load(local)
        self._config = load_config(local)

    def decode(self, image: Image.Image, prompt: str) -> str:
        fmt = self._apply_chat_template(self._processor, self._config, prompt, num_images=1)
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "crop.png"
            image.save(path)
            result = self._generate(
                self._model, self._processor, fmt, [str(path)],
                max_tokens=MAX_TOKENS, temperature=0.0, verbose=False,
            )
        return result.text
