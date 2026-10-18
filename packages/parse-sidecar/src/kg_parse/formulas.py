"""`kg-parse decode-formulas`: decode formula blocks of a parse artifact from its source PDF.

Only the `text` of formula-label items with page and bbox provenance changes, plus `recipe`, `producedAt` and
`stats.undecodedFormulas`. Each formula is cropped from the PDF with the crop rule measured in the formula-VLM
evaluation: page rendered at scale 1.67 with pypdfium2, box expanded by cropMargin times its width (left/right)
and height (top/bottom), clamped to the page. The decoder reply is reduced to bare LaTeX (see `bare_latex`).
"""

from __future__ import annotations

import copy
import pathlib
import re
from typing import Any, Protocol

import pypdfium2 as pdfium
from PIL import Image

from .envelope import count_undecoded_formulas, sha256_file, utc_now_iso
from .errors import RecipeError, SourceMismatchError
from .recipe import validate_recipe, without_formula_decoding

RENDER_SCALE = 1.67
_TAG = re.compile(r"\\tag\{[^{}]*\}")


def bare_latex(raw: str) -> str:
    """Bare LaTeX from a decoder reply: `\\tag{..}` removed, `$$` or `$` delimiters removed, whitespace trimmed."""
    text = _TAG.sub("", raw.strip()).strip()
    for delim in ("$$", "$"):
        if len(text) >= 2 * len(delim) and text.startswith(delim) and text.endswith(delim):
            text = text[len(delim):-len(delim)]
            break
    return text.strip()


class FormulaDecoder(Protocol):
    model_name: str
    revision: str

    def decode(self, image: Image.Image, prompt: str) -> str: ...


def check_decode_inputs(artifact: dict, recipe: dict, pdf: pathlib.Path) -> dict:
    """Return the formulaDecoding block after the exit-3 and exit-4 checks, in the order the CLI reports them."""
    validate_recipe(recipe)
    fd = recipe["spec"].get("formulaDecoding")
    if fd is None:
        raise RecipeError("recipe has no spec.formulaDecoding")
    if artifact.get("recipe") != without_formula_decoding(recipe):
        raise RecipeError("artifact was not produced by this recipe without spec.formulaDecoding")
    actual = sha256_file(pdf)
    if actual != artifact.get("sourceSha256"):
        raise SourceMismatchError(
            f"PDF sha256 {actual} differs from artifact sourceSha256 {artifact.get('sourceSha256')}"
        )
    return fd


def _to_bottomleft(bbox: dict, page_height: float) -> tuple[float, float, float, float]:
    l, r = float(bbox["l"]), float(bbox["r"])
    if bbox.get("coord_origin", "BOTTOMLEFT") == "TOPLEFT":
        t, b = page_height - float(bbox["t"]), page_height - float(bbox["b"])
    else:
        t, b = float(bbox["t"]), float(bbox["b"])
    return l, r, t, b


def crop_formula(pdf, page_no: int, bbox: dict, margin: float, rendered: dict[int, Image.Image]) -> Image.Image:
    """Crop one formula block. `rendered` caches full-page renders for the run (same pixels as rendering per crop)."""
    page = pdf[page_no - 1]
    _, page_height = page.get_size()
    l, r, t, b = _to_bottomleft(bbox, page_height)
    w, h = r - l, t - b
    if w <= 0 or h <= 0:
        raise ValueError("degenerate bounding box")
    l2, r2, t2, b2 = l - margin * w, r + margin * w, t + margin * h, b - margin * h
    if page_no not in rendered:
        rendered[page_no] = page.render(scale=RENDER_SCALE).to_pil().convert("RGB")
    img = rendered[page_no]
    s = RENDER_SCALE
    box = (
        max(0, int(l2 * s)),
        max(0, int((page_height - t2) * s)),
        min(img.width, int(r2 * s)),
        min(img.height, int((page_height - b2) * s)),
    )
    crop = img.crop(box)
    if crop.width == 0 or crop.height == 0:
        raise ValueError("empty crop")
    return crop


def decode_formulas(
    artifact: dict,
    pdf: pathlib.Path,
    recipe: dict,
    decoder: FormulaDecoder,
) -> tuple[dict, dict[str, int]]:
    """Return (new artifact, {"decoded", "failed", "undecoded"}). Inputs are not modified.

    Raises RecipeError if the recipe or decoder does not match, SourceMismatchError if the PDF differs.
    """
    fd = check_decode_inputs(artifact, recipe, pdf)
    if decoder.model_name != fd["model"]:
        raise RecipeError(f"decoder model {decoder.model_name} differs from recipe model {fd['model']}")
    if decoder.revision != fd["revision"]:
        raise RecipeError(f"decoder revision {decoder.revision} differs from recipe revision {fd['revision']}")

    out: dict[str, Any] = copy.deepcopy(artifact)
    out["recipe"] = copy.deepcopy(recipe)
    texts = out["document"]["texts"]
    out["producedAt"] = utc_now_iso()
    decoded = failed = 0
    rendered: dict[int, Image.Image] = {}
    pdf_doc = pdfium.PdfDocument(str(pdf))
    try:
        for item in texts:
            if item.get("label") != "formula":
                continue
            prov = (item.get("prov") or [None])[0]
            if not prov or "page_no" not in prov or "bbox" not in prov:
                continue
            try:
                image = crop_formula(pdf_doc, int(prov["page_no"]), prov["bbox"], float(fd["cropMargin"]), rendered)
                latex = bare_latex(decoder.decode(image, fd["prompt"]))
                if not latex:
                    raise ValueError("empty decoder output")
            except Exception:
                failed += 1
                continue
            item["text"] = latex
            decoded += 1
    finally:
        pdf_doc.close()
    undecoded = count_undecoded_formulas(out["document"])
    out["stats"]["undecodedFormulas"] = undecoded
    return out, {"decoded": decoded, "failed": failed, "undecoded": undecoded}
