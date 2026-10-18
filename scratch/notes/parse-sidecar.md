# parse-sidecar: implementation notes

## What was done
- `packages/parse-sidecar`: uv project (`pyproject.toml`, `uv.lock`, `.python-version` 3.12), console script `kg-parse`.
  docling pinned `==2.140.0`; mlx-vlm `==0.7.8` on darwin only; pypdfium2 and pillow pinned to the spike's versions.
- Commands: `version`, `check-recipe`, `parse`, `decode-formulas` (exit codes 0/2/3/4 as the card says).
- Tests (24): tiny.pdf parse contract (schema, recipe echo, section header, table grid, list-item quirk kept),
  check-recipe exit codes, do_ocr reaching docling options (options object asserted, docling stubbed),
  decode-formulas with a stub decoder on a generated one-formula PDF, exit codes 3 and 4, a live GLM-OCR test
  gated by `KG_MLX=1`.
- Run: `KG_MLX=1 HF_HOME=~/.cache/kgrag-spike-formula/hf HF_HUB_OFFLINE=1 uv run pytest` -> 24 passed in 48 s.
- Live check: ThermoPlischke pages 2-4 (7 display formulas) decoded with the recipe's GLM-OCR revision; all 7
  texts are identical to the output of the earlier full-corpus GLM-OCR run for the same items (matched by page
  and bbox), so the crop rule reproduces.

## Assumptions
- Recipe hash = sha256 of sorted-key, no-whitespace UTF-8 JSON, checked against core's `canonicalJson` digest in `test_recipe.py`.
- `page_range` is treated as a sidecar-only option (removed from PdfPipelineOptions, passed to convert).
- Unknown option names are rejected explicitly (pydantic ignores extra keys by default). `parse` also exits 3 for
  an invalid recipe, since the card only defines exit 2 for parse failure.
- `stats.charsPerPage` is filled (text-item characters per converted page). The card allows [].
- decode-formulas sets `producedAt` to the decode time (UTC), keeps `producedOn` and the other stats.
  `stats.undecodedFormulas` (both commands) = formula items with no text; `parse` counts every formula.
- Revision check: the model must be in the local HF cache at the recipe revision, that revision must be a full
  commit hash equal to the snapshot directory name. Otherwise exit 3. No downloads.
- Decoded text is bare LaTeX: `$$`/`$` delimiters and `\tag{..}` removed, trimmed (`bare_latex`). Decided here
  (proposal 4), so the chunker does not strip anything.

## Surprised by
- GLM-OCR output on this corpus is `$$ ... $$`-wrapped with equation tags; the spike's scoring stripped these, the
  stored text does not. Chunk-side normalization is a decision for later.
- docling's default HF cache (`~/.cache/huggingface`) already holds the docling layout and table models, so the
  tests ran with no new downloads. The spike's HF_HOME holds GLM-OCR.
- On this machine the default `python3` is 3.9; uv picked 3.12 from `.python-version`.

## Would flag
- The contract does not say whether decode output keeps the old `producedAt`. Keeping it makes the artifact look
  older than the decode; see the change proposal.
- Live test is the only check of GLM-OCR; the stub test covers the rest. Off macOS, decode-formulas fails with exit 2
  at the mlx_vlm import.
- `do_ocr: true` is wired but not run (no OCR engine model work done here).
- Full-corpus decode (605 formulas) was not run here; only pages 2-4 of ThermoPlischke.

## Reads outside the allowed list (disclosed)
- Beyond CARD.md, the schema, testkit fixtures and the spike's results.md and scripts, I read the spike's
  `out/full_glm_ocr_4bit.json` (decoded outputs) to compare the live result, and the stat-mech corpus artifact
  `test/corpa/stat-mech/artifacts/ThermoPlischke.kgparse.json.gz` to match formulas by bbox. Nothing under
  packages/app/src/skeleton was read.

## Review fixes (2026-10-18)
- Proposals 1, 2, 3, 5, 6 and 4 adopted (see `scratch/sprint-1/change-proposals/parse-sidecar.md`). Tests: 37 passed, 1 skipped
  (`uv run pytest`; the skip is the live GLM-OCR test). New: core hash vector, bare LaTeX cases, decode `producedAt`,
  undecoded counts, charsPerPage and parse-side undecodedFormulas (`tests/test_stats.py`).
