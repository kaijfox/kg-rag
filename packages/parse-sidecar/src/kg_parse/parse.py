"""`kg-parse parse`: run docling on a PDF and wrap the DoclingDocument in a kg-parse-artifact/1 envelope."""

from __future__ import annotations

import pathlib
import platform
import time
from collections import Counter
from typing import Any

from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, PdfFormatOption

from . import ARTIFACT_FORMAT, __version__
from .envelope import count_undecoded_formulas, sha256_file, utc_now_iso
from .recipe import build_pipeline_options, check_docling_version, installed_docling_version, page_range_of, validate_recipe


def convert_pdf(pdf: pathlib.Path, recipe: dict):
    """Run docling. Returns (DoclingDocument, elapsed_seconds). Separate so tests can observe the options."""
    opts = build_pipeline_options(recipe)
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    kwargs: dict[str, Any] = {}
    page_range = page_range_of(recipe)
    if page_range is not None:
        kwargs["page_range"] = page_range
    started = time.perf_counter()
    result = converter.convert(str(pdf), **kwargs)
    return result.document, time.perf_counter() - started


def chars_per_page(doc_dict: dict) -> list[int]:
    """Characters of text items per page (texts only; tables and pictures excluded), pages in ascending order."""
    counts: Counter[int] = Counter()
    for item in doc_dict.get("texts", []):
        text = item.get("text") or ""
        for prov in item.get("prov") or []:
            counts[int(prov["page_no"])] += len(text)
    pages = sorted(int(k) for k in doc_dict.get("pages", {}))
    return [counts[p] for p in pages]


def build_envelope(pdf: pathlib.Path, recipe: dict, name: str | None, document, elapsed_s: float) -> dict:
    doc_dict = document.export_to_dict()
    markdown = document.export_to_markdown()
    docling_version = installed_docling_version()
    return {
        "format": ARTIFACT_FORMAT,
        "sourceSha256": sha256_file(pdf),
        "sourceName": name or pdf.name,
        "recipe": recipe,
        "parser": {"name": "docling", "version": docling_version},
        "producedAt": utc_now_iso(),
        "producedOn": f"kg-parse {__version__} {platform.system()} {platform.machine()}",
        "stats": {
            "pages": len(doc_dict.get("pages", {})),
            "chars": len(markdown),
            "charsPerPage": chars_per_page(doc_dict),
            "undecodedFormulas": count_undecoded_formulas(doc_dict),
            "elapsedMs": int(elapsed_s * 1000),
        },
        "document": doc_dict,
    }


def parse_pdf(pdf: pathlib.Path, recipe: dict, name: str | None = None) -> dict:
    """Validate the recipe, run docling, and return the envelope (not yet written)."""
    validate_recipe(recipe)
    check_docling_version(recipe)
    document, elapsed = convert_pdf(pdf, recipe)
    return build_envelope(pdf, recipe, name, document, elapsed)
