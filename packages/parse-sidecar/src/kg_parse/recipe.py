"""Recipe validation and canonical hashing.

A recipe is a parse recipe: {"kind": "parse", "version": "1", "spec": {...}}. The parse
options map onto docling's PdfPipelineOptions, except `page_range`, which is passed to
DocumentConverter.convert. `spec.formulaDecoding` is only meaningful for decode-formulas.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from docling.datamodel.pipeline_options import PdfPipelineOptions
from importlib.metadata import version as _pkg_version
from pydantic import ValidationError

from .errors import RecipeError

REQUIRED_OPTIONS = ("do_ocr", "do_table_structure", "do_formula_enrichment")
SPEC_KEYS = {"parser", "doclingVersion", "options", "formulaDecoding"}
FORMULA_DECODING_KEYS = ("model", "revision", "prompt", "cropMargin")
SIDECAR_ONLY_OPTIONS = {"page_range"}


def installed_docling_version() -> str:
    return _pkg_version("docling")


def canonical_json(obj: Any) -> str:
    """Stable serialization used for recipe hashes: sorted keys, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def recipe_hash(recipe: dict) -> str:
    return hashlib.sha256(canonical_json(recipe).encode("utf-8")).hexdigest()


def without_formula_decoding(recipe: dict) -> dict:
    spec = {k: v for k, v in recipe["spec"].items() if k != "formulaDecoding"}
    return {**recipe, "spec": spec}


def validate_recipe(recipe: Any) -> dict:
    """Structural and semantic checks. Raises RecipeError; returns the recipe unchanged."""
    if not isinstance(recipe, dict):
        raise RecipeError("recipe must be a JSON object")
    if recipe.get("kind") != "parse":
        raise RecipeError('recipe.kind must be "parse"')
    if not isinstance(recipe.get("version"), str) or not recipe["version"]:
        raise RecipeError("recipe.version must be a non-empty string")
    spec = recipe.get("spec")
    if not isinstance(spec, dict):
        raise RecipeError("recipe.spec must be an object")
    unknown_spec = set(spec) - SPEC_KEYS
    if unknown_spec:
        raise RecipeError(f"unknown spec keys: {sorted(unknown_spec)}")
    if spec.get("parser") != "docling":
        raise RecipeError('spec.parser must be "docling"')
    if not isinstance(spec.get("doclingVersion"), str) or not spec["doclingVersion"]:
        raise RecipeError("spec.doclingVersion must be a non-empty string")
    options = spec.get("options")
    if not isinstance(options, dict):
        raise RecipeError("spec.options must be an object")
    for key in REQUIRED_OPTIONS:
        if key not in options:
            raise RecipeError(f"spec.options.{key} is required")
    if options["do_formula_enrichment"] is not False:
        raise RecipeError("spec.options.do_formula_enrichment must be false (formulas are decoded by decode-formulas)")
    if "formulaDecoding" in spec:
        _validate_formula_decoding(spec["formulaDecoding"])
    build_pipeline_options(recipe)  # unknown options and bad values raise here
    return recipe


def _validate_formula_decoding(fd: Any) -> None:
    if not isinstance(fd, dict):
        raise RecipeError("spec.formulaDecoding must be an object")
    if set(fd) != set(FORMULA_DECODING_KEYS):
        raise RecipeError(f"spec.formulaDecoding must have exactly the keys {list(FORMULA_DECODING_KEYS)}")
    for key in ("model", "revision", "prompt"):
        if not isinstance(fd[key], str) or not fd[key]:
            raise RecipeError(f"spec.formulaDecoding.{key} must be a non-empty string")
    margin = fd["cropMargin"]
    if isinstance(margin, bool) or not isinstance(margin, (int, float)) or not 0 <= margin <= 1:
        raise RecipeError("spec.formulaDecoding.cropMargin must be a number in [0, 1]")


def check_docling_version(recipe: dict) -> None:
    installed = installed_docling_version()
    if recipe["spec"]["doclingVersion"] != installed:
        raise RecipeError(
            f"recipe pins docling {recipe['spec']['doclingVersion']} but {installed} is installed"
        )


def page_range_of(recipe: dict) -> tuple[int, int] | None:
    raw = recipe["spec"]["options"].get("page_range")
    if raw is None:
        return None
    if (
        not isinstance(raw, list)
        or len(raw) != 2
        or not all(isinstance(x, int) and not isinstance(x, bool) for x in raw)
        or not 1 <= raw[0] <= raw[1]
    ):
        raise RecipeError("spec.options.page_range must be [first, last] with 1 <= first <= last")
    return (raw[0], raw[1])


def build_pipeline_options(recipe: dict) -> PdfPipelineOptions:
    """Map recipe options onto PdfPipelineOptions. Unknown names are an error (pydantic would ignore them)."""
    options = {k: v for k, v in recipe["spec"]["options"].items() if k not in SIDECAR_ONLY_OPTIONS}
    unknown = set(options) - set(PdfPipelineOptions.model_fields)
    if unknown:
        raise RecipeError(f"unknown docling option(s): {sorted(unknown)}")
    page_range_of(recipe)
    try:
        return PdfPipelineOptions(**options)
    except ValidationError as exc:
        raise RecipeError(f"invalid docling option: {exc}") from exc


def load_recipe(path) -> dict:
    with open(path, encoding="utf-8") as fh:
        try:
            recipe = json.load(fh)
        except json.JSONDecodeError as exc:
            raise RecipeError(f"{path} is not valid JSON: {exc}") from exc
    return validate_recipe(recipe)
