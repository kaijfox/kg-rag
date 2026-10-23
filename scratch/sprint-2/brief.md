# Sprint 2 brief (state at the end, 2026-10-23)

**Goal:** Phase 4 baseline measurement. Met on a subset; the first expansion is ambiguous and goes to the user (Q17).

## State
- Chunker frozen (recipe version '1', undecoded parse), 91 mutants tried on it, tests pinned. Two author indexes, 63 reviewed questions, judge validated (kappa 0.74), own-corpus and cross-corpus answer runs, retrieval pre-checks, paraphrase check, extraction pilot on 24 chunks.
- Results and recommendation: `results.md` (tables `results-tables.md`). Headline: similarity search is already strong on this small, easy test; the clearest gap is topic-level questions (n = 11); multi-hop could not be tested; the relation extractor is not ready.

## Provisional / not done
- Multi-hop (12) and topic (11) subsets are small. Local model quality limits them (Q16).
- Decoded-formula build (required follow-up from the 2026-10-23 decision on the parse recipe): not started; scope after Q17.
- arXiv corpora (Q15): not started. Judge determinism check not done. Embedding comparison (Q4) not done.
- Kardar glyph artifacts (57% of chunks) unfixed; a fix is a new chunk recipe.

## Waits on the user (`../open-questions.md`)
- Q16 generator for multi-hop and topic questions; Q17 first expansion.

## Links
`results.md`, `results-tables.md`, `judge-validation/RESULT.md`, `pilot/evaluation.md`, `review-*.json`, `exclude-*.json`, `../decision-log.md`, `../design-feedback.md`, `../notes/chunk-freeze-tests.md`, `../notes/small-fixes.md`.
