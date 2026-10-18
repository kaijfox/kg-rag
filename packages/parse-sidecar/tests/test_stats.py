"""Envelope stats from a docling document: undecodedFormulas and charsPerPage, without running docling."""

from __future__ import annotations

from kg_parse.envelope import count_undecoded_formulas
from kg_parse.parse import build_envelope, chars_per_page

from conftest import recipe_with


class _FakeDocling:
    def __init__(self, doc: dict):
        self._doc = doc

    def export_to_dict(self) -> dict:
        return self._doc

    def export_to_markdown(self) -> str:
        return "text"


def _item(label: str, text: str, page: int | None = 1) -> dict:
    prov = [{"page_no": page, "bbox": {"l": 0, "t": 1, "r": 1, "b": 0}, "charspan": [0, len(text)]}] if page else []
    return {"label": label, "text": text, "prov": prov}


def test_undecoded_formulas_counts_formula_items_without_text():
    doc = {"texts": [_item("formula", ""), _item("formula", "  "), _item("formula", "x^2"), _item("text", "")]}
    assert count_undecoded_formulas(doc) == 2


def test_parse_stats_count_every_formula_item(tiny_pdf):
    doc = {
        "texts": [_item("text", "Prose"), _item("formula", ""), _item("formula", "")],
        "pages": {"1": {}},
    }
    envelope = build_envelope(tiny_pdf, recipe_with(), None, _FakeDocling(doc), 0.5)
    assert envelope["stats"]["undecodedFormulas"] == 2
    assert envelope["stats"]["charsPerPage"] == [5]
    assert envelope["stats"]["chars"] == len("text")


def test_chars_per_page_sums_text_items_per_page_in_order():
    doc = {
        "texts": [_item("text", "abc", page=2), _item("formula", "", page=2), _item("text", "de", page=1),
                  _item("text", "unplaced", page=None)],
        "pages": {"2": {}, "1": {}, "3": {}},
    }
    assert chars_per_page(doc) == [2, 3, 0]
