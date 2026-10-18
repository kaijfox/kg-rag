"""Shared helpers. Paths point into the monorepo; PDFs and models are optional where the card says so."""

from __future__ import annotations

import gzip
import json
import pathlib
import subprocess
import sys

import pytest

PKG_ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
TINY_PDF = REPO_ROOT / "packages/testkit/fixtures/parse/tiny.pdf"
SCHEMA_PATH = REPO_ROOT / "packages/core/schemas/parse-artifact.schema.json"
STAT_MECH_DIR = REPO_ROOT / "test/corpa/stat-mech"

GLM_REVISION = "97f587506984cc92fa69b2694b4128e53db6b081"
GLM_MODEL = "mlx-community/GLM-OCR-4bit"
GLM_PROMPT = "Formula Recognition:"

DEFAULT_OPTIONS = {"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False}


def recipe_with(options: dict | None = None, **spec_extra) -> dict:
    spec = {"parser": "docling", "doclingVersion": "2.140.0", "options": dict(options or DEFAULT_OPTIONS)}
    spec.update(spec_extra)
    return {"kind": "parse", "version": "1", "spec": spec}


def formula_decoding(margin: float = 0.18) -> dict:
    return {"model": GLM_MODEL, "revision": GLM_REVISION, "prompt": GLM_PROMPT, "cropMargin": margin}


def write_json(path: pathlib.Path, obj) -> pathlib.Path:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    return path


def run_cli(*args: str) -> subprocess.CompletedProcess:
    """Run the CLI in a child process (the same interpreter as the tests, from the project venv)."""
    return subprocess.run(
        [sys.executable, "-m", "kg_parse.cli", *args],
        capture_output=True,
        text=True,
        cwd=PKG_ROOT,
    )


def load_envelope(path) -> dict:
    with gzip.open(path, "rb") as fh:
        return json.loads(fh.read().decode("utf-8"))


def schema_validator():
    import jsonschema

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def make_text_pdf(text: str = "E = mc2", x: float = 72, y: float = 600, size: int = 24) -> bytes:
    """A one-page PDF with one Helvetica line, written by hand so no PDF library is needed to create it."""
    content = f"BT /F1 {size} Tf {x} {y} Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


@pytest.fixture
def tiny_pdf() -> pathlib.Path:
    if not TINY_PDF.exists():
        pytest.skip(f"missing fixture {TINY_PDF}")
    return TINY_PDF
