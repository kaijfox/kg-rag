"""decode-formulas with a stub decoder (no weights): only formula text changes, recipe echoed, schema valid,
exit codes 3 and 4. The live GLM-OCR test is at the end and runs only with KG_MLX=1."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os

import pytest
from PIL import Image

from kg_parse.envelope import sha256_file
from kg_parse.errors import RecipeError, SourceMismatchError
from kg_parse.formulas import bare_latex, decode_formulas
from kg_parse.recipe import without_formula_decoding

from conftest import (
    GLM_MODEL,
    GLM_REVISION,
    STAT_MECH_DIR,
    formula_decoding,
    load_envelope,
    make_text_pdf,
    recipe_with,
    run_cli,
    schema_validator,
    write_json,
)

# Bounding box of the drawn line "E = mc2" (Helvetica 24 pt at x=72, y=600), BOTTOMLEFT origin like docling.
FORMULA_BBOX = {"l": 72.0, "t": 620.0, "r": 190.0, "b": 596.0, "coord_origin": "BOTTOMLEFT"}


class StubDecoder:
    model_name = GLM_MODEL
    revision = GLM_REVISION

    def __init__(self, reply: str = "E = mc^{2}", fail_on_call: bool = False):
        self.reply = reply
        self.fail_on_call = fail_on_call
        self.calls: list[tuple[tuple[int, int], str]] = []

    def decode(self, image: Image.Image, prompt: str) -> str:
        self.calls.append((image.size, prompt))
        if self.fail_on_call:
            raise RuntimeError("stub failure")
        return self.reply


def _text_item(i: int, text: str, label: str = "text", prov: bool = True) -> dict:
    item = {
        "self_ref": f"#/texts/{i}",
        "parent": {"$ref": "#/body"},
        "children": [],
        "label": label,
        "prov": [{"page_no": 1, "bbox": FORMULA_BBOX, "charspan": [0, len(text)]}] if prov else [],
        "orig": text,
        "text": text,
    }
    return item


def make_artifact(pdf_path, recipe: dict, texts: list[dict]) -> dict:
    return {
        "format": "kg-parse-artifact/1",
        "sourceSha256": sha256_file(pdf_path),
        "sourceName": pdf_path.name,
        "recipe": without_formula_decoding(recipe),
        "parser": {"name": "docling", "version": "2.140.0"},
        "producedAt": "2026-10-18T12:00:00Z",
        "producedOn": "test",
        "stats": {"pages": 1, "chars": 40, "charsPerPage": [], "undecodedFormulas": 1, "elapsedMs": 1},
        "document": {
            "schema_name": "DoclingDocument",
            "version": "1.9.0",
            "name": pdf_path.stem,
            "body": {"self_ref": "#/body", "children": [{"$ref": t["self_ref"]} for t in texts], "label": "unspecified"},
            "furniture": {"self_ref": "#/furniture", "children": [], "label": "unspecified"},
            "texts": texts,
            "groups": [],
            "tables": [],
            "pictures": [],
            "pages": {"1": {"size": {"width": 612.0, "height": 792.0}, "page_no": 1}},
        },
    }


@pytest.fixture
def formula_pdf(tmp_path):
    path = tmp_path / "formula.pdf"
    path.write_bytes(make_text_pdf("E = mc2"))
    return path


@pytest.fixture
def recipe():
    return recipe_with(options={"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False},
                       formulaDecoding=formula_decoding())


@pytest.fixture
def base_texts():
    return [
        _text_item(0, "Mass energy relation:", label="text"),
        _text_item(1, "", label="formula"),
        _text_item(2, "Here the symbols keep their meaning.", label="text"),
    ]


def test_only_formula_text_changes(formula_pdf, recipe, base_texts):
    artifact = make_artifact(formula_pdf, recipe, base_texts)
    decoder = StubDecoder(reply="E = mc^{2}")
    new, counts = decode_formulas(artifact, formula_pdf, recipe, decoder)

    assert counts == {"decoded": 1, "failed": 0, "undecoded": 0}
    assert new["document"]["texts"][1]["text"] == "E = mc^{2}"

    # Every other field of every item is untouched; the formula item differs only in `text`.
    for old_item, new_item in zip(artifact["document"]["texts"], new["document"]["texts"]):
        if old_item["label"] == "formula":
            expected = {**old_item, "text": "E = mc^{2}"}
            assert new_item == expected
        else:
            assert new_item == old_item

    # Envelope fields are unchanged except the recipe, producedAt and the undecoded count.
    for key in ("format", "sourceSha256", "sourceName", "parser", "producedOn"):
        assert new[key] == artifact[key]
    assert {k: v for k, v in new["document"].items() if k != "texts"} == {
        k: v for k, v in artifact["document"].items() if k != "texts"
    }
    assert new["stats"] == {**artifact["stats"], "undecodedFormulas": 0}
    assert new["recipe"] == recipe

    # The crop was rendered at scale 1.67 and passed the recipe prompt through.
    (size, prompt), = decoder.calls
    assert size[0] > 0 and size[1] > 0
    assert prompt == "Formula Recognition:"


def test_decode_sets_produced_at_to_decode_time(monkeypatch, formula_pdf, recipe, base_texts):
    monkeypatch.setattr("kg_parse.formulas.utc_now_iso", lambda: "2030-01-02T03:04:05Z")
    artifact = make_artifact(formula_pdf, recipe, base_texts)
    new, _ = decode_formulas(artifact, formula_pdf, recipe, StubDecoder())
    assert new["producedAt"] == "2030-01-02T03:04:05Z"
    assert new["producedOn"] == artifact["producedOn"]
    assert artifact["producedAt"] == "2026-10-18T12:00:00Z"


@pytest.mark.parametrize(
    "raw, bare",
    [
        ("$$ E = mc^{2} $$", "E = mc^{2}"),
        ("$$ E = mc^{2} \\tag{3} $$", "E = mc^{2}"),
        ("  $$\n\\frac{a}{b}\n\\tag{12}\n$$  ", "\\frac{a}{b}"),
        ("$x^{2}$", "x^{2}"),
        ("\\tag{1} a+b", "a+b"),
        ("\\frac{a}{b}", "\\frac{a}{b}"),
        ("$$ $$", ""),
    ],
)
def test_bare_latex_strips_delimiters_and_tags(raw, bare):
    assert bare_latex(raw) == bare


def test_decoded_text_is_bare_latex(formula_pdf, recipe, base_texts):
    artifact = make_artifact(formula_pdf, recipe, base_texts)
    new, counts = decode_formulas(artifact, formula_pdf, recipe, StubDecoder(reply="$$ E = mc^{2} \\tag{1} $$"))
    assert counts["decoded"] == 1
    assert new["document"]["texts"][1]["text"] == "E = mc^{2}"


def test_undecoded_count_covers_failed_and_unprovenanced_formulas(formula_pdf, recipe):
    texts = [_text_item(0, "", label="formula"), _text_item(1, "", label="formula", prov=False)]
    artifact = make_artifact(formula_pdf, recipe, texts)
    new, counts = decode_formulas(artifact, formula_pdf, recipe, StubDecoder())
    assert counts == {"decoded": 1, "failed": 0, "undecoded": 1}
    assert new["stats"]["undecodedFormulas"] == 1


def test_output_validates_against_schema(formula_pdf, recipe, base_texts):
    artifact = make_artifact(formula_pdf, recipe, base_texts)
    new, _ = decode_formulas(artifact, formula_pdf, recipe, StubDecoder())
    schema_validator().validate(new)


def test_crop_margin_changes_crop_size(formula_pdf, base_texts):
    sizes = {}
    for margin in (0.0, 0.18):
        r = recipe_with(options={"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False},
                        formulaDecoding=formula_decoding(margin))
        dec = StubDecoder()
        decode_formulas(make_artifact(formula_pdf, r, copy.deepcopy(base_texts)), formula_pdf, r, dec)
        sizes[margin] = dec.calls[0][0]
    assert sizes[0.18][0] > sizes[0.0][0] and sizes[0.18][1] > sizes[0.0][1]


def test_empty_or_failed_decode_keeps_original_text(formula_pdf, recipe, base_texts):
    artifact = make_artifact(formula_pdf, recipe, base_texts)
    new, counts = decode_formulas(artifact, formula_pdf, recipe, StubDecoder(reply="   "))
    assert counts == {"decoded": 0, "failed": 1, "undecoded": 1}
    assert new["document"]["texts"][1]["text"] == ""
    assert new["stats"]["undecodedFormulas"] == 1

    new, counts = decode_formulas(artifact, formula_pdf, recipe, StubDecoder(fail_on_call=True))
    assert counts == {"decoded": 0, "failed": 1, "undecoded": 1}


def test_formula_without_provenance_is_left_alone(formula_pdf, recipe):
    texts = [_text_item(0, "", label="formula", prov=False)]
    artifact = make_artifact(formula_pdf, recipe, texts)
    dec = StubDecoder()
    new, counts = decode_formulas(artifact, formula_pdf, recipe, dec)
    assert counts == {"decoded": 0, "failed": 0, "undecoded": 1}
    assert dec.calls == []
    assert new["document"]["texts"][0]["text"] == ""


def test_decoder_revision_must_match_recipe(formula_pdf, recipe, base_texts):
    class WrongRevision(StubDecoder):
        revision = "0" * 40

    with pytest.raises(RecipeError):
        decode_formulas(make_artifact(formula_pdf, recipe, base_texts), formula_pdf, recipe, WrongRevision())


def test_recipe_without_formula_decoding_exits_three(tmp_path, formula_pdf, base_texts):
    plain = recipe_with()
    artifact_path = tmp_path / "a.kgparse.json.gz"
    _write_gz(artifact_path, make_artifact(formula_pdf, plain, base_texts))
    proc = run_cli("decode-formulas", "--artifact", str(artifact_path), "--pdf", str(formula_pdf),
                   "--recipe", str(write_json(tmp_path / "r.json", plain)), "--out", str(tmp_path / "out"))
    assert proc.returncode == 3, proc.stderr
    assert not (tmp_path / "out").exists()


def test_artifact_from_other_recipe_exits_three(tmp_path, formula_pdf, base_texts, recipe):
    other = recipe_with(options={"do_ocr": True, "do_table_structure": True, "do_formula_enrichment": False},
                        formulaDecoding=formula_decoding())
    artifact_path = tmp_path / "a.kgparse.json.gz"
    _write_gz(artifact_path, make_artifact(formula_pdf, other, base_texts))
    proc = run_cli("decode-formulas", "--artifact", str(artifact_path), "--pdf", str(formula_pdf),
                   "--recipe", str(write_json(tmp_path / "r.json", recipe)), "--out", str(tmp_path / "out"))
    assert proc.returncode == 3, proc.stderr


def test_pdf_with_different_sha_exits_four(tmp_path, formula_pdf, base_texts, recipe):
    artifact_path = tmp_path / "a.kgparse.json.gz"
    _write_gz(artifact_path, make_artifact(formula_pdf, recipe, base_texts))
    other_pdf = tmp_path / "other.pdf"
    other_pdf.write_bytes(make_text_pdf("F = ma"))
    proc = run_cli("decode-formulas", "--artifact", str(artifact_path), "--pdf", str(other_pdf),
                   "--recipe", str(write_json(tmp_path / "r.json", recipe)), "--out", str(tmp_path / "out"))
    assert proc.returncode == 4, proc.stderr


def test_library_raises_source_mismatch(formula_pdf, recipe, base_texts, tmp_path):
    other_pdf = tmp_path / "other.pdf"
    other_pdf.write_bytes(make_text_pdf("F = ma"))
    with pytest.raises(SourceMismatchError):
        decode_formulas(make_artifact(formula_pdf, recipe, base_texts), other_pdf, recipe, StubDecoder())


def test_cli_writes_decoded_artifact_name_and_gzip(tmp_path, formula_pdf, base_texts, recipe, monkeypatch):
    """The CLI path with a stubbed decoder: checks the output file name and that it reads back as the same envelope."""
    import kg_parse.decoder as decoder_mod
    from kg_parse import cli

    monkeypatch.setattr(decoder_mod, "MlxFormulaDecoder", lambda model, revision: StubDecoder())
    artifact_path = tmp_path / "a.kgparse.json.gz"
    _write_gz(artifact_path, make_artifact(formula_pdf, recipe, base_texts))
    out = tmp_path / "out"

    args = argparse.Namespace(
        artifact=str(artifact_path),
        pdf=str(formula_pdf),
        recipe=str(write_json(tmp_path / "r.json", recipe)),
        out=str(out),
    )
    assert cli.cmd_decode_formulas(args) == 0
    (written,) = list(out.iterdir())
    recipe_sha = hashlib.sha256(
        json.dumps(recipe, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    assert written.name == f"{sha256_file(formula_pdf)[:16]}.{recipe_sha[:12]}.kgparse.json.gz"
    back = load_envelope(written)
    assert back["recipe"] == recipe
    assert back["document"]["texts"][1]["text"] == "E = mc^{2}"


def _write_gz(path, obj) -> None:
    with gzip.open(path, "wb") as fh:
        fh.write(json.dumps(obj).encode("utf-8"))


# ---- live: GLM-OCR through mlx-vlm on the Apple GPU, gated by KG_MLX=1 ----

LIVE_PDF = STAT_MECH_DIR / "ThermoPlischke.pdf"


@pytest.mark.skipif(os.environ.get("KG_MLX") != "1", reason="set KG_MLX=1 to run the GLM-OCR (mlx-vlm) test")
@pytest.mark.skipif(not LIVE_PDF.exists(), reason=f"stat-mech PDF not found at {LIVE_PDF}")
def test_live_glm_ocr_decodes_stat_mech_page(tmp_path):
    parse_recipe = recipe_with(options={"do_ocr": False, "do_table_structure": True,
                                        "do_formula_enrichment": False, "page_range": [2, 4]})
    decode_recipe = recipe_with(options=parse_recipe["spec"]["options"], formulaDecoding=formula_decoding())
    parse_path = write_json(tmp_path / "parse.json", parse_recipe)
    decode_path = write_json(tmp_path / "decode.json", decode_recipe)

    proc = run_cli("parse", "--input", str(LIVE_PDF), "--recipe", str(parse_path), "--out", str(tmp_path / "p"))
    assert proc.returncode == 0, proc.stderr
    parsed = next((tmp_path / "p").iterdir())

    proc = run_cli("decode-formulas", "--artifact", str(parsed), "--pdf", str(LIVE_PDF),
                   "--recipe", str(decode_path), "--out", str(tmp_path / "d"))
    assert proc.returncode == 0, proc.stderr
    summary = json.loads(proc.stdout.strip().splitlines()[-1])
    assert summary["failed"] == 0
    assert summary["decoded"] >= 1

    decoded = load_envelope(next((tmp_path / "d").iterdir()))
    schema_validator().validate(decoded)
    formulas = [t for t in decoded["document"]["texts"] if t["label"] == "formula"]
    assert all(t["text"].strip() for t in formulas)
