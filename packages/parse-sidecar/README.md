# kg-parse

Thin Python wrapper around docling (pinned `docling==2.140.0`) that turns a PDF into a
`kg-parse-artifact/1` envelope (gzipped JSON), and decodes formula blocks of such an artifact with
GLM-OCR through mlx-vlm. The contract is `packages/core/schemas/parse-artifact.schema.json`.
The sidecar does not compute kg IDs and does not chunk; it hashes file bytes only.

## Setup and commands

```
cd packages/parse-sidecar
uv sync                       # resolves from uv.lock; mlx-vlm is installed on macOS only
uv run kg-parse version       # {"doclingVersion":"2.140.0","sidecar":"0.1.0"}
uv run kg-parse check-recipe RECIPE.json
uv run kg-parse parse --input X.pdf --recipe RECIPE.json --out DIR [--name NAME]
uv run kg-parse decode-formulas --artifact IN.kgparse.json.gz --pdf X.pdf --recipe RECIPE.json --out DIR
```

Exit codes: 0 success; 2 parse or decode failure (traceback on stderr); 3 recipe invalid, unknown
option, docling version mismatch, or recipe/artifact mismatch (also: decoder revision not matching);
4 the PDF's sha256 differs from the artifact's `sourceSha256`.

Output file names: `DIR/<sourceSha256[:16]>.<sha256(recipe json)[:12]>.kgparse.json.gz`.
`parse` prints `{"path","sourceSha256","stats"}`; `decode-formulas` prints `{"path","sourceSha256","decoded","failed"}`,
each as one JSON line.

## Tests

```
uv run pytest                              # no weights needed beyond docling's own layout/table models
KG_MLX=1 uv run pytest -k live             # GLM-OCR on the Apple GPU, needs the model in the local HF cache
```

- The tests run docling on `packages/testkit/fixtures/parse/tiny.pdf`, which needs docling's layout and
  TableFormer models in the Hugging Face cache (downloaded on first use if absent, unless
  `HF_HUB_OFFLINE=1` is set).
- The formula tests use a stub decoder and a PDF generated in the test itself, so they need no weights.
- The live test parses pages 2-4 of `test/corpa/stat-mech/ThermoPlischke.pdf` (skipped if the PDF is absent)
  and decodes them. It needs `KG_MLX=1`, the model `mlx-community/GLM-OCR-4bit` at revision
  `97f587506984cc92fa69b2694b4128e53db6b081` in the local cache, and `HF_HOME` pointing at that cache if
  it is not the default.

## Decisions and assumptions

- Recipe options map onto `PdfPipelineOptions`. `page_range` is the one sidecar-only option: it is removed
  from the options before construction and passed to `DocumentConverter.convert`. Unknown option names are
  rejected explicitly, because pydantic would otherwise ignore them. `do_formula_enrichment` must be false.
- The recipe hash is `sha256` of the recipe serialized as sorted-key, no-whitespace JSON (UTF-8), the bytes
  core's `canonicalJson` produces. `test_recipe.py` checks it against core's digest for a fixed recipe. It is only used in file names.
- The envelope embeds the recipe exactly as read from the file (parsed JSON value, not re-serialized text).
- `producedOn` is `kg-parse 0.1.0 <system> <machine>`, not a hostname.
- `stats.charsPerPage` is filled: characters of text items per converted page, in page order. `chars` is
  the length of docling's markdown export. `stats.undecodedFormulas` in both commands is the number of formula
  items with no text (in `parse` that is every formula, since no decoder runs).
- `decode-formulas` changes only `text` of formula items with page and bbox provenance, sets `recipe` to the
  decode recipe, sets `producedAt` to the decode time (UTC), and sets `stats.undecodedFormulas` to the number of
  formula items with no text afterwards (failed, empty, or without provenance). `producedOn` and the other
  stats are kept as in the input.
- Crop rule (the one measured in the formula-VLM evaluation): page rendered with pypdfium2 at scale 1.67; box expanded by
  `cropMargin` times its width on left and right and times its height on top and bottom; clamped to the
  page. BOTTOMLEFT origin is assumed when `coord_origin` is absent; TOPLEFT boxes are converted.
- The decoder's reply is reduced to bare LaTeX (`bare_latex`): `\tag{n}` removed, `$$ ... $$` or `$ ... $`
  delimiters removed, whitespace trimmed. A reply that is empty after this counts as failed. The chunker does not strip anything.
- Revision check: the decoder resolves the model in the local Hugging Face cache at the recipe's revision.
  The revision must be a full commit hash and the snapshot directory must have that name; otherwise exit 3.
  The command never downloads model weights.
- Parse failures include unreadable inputs; they exit 2 with a traceback. An invalid recipe exits 3 before
  docling runs.

## Known gaps

- `do_ocr: true` is passed to docling as specified; the OCR engine's own dependencies and models are not
  managed here. Only the option wiring is tested (no OCR run).
- Inline formulas (glyph names inside prose) are not decoded; they are not formula blocks.
- The decoder is a single model (GLM-OCR 4-bit on MLX). There is no CPU or CUDA decoder. Off macOS the
  decode command fails at import of `mlx_vlm` with exit 2.
- One process per document; no batching across documents.
- Decoded LaTeX is bare but not otherwise normalized (`\mathrm`-style choices are kept).
- The earlier evaluation measured 605 formulas in about 4.3 minutes on the four stat-mech PDFs; this package was
  verified only on pages 2-4 of ThermoPlischke (7 formulas, all identical to that evaluation's output for the same items).
- Schema validation happens in the tests only (against the monorepo schema file); the CLI does not
  validate its output at runtime.
