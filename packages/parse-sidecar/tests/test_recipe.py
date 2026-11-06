"""check-recipe exit codes, unknown-option detection, and that do_ocr reaches docling."""

from __future__ import annotations

import json

import pytest
from docling.datamodel.base_models import InputFormat

import kg_parse.parse as parse_mod
from kg_parse.errors import RecipeError
from kg_parse.recipe import canonical_json, recipe_hash

from conftest import recipe_with, run_cli, write_json


def test_check_recipe_default_exits_zero_and_echoes(tmp_path):
    recipe = recipe_with()
    path = write_json(tmp_path / "recipe.json", recipe)
    proc = run_cli("check-recipe", str(path))
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout) == recipe


def test_check_recipe_wrong_docling_version_exits_three(tmp_path):
    recipe = recipe_with()
    recipe["spec"]["doclingVersion"] = "0.0.0"
    proc = run_cli("check-recipe", str(write_json(tmp_path / "r.json", recipe)))
    assert proc.returncode == 3


def test_check_recipe_unknown_option_exits_three(tmp_path):
    recipe = recipe_with({**dict(recipe_with()["spec"]["options"]), "do_not_a_real_option": True})
    proc = run_cli("check-recipe", str(write_json(tmp_path / "r.json", recipe)))
    assert proc.returncode == 3
    assert "do_not_a_real_option" in proc.stderr


def test_formula_enrichment_on_is_rejected(tmp_path):
    options = {**recipe_with()["spec"]["options"], "do_formula_enrichment": True}
    proc = run_cli("check-recipe", str(write_json(tmp_path / "r.json", recipe_with(options))))
    assert proc.returncode == 3


def test_parse_with_unknown_option_exits_three_before_docling(tmp_path, tiny_pdf):
    options = {**recipe_with()["spec"]["options"], "not_an_option": 1}
    proc = run_cli("parse", "--input", str(tiny_pdf), "--recipe",
                   str(write_json(tmp_path / "r.json", recipe_with(options))), "--out", str(tmp_path / "out"))
    assert proc.returncode == 3
    assert not (tmp_path / "out").exists()


class _StopAfterOptions(Exception):
    pass


class _RecordingConverter:
    """Stands in for docling's DocumentConverter: records the options it was built with, then stops."""

    seen: dict = {}

    def __init__(self, format_options):
        _RecordingConverter.seen["format_options"] = format_options

    def convert(self, source, **kwargs):
        _RecordingConverter.seen["convert_kwargs"] = kwargs
        raise _StopAfterOptions()


def test_do_ocr_true_reaches_docling_options(monkeypatch, tiny_pdf):
    monkeypatch.setattr(parse_mod, "DocumentConverter", _RecordingConverter)
    options = {**recipe_with()["spec"]["options"], "do_ocr": True, "page_range": [1, 2]}
    recipe = recipe_with(options)
    with pytest.raises(_StopAfterOptions):
        parse_mod.convert_pdf(tiny_pdf, recipe)
    pipeline = _RecordingConverter.seen["format_options"][InputFormat.PDF].pipeline_options
    assert pipeline.do_ocr is True
    assert pipeline.do_table_structure is True
    assert pipeline.do_formula_enrichment is False
    assert _RecordingConverter.seen["convert_kwargs"] == {"page_range": (1, 2)}


def test_page_range_is_not_passed_as_pipeline_option():
    from kg_parse.recipe import build_pipeline_options

    options = {**recipe_with()["spec"]["options"], "page_range": [2, 4]}
    pipeline = build_pipeline_options(recipe_with(options))
    assert pipeline.do_ocr is False


def test_invalid_page_range_is_recipe_error():
    from kg_parse.recipe import page_range_of

    with pytest.raises(RecipeError):
        page_range_of(recipe_with({**recipe_with()["spec"]["options"], "page_range": [4, 2]}))


def test_recipe_hash_matches_kernel_canonical_json_digest():
    """Vector from the kernel: sha256hex(canonicalJson(recipe)) in packages/kernel/src/ids.ts, for a recipe with
    non-ASCII text and a formulaDecoding block. The file names of both sides are built from this digest."""
    recipe = {
        "kind": "parse",
        "version": "1",
        "spec": {
            "parser": "docling",
            "doclingVersion": "2.140.0",
            "options": {"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False,
                        "page_range": [2, 4]},
            "formulaDecoding": {
                "model": "mlx-community/GLM-OCR-4bit",
                "revision": "97f587506984cc92fa69b2694b4128e53db6b081",
                "prompt": "Formula Recognition: é→",
                "cropMargin": 0.18,
            },
        },
    }
    assert canonical_json(recipe).startswith('{"kind":"parse","spec":{"doclingVersion":"2.140.0"')
    assert recipe_hash(recipe) == "bea35d9a4ca48d664f27e9c696e685f4f7f751c7fbaee53dba319f031c436b89"
