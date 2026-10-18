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
                                             exit 2 on parse failure (traceback on stderr)
```
RECIPE.json is a core `ParseRecipeSpec`: `{"kind":"parse","version":"1","spec":{"parser":"docling",
"doclingVersion":"2.140.0","options":{"do_ocr":false,"do_table_structure":true,"do_formula_enrichment":false}}}`.
Options map 1:1 onto `PdfPipelineOptions` (`page_range` is passed to `convert`). The envelope embeds the
recipe verbatim and `document = DoclingDocument.export_to_dict()`; `stats` = pages, chars of the markdown
export, `charsPerPage` (may be []), count of `formula-not-decoded`, elapsed ms. The sidecar never computes
kg IDs; it hashes file bytes (sha256) only.

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
Thin CLI, not docling-serve (D7); OCR off by default (decision log); no formula enrichment in v0; the
artifact is portable and produced anywhere (GPU server later); one process per document is acceptable.

## Open questions (note, do not decide)
Quality gate and escalation (OCR on as a second recipe) are future work; `stats` is the hook.
