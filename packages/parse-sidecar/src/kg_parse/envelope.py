"""Artifact envelope I/O: file naming, gzip writing, reading and hashing."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import pathlib
from datetime import datetime, timezone
from typing import Any

from .recipe import recipe_hash


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def count_undecoded_formulas(doc: dict) -> int:
    """Formula items with no text. `parse` and `decode-formulas` both count with this rule."""
    return sum(
        1 for item in doc.get("texts", [])
        if item.get("label") == "formula" and not (item.get("text") or "").strip()
    )


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_filename(source_sha256: str, recipe: dict) -> str:
    return f"{source_sha256[:16]}.{recipe_hash(recipe)[:12]}.kgparse.json.gz"


def write_artifact(envelope: dict, out_dir, recipe: dict) -> pathlib.Path:
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    final = out / artifact_filename(envelope["sourceSha256"], recipe)
    tmp = final.with_name(final.name + ".tmp")
    payload = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    with open(tmp, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            gz.write(payload)
    os.replace(tmp, final)
    return final.resolve()


def read_artifact(path) -> dict[str, Any]:
    p = pathlib.Path(path)
    if p.name.endswith(".gz"):
        with gzip.open(p, "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))
    return json.loads(p.read_text(encoding="utf-8"))
