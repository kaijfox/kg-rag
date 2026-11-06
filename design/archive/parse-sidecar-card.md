> **Archived, 2026-11-06.** A work card from the first build. The sidecar's current description is `packages/parse-sidecar/README.md`.

# parse-sidecar (WP1, Sonnet) — Python, not a pnpm package

Contract: the CLI below plus `packages/core/schemas/parse-artifact.schema.json` (generated from core's zod
schema; `pnpm --filter @kg/core gen:schemas`). You need this card, that schema, and the fixtures below.

## Implements
A `uv` project exposing `kg-parse`, a thin wrapper over docling (pin `docling==2.140.0`):
```
kg-parse version                          -> stdout {"doclingVersion":"2.140.0","sidecar":"0.1.0"}; exit 0
kg-parse check-recipe RECIPE.json         -> exit 0 and echo the recipe; exit 3 if spec.doclingVersion differs
                                             from the installed docling or an option is unknown
kg-parse parse --input X.pdf --recipe RECIPE.json --out DIR [--name NAME]
                                          -> writes DIR/<sha256[:16]>.<sha256(recipe json)[:12]>.kgparse.json.gz
                                             stdout: one JSON line {"path":..., "sourceSha256":..., "stats":{...}}
                                             exit 2 on parse failure (traceback on stderr); exit 3 if the recipe
                                             is invalid (checked before docling runs)
```
RECIPE.json is a core `ParseRecipeSpec`: `{"kind":"parse","version":"1","spec":{"parser":"docling",
"doclingVersion":"2.140.0","options":{"do_ocr":false,"do_table_structure":true,"do_formula_enrichment":false}}}`.
Options map 1:1 onto `PdfPipelineOptions` (`page_range` is passed to `convert`). The envelope embeds the
recipe verbatim and `document = DoclingDocument.export_to_dict()`. `stats`: `pages`; `chars` = length of the markdown
export; `charsPerPage` = characters of text items per page (texts only, tables and pictures excluded), one entry per
page in ascending page order; `undecodedFormulas` = formula items with no text; `elapsedMs`. The recipe hash is
sha256 of the recipe as sorted-key, no-whitespace UTF-8 JSON (the bytes core's `canonicalJson` produces). The
sidecar never computes kg IDs; it hashes file bytes (sha256) only.

### decode-formulas (0.6.0)
```
kg-parse decode-formulas --artifact IN.kgparse.json[.gz] --pdf SOURCE.pdf --recipe RECIPE.json --out DIR
                                          -> writes DIR/<sha256[:16]>.<sha256(recipe json)[:12]>.kgparse.json.gz
                                             stdout: one JSON line {"path":..., "sourceSha256":..., "decoded":N, "failed":M}
                                             exit 2 on failure, 3 if RECIPE has no spec.formulaDecoding or the artifact
                                             was not produced by the same recipe without it, 4 if the PDF's sha256 differs
                                             from the artifact's sourceSha256
```
Input: a plain parse artifact plus its source PDF. Output: a new artifact, identical except that the `text` of every
`formula`-label item that has page and bounding-box provenance holds the bare decoded LaTeX (the decoder reply with `$$`
or `$` delimiters and `\tag{..}` removed, trimmed), `recipe` is RECIPE.json verbatim, `producedAt` is the decode time
(UTC; `producedOn` is kept from the input), `stats.undecodedFormulas` counts the formula items with no text, and nothing
else changes (no text inserted anywhere, items and refs untouched). RECIPE.json is the parse recipe with `spec.formulaDecoding` = `{model, revision, prompt,
cropMargin}`: the decoder model name, its pinned revision, the prompt given with each crop, and the crop margin (fraction of
the box size added on each side; docling's own crop uses 0.18). So the new artifact has a new parse recipe and new chunk ids by
the usual rule; `kg-parse parse` with that recipe is unaffected.
Decoder: GLM-OCR 4-bit via `mlx-vlm` (`mlx-community/GLM-OCR-4bit`, prompt `Formula Recognition:`, temperature 0, batch 1),
Python + MLX, Apple GPU; measured in `scratch/sprint-1/spike-formula-vlm/results.md` (605 display formulas in about 4.3 min,
about 2 GB RAM, 82% normalized exact match on the 33-item gold set). Crop rule: render the page at 1.67 scale with pypdfium2,
expand the item's box by `cropMargin` per side, clamp to the page. The model revision must equal the recipe's or the command
exits 3. A formula whose decode fails or returns empty keeps its original text (empty), counts in `failed`, and does not fail
the run. Inline formulas (glyph names inside prose) are out of scope: they are not blocks.
Tests: a tiny artifact and PDF with one formula, a stub decoder (the model is injected, no weights needed) checking that only
formula `text` changes, the recipe is echoed, the output validates against `parse-artifact.schema.json`, exit codes 3 and 4;
a live test skipped unless `KG_MLX=1`.

## Tests you must pass (pytest)
- `kg-parse parse` on `packages/testkit/fixtures/parse/tiny.pdf` writes an envelope that validates against
  `parse-artifact.schema.json` (python `jsonschema`), has `sourceSha256` =
  89511784d5b992ffb41635c63f02e3f209e039b1bfd7604cf9a2e4576618ac86, echoes the recipe exactly, and contains
  a section_header "1 Tiny test document" and one table with grid [[Gas, Molar mass], [Helium, 4], [Argon, 40]]
  (see fixtures/parse/README.md: docling reads "1.1 A small table" as a list item; do not "fix" that).
- `check-recipe` exit codes (0 on the default recipe, 3 on doclingVersion "0.0.0" and on an unknown option).
- `do_ocr: true` in the recipe reaches docling (assert on the options object passed, not on output).
Command: `cd packages/parse-sidecar && uv run pytest`.

## Fixtures you may read
`packages/testkit/fixtures/parse/tiny.pdf`, `packages/testkit/fixtures/docling-real/make_slice.py` (the
Phase 1 script that produced the real fixtures; the envelope layout there is the target).

## Forbidden
Importing TypeScript, computing chunk IDs, chunking (chunking happens in TS from the artifact).

## Decisions already made
Thin CLI, not docling-serve (D7); OCR off by default (decision log); no docling formula enrichment (`do_formula_enrichment` stays false; decoding is the separate `decode-formulas` step, 0.6.0); the
artifact is portable and produced anywhere (GPU server later); one process per document is acceptable.

## Open questions (note, do not decide)
Quality gate and escalation (OCR on as a second recipe) are future work; `stats` is the hook.
