"""kg-parse parse on the committed tiny.pdf: envelope contract, recipe echo, content the card names."""

from __future__ import annotations

import hashlib
import json
import re

from conftest import load_envelope, recipe_with, run_cli, schema_validator, write_json

TINY_SHA = "89511784d5b992ffb41635c63f02e3f209e039b1bfd7604cf9a2e4576618ac86"


def test_version_command():
    proc = run_cli("version")
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout) == {"doclingVersion": "2.140.0", "sidecar": "0.1.0"}


def test_parse_tiny_pdf_writes_valid_envelope(tmp_path, tiny_pdf):
    recipe = recipe_with()
    recipe_path = write_json(tmp_path / "recipe.json", recipe)
    out = tmp_path / "out"
    proc = run_cli("parse", "--input", str(tiny_pdf), "--recipe", str(recipe_path), "--out", str(out))
    assert proc.returncode == 0, proc.stderr

    summary = json.loads(proc.stdout.strip().splitlines()[-1])
    assert summary["sourceSha256"] == TINY_SHA
    assert summary["stats"]["pages"] == 2

    files = list(out.iterdir())
    assert len(files) == 1
    name = files[0].name
    recipe_sha = hashlib.sha256(
        json.dumps(recipe, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    assert name == f"{TINY_SHA[:16]}.{recipe_sha[:12]}.kgparse.json.gz"
    assert summary["path"] == str(files[0])

    envelope = load_envelope(files[0])
    schema_validator().validate(envelope)
    assert envelope["sourceSha256"] == TINY_SHA
    assert envelope["recipe"] == recipe
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", envelope["producedAt"])


def test_tiny_pdf_content_matches_card(tmp_path, tiny_pdf):
    recipe_path = write_json(tmp_path / "recipe.json", recipe_with())
    out = tmp_path / "out"
    proc = run_cli("parse", "--input", str(tiny_pdf), "--recipe", str(recipe_path), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    envelope = load_envelope(next(out.iterdir()))
    doc = envelope["document"]

    headers = [t["text"] for t in doc["texts"] if t["label"] == "section_header"]
    assert "1 Tiny test document" in headers

    # docling reads "1.1 A small table" as a list item; this is a known quirk, not a bug to fix here.
    assert "A small table" not in headers

    assert len(doc["tables"]) == 1
    grid = [[cell["text"] for cell in row] for row in doc["tables"][0]["data"]["grid"]]
    assert grid == [["Gas", "Molar mass"], ["Helium", "4"], ["Argon", "40"]]


def test_parse_failure_exits_two(tmp_path):
    bogus = tmp_path / "not-a-pdf.pdf"
    bogus.write_bytes(b"this is not a pdf")
    recipe_path = write_json(tmp_path / "recipe.json", recipe_with())
    proc = run_cli("parse", "--input", str(bogus), "--recipe", str(recipe_path), "--out", str(tmp_path / "out"))
    assert proc.returncode == 2
    assert "Traceback" in proc.stderr
