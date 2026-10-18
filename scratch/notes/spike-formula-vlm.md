# Working notes: formula-VLM spike (2026-10-18)

Outputs and numbers: `scratch/sprint-1/spike-formula-vlm/results.md`. These are the process notes.

## Surprises
- Docling 2.140.0 has a new engine system (`CodeFormulaVlmOptions`, AUTO_INLINE picks MLX on Apple silicon when the model has an MLX export). CodeFormulaV2 has none and its transformers engine excludes MPS; Granite-Docling does have one and works (checked on one page). Driving CodeFormulaV2 through transformers on MPS directly works and matches CPU output.
- The 18% crop margin matters more than the model choice for some candidates: CodeFormulaV2 transcribes adjacent prose lines when the crop shows them. 4% helps CodeFormulaV2, Granite, Paddle; hurts GLM-OCR, texify.
- The Kardar glyph names exist only in docling-parse word cells; PDFium's text layer holds raw codes, so inline-span localization needs docling-parse.
- One docling bbox (FP-p06-t59) cuts a fraction in half; such layout errors cap any decoder.
- pdflatex render equivalence is useless as a metric here (style changes pixels, many compile failures); token-level exact and edit distance are the usable ones.
- texify needs `transformers==4.46.3`; with 4.57 it fails in a config repr during generation.

## Process slips
- I launched a stray no-op sub-agent by mistake while waiting; it did nothing and changed nothing.
- Normalization was iterated three times while looking at failures (separator sentinel, brace grouping, equation numbers inside the reference), so reported accuracies are not blind.

## Open items for a reviewer
- Blind second reading of the 33 references.
- A formula-dependent question set (Phase 4) to test the retrieval finding; the pilot queries were written knowing the decoded text.
