# docling-real: real docling 2.140.0 output (OCR off), three page slices

Produced by docling's `DocumentConverter(..., PdfPipelineOptions(do_ocr=False, do_table_structure=True))`
with `page_range`, wrapped in the kg parse-artifact envelope (script: `make_slice.py PDF FIRST LAST OUT`, run in a
Python env with docling 2.140.0). The recipe records `page_range`, so each slice has its own parse
recipe (a build over all three reports `mixedRecipes: true`).

| File | Source pages | What it exercises |
|---|---|---|
| `thermo-plischke-p2-4.kgparse.json` | ThermoPlischke 2-4 | text before the first heading (path []), a 1844-char paragraph (`#/texts/2`) that must split, 7 formulas, a footnote, running page headers in the furniture layer *inside* `body.children` |
| `foundations-kardar-p3-5.kgparse.json` | FoundationsKardar 3-5 | a picture with no caption and 15 child texts (axis labels) that must not leak, a body-level caption, list groups, a bold run-in heading ("Consequences of Liouville's theorem:") detected as a section header, Kardar's math-font glyph names in the text layer ("SLrholparenori...") |
| `thermo-kardar-p6-7.kgparse.json` | ThermoKardar 6-7 | a table with a caption (`#/tables/0`), a captioned picture with 5 internal labels, no section header at all |

Facts in `expected-facts.json` were read off the JSON by hand (body order, labels, refs): allowed section paths (docling gives every header level 1, so paths have
one entry), refs that must be split, formula counts, strings that must never appear (page headers),
and which section owns given refs. chunkerConformance also derives structural expectations from the JSON
alone: every body text ref outside pictures appears in some chunk, furniture and picture-internal refs in
none, and a ref appears in two chunks only if it was split.
