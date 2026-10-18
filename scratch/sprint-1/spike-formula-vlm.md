# Spike: Apple-GPU formula recognition (Phase 2, parallel to the package builds)

Proposed 2026-10-18 by the user. Owner: one agent on a cheap/mid model (well-specified measurement work); a stronger model reviews the conclusion. No write access outside `scratch/sprint-1/spike-formula-vlm/` and `scratch/notes/spike-formula-vlm.md`. Touches no package.

## Why
Sprint 0 left formulas undecoded (decision log 2026-10-17, "No equation decoding"). Docling's formula enrichment runs on CPU only (MPS raises `AcceleratorDeviceNotAvailableError`; 194 s for 3 pages of ThermoPlischke), and the corpus has 606 undecoded formulas. The Kardar PDFs also turn inline math into glyph names ("lparenoriA 1 commaoriA 2"), whose retrieval impact is unmeasured. A local Apple-silicon (MPS or MLX) formula model might make decoding affordable without a GPU server.

## Question
Is there a VLM or formula-OCR model that runs on Apple GPU (MPS via PyTorch, or MLX / mlx-vlm, or Ollama if the model is available there) with good enough accuracy and speed to be worth adding as a parse recipe option?

## Candidates to check (non-exhaustive; search Hugging Face and mlx-community for others)
- Docling's own formula model (CodeFormula) forced onto MPS, or converted to MLX: baseline and reference output.
- Small general VLMs with MLX ports (e.g. Qwen2.5-VL / Qwen3-VL small sizes, SmolVLM / SmolDocling, Granite-Docling) prompted to emit LaTeX.
- Dedicated formula OCR (e.g. pix2tex / LaTeX-OCR, UniMERNet, Texify / Surya-style models), if they run on MPS.
- Page-level OCR VLMs (e.g. Nougat-family, olmOCR, dots.ocr) as an alternative to cropping formulas, if one runs locally.

## Method
1. Build a small gold set from the stat-mech PDFs: about 30 formulas (display and inline, both authors, a few with heavy subscripts / matrices). Crop each from the page image. Reference LaTeX comes from docling CPU CodeFormula output, hand-checked against the image; record which were corrected.
2. For each candidate that installs and runs on Apple GPU, measure per-formula latency (after warm-up), peak memory, and accuracy: exact match after LaTeX normalization, plus normalized edit distance, plus a render-equivalence check where cheap. Read all failures by eye.
3. Extrapolate: time to decode all 606 formulas (and the Kardar glyph-name spans, if the candidate can handle inline crops).
4. Retrieval check (small): pick 10 formula-heavy chunks, compare chunk text with placeholder / glyph names against chunk text with decoded LaTeX, and see whether the 31 hand queries or a few new formula-referring queries retrieve them better under embeddinggemma. Pilot only; the Phase 4 eval set is the real test.
5. Integration cost: how a winner would plug in (docling pipeline option, or a post-pass over the portable parse artifact producing a new parse recipe and so new chunk IDs). Note which fits the "parse artifact is portable docling JSON" decision.

## Decision rule (set now, to avoid post-hoc tuning)
Worth it if a candidate decodes the full corpus in under about 30 min on this machine, with at least about 90% normalized exact match on the gold set, and the retrieval pilot shows no harm. Slower or less accurate options are reported with numbers and left to the user (a GPU server is the fallback). Both outcomes count as a result.

## Output
- `scratch/sprint-1/spike-formula-vlm/results.md`: table of candidates (install effort, device, latency, memory, accuracy, notes), the gold set, scripts, and a recommendation.
- A design-feedback entry with the numbers (it bears on v0 item 1 and on Scale and Cost).
- Cheap decisions go in the decision log. Anything that changes v0 scope (e.g. adding formula decoding to the default parse recipe) goes to `open-questions.md`.

## Constraints and cautions
- Local Ollama is the standing choice for LLM calls; Hugging Face model downloads are new, so list sizes up front and keep them in a scratch cache, not the repo. If total downloads exceed a few GB, log an open question before pulling.
- Chunk IDs depend on text, so any decoded-formula recipe produces new chunk IDs. The chunker freezes before Phase 4 eval question generation, so this spike must conclude (and any recipe decision be made) before that freeze.
- Does not block any Phase 2 package.
