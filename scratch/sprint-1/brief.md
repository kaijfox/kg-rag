# Sprint 1 brief (state at the end, 2026-10-18)

**Goal (met):** all v0 components built from their cards and working together, including the viewer (roadmap Phases 2 and 3). Phase 4 (baseline measurement) is Sprint 2.

## State
- 16 packages in `packages/`, contract `@kg/core` 0.6.1, 903 tests passing plus 24 in the sidecar, `pnpm depcruise` clean. Git has one commit (Sprint 0); the Sprint 1 work is uncommitted (218 paths).
- Pipelines are XState machines in `@kg/pipeline` (search `similarity`, ingest, eval run and question, generation, judge). Formula decoding is an optional parse stage; the default recipe has none.
- Integration on the stat-mech corpus: 312 chunks, first ingest 8.0 s, re-ingest 60 ms with the same build, search median 29 ms, viewer checked live and finished in Chrome. Rules 1, 5, 6 audited with zero violations (Rules 1 and 4 vacuous for derived items).
- Reviews: four reports, no blocker, 15 should-fix items, about 65 of 203 mutants survived; oracle diff against the hidden skeleton found 13 divergences. Review fixes are applied. Triage and retro are done.
- No eval number is trustworthy: the judge is unvalidated.

## Provisional
- Embedding model embeddinggemma until after the baseline (Q4).
- The chunker is not frozen; ids may still move. Chunk recipe `version '1'` is provisional until the freeze.
- Defaults: undecoded formulas (Q13), local Ollama (qwen3.5) for all model calls.
- Deferred: delta-encoded `considered` in the log, relation `position` column, summary storage, parser quality gate, Kardar glyph cleanup, PROV export, derived item identity (AM-7).

## Waits on the user (`../open-questions.md`)
- Q12 approve amendments AM-1 to AM-6, AM-8 (`proposed-amendments.md`).
- Q13 freeze the baseline on the undecoded parse recipe.
- Q14 commit the Sprint 1 state.
- Q15 timing of the arXiv-with-LaTeX corpus (recommended after the baseline).

## Sprint 2 prep (Phase 4)
1. Re-run the chunk mutation survivors; freeze the chunker and parse recipe together (needs Q13); then generate questions.
2. Judge validation: run `judge-validation/plan.md` on 30 answers (10 per condition, forced hard cases, scorer a stronger model, blind, two passes); thresholds are pre-registered in the decision log. Report the judge's retry and failure rate.
3. Question leakage review: sample questions for passage wording (4-word copy rule), passage-dependent phrasing (two seen: "equation (2.10)"), gold uniqueness and answerability without context (no-context judged 0.75 in the integration run). Log the 25 to 40 percent of generation groups that are dropped, with reasons.
4. GPU server: not needed for formula speed (decoding takes 4 minutes). An eval run costs about 19 to 29 s per question on the laptop; budget a few hours locally, or switch the model client when the server exists. Record the Ollama digest of judge and answerer in the run.
5. Pre-checks from the failure-mode table: rank distribution of gold items (reranking); all-gold recall on multi-hop against single-hop and the gap to the ceiling; topic-level gap; the "evidence split across chunks" signature; paraphrase recall for failing queries; a pilot extraction on a sample (not-extracted, fragmentation, conflict rates). Also the share of Kardar chunks with glyph names, and the formula-tagged question subset with a decode-only-gold oracle.
6. Fixes first (check which are already done): a test for the failed-state record, `pool < k` check, MCP `search` default `k`, viewer list stability, viewer type declarations.
7. Measure the log size after the baseline run to settle delta encoding.

## Links
Triage `../design-feedback.md` (originals `design-feedback-triaged-originals.md`); `proposed-amendments.md`; `retro.md`; `../decision-log.md`; reviews `review-*.md`; `integration-report.md` and `change-proposals/`; `lifecycle.md` (stale, written against 0.2.0); `contract-0.6.1.md`; spikes `spike-state-machine.md`, `spike-formula-vlm.md`; PROV `prov-review.md`, `prov-followup.md`; plans `state-machine-revision.md`, `judge-validation/plan.md`.
