# Sprint 0 brief (current as of 2026-10-17, end of sprint)

**Goal:** committed contracts, validated by a thin end-to-end slice. **Status: met.** Not committed to git (nothing has been committed in this repo yet).

## State
- `packages/core` 0.2.0 (types, IDs, events, schema.sql, ports, runTool), `packages/testkit` (fakes, broken fakes, conformance suites, golden vectors, fixtures incl. real docling slices), `packages/app` (walking skeleton: `pnpm skeleton [--hash]`), 12 package cards with stub indexes. `pnpm check`: typecheck, dependency-cruiser, 278 tests, all passing (verified by the lead).
- Independent review: `review-phase1.md`; all should-fix items applied; 36 of 38 mutants die, 2 are non-behavioural.
- Architecture: `architecture-proposal.md`; drafts in `drafts/`; revisions in `contract-revisions.md` (R-01..R-32); spike write-up `pipeline-recipes.md`; notes in `../notes/phase1.md`.

## Decided (see decision-log.md)
Star packages; chunk ID = H(doc, section path, text, occurrence); TS chunker `section-pack/1` (keep, 312 chunks on the corpus); SQLite + sqlite-vec brute force; builds in v0 (content-addressed, ID covers items); logging at `runTool`/`KgApi`, MCP is an adapter; OCR off by default; parse artifact = portable docling JSON; no equation decoding; local Ollama for embeddings (embeddinggemma, 768d) and all LLM calls (qwen3.5); Phase 4 corpus = stat-mech pairs.

## Provisional
- Skeleton code stays hidden under `packages/app/src/skeleton` (Q5).
- embeddinggemma stays until after the Phase 4 baseline (Q4 resolved).
- P-1 named pools, P-2(a)/(c) deferred; reconsider when decomposition or critique is scheduled by evidence.

## Waiting on the user
- Record amendments in `design/` (Q1 builds in v0, Q2 logging below MCP, chunk reading of Rule 4, "current ingest" for Rule 5).
- Q5: promote, hide or delete the skeleton duplicates (recommendation: hide, use as a reference oracle).
- Not needed before Sprint 1: GPU-server parsing, equation decoding.

## Known gaps going into Sprint 1
- The mcp suite has not run against the real MCP SDK (zod 4 schema trap noted on the card). Viewer, embed and parse-sidecar acceptance tests are implementer-written.
- No SQLite store exists yet (store is the riskiest Phase 2 package); fake-vs-SQLite cross-check must come from the store package.
- Kardar PDFs render inline math as glyph names ("lparenori"); retrieval impact unmeasured. Parser quality gate / escalation (design-feedback) is not built.
- Greedy-packing cascade (L1), docKey collisions (L3), and other LATER items are in design-feedback.
- Judge model is weak (local qwen3.5): the judge needs hand-scored validation before Phase 4 numbers are trusted.
