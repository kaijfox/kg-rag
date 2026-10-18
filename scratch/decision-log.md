# Decision log

One entry per decision: date, the choice, its kind (arbitrary / evidence-resolvable / user), and a one-line rationale. Evidence-resolvable and user decisions also list options considered and the evidence.

## 2026-10-17: No equation decoding in Sprint 0
Kind: user decision. Docling formula enrichment is skipped (formulas stay as placeholders or images). Reason: CPU decoding is correct but slow (194s for 3 pages), and MPS is unsupported; see design-feedback entry of the same date. Revisit later with a GPU server.

## 2026-10-17: Parsing must be separable from the rest of the pipeline (architecture constraint)
Kind: user decision. v0 should later be usable with parsing run on a GPU server and the processed/chunked output transferred back easily. Phase 0 treats this as a constraint: the parser's output is a self-contained, portable artifact keyed by source file hash and parser recipe (docling version and options), and ingest can consume such an artifact without running docling locally. The sidecar's deployment form (local process or remote service) must stay a configuration choice behind the parser interface.

## 2026-10-17: Store is better-sqlite3 + sqlite-vec (one SQLite file per database)
Kind: evidence-resolvable. Options: sqlite-vec, LanceDB. Evidence: both install on Node 22 / arm64; sqlite-vec loads into better-sqlite3 (SQLite 3.53.4, vec 0.1.9) and brute-force KNN over 20,000 x 384 vectors takes 1.7 ms/query; the stat-mech corpus parsed to 337 chunks in total. Chunks, embeddings and the event log share one file, matching design v0 item 2, and one file is easy to copy to or from a server. LanceDB was only installed, not benchmarked, because nothing here needs it. Revisit under Scale and Cost if latency becomes an issue.

## 2026-10-17: Parse with do_ocr=False by default
Kind: evidence-resolvable. Options: OCR on (docling default), OCR off. Evidence: all four PDFs have a text layer; on ThermoPlischke OCR off parses in 5-6s against 90s and removes the garbled text OCR produced ("ideal gas law" passage now clean). OCR becomes a per-document parser option recorded in the parse recipe, for genuinely scanned sources.

## 2026-10-17: Embeddings come from a local Ollama model
Kind: user decision. Specific model is an open sub-choice for Phase 0 (spike: quality and speed on stat-mech chunks via Ollama's HTTP API). Embeddings are stored keyed by model and conditioning, per the design doc.

## 2026-10-17: Phase 4 corpus is the stat-mech set (two topics x two authors)
Kind: user decision. The roadmap's "does it suffice" question is answered: it does for the baseline. 337 chunks in total.

## 2026-10-17: Phase 0 uses distributed drafting, with review and synthesis done by the lead
Kind: user decision. Amends the roadmap's Phase 0, which has one author. Three agents draft module architectures independently from a shared brief (`scratch/sprint-0/brief-architecture.md`), each under a different lens. The lead agent (not separate reviewers) runs the Phase 0 review criteria across the drafts, synthesizes one proposal, and takes it to the user for sign-off. To be recorded as a dated amendment in the roadmap by the user.

## 2026-10-17: Section path stays in the chunk ID; the parse recipe is frozen with the chunker
Kind: evidence-resolvable. Options: ID = H(doc, sectionPath, text, occurrence) or the path-free H(doc, text, occurrence) fallback two drafts proposed. Evidence: OCR on vs off over ThermoPlischke and FoundationsKardar (design-feedback entry of this date) shows the headings are stable and the text is what changes, so the fallback gains nothing. Keep the section path; it also keeps identical text in different sections distinct.

## 2026-10-17: Architecture signed off (user), with answers to Q1-Q3
Kind: user decision. Q1: builds are in v0 (content-addressed, created by every changing ingest). Q2: logging lives in the shared tool contract (`KgApi`/`runTool`), MCP is a thin adapter; this amends the design sentence "logging is a property of the MCP tool layer" (to be recorded as a dated amendment by the user). Q3: every LLM call (eval question generation, judging, answering) uses a local cheap Ollama model for now, to move to a GPU server soon after v0. Consequence: the `Llm` port stays provider-neutral; the judge must be validated against hand-scored examples with extra care because the model is weak; replay caching is kept so reruns are free and reproducible. Basis: `scratch/sprint-0/architecture-proposal.md`.

## 2026-10-17: Autonomy while the user is away (user instruction)
Kind: user decision. The lead decides the remaining Sprint 0 choices without waiting. Be reserved where unsure: park anything that changes a core concept, a rule or the v0 scope in open-questions.md and proceed only on the recommended provisional default if it is cheap to redo. Where the choice is between a computationally expensive route and a cheap one, take the cheap one for Sprint 0.

## 2026-10-17 (Phase 1): TS chunker section-pack/1 kept; HybridChunker fallback not needed
Kind: evidence-resolvable. Options: TS section-pack/1 (provisional in the proposal), docling HybridChunker via a
second sidecar command. Evidence (design-feedback spike 5a): on the four OCR-off parses TS gives 312 chunks vs 336,
median 855 vs 822 chars, under-200 chunks 3 vs 8, mid-sentence ends 30 vs 56, the same section paths, and all 20
spot-checked boundaries at block or sentence ends; the shared weakness (a "where ..." continuation cut from its
formula) occurs in both. Rationale: not worse on any measure, and import-only machines need no Python.
The chunker is still frozen only before Phase 4.

## 2026-10-17 (Phase 1): chunk ID scheme confirmed on real edits
Kind: evidence-resolvable (closes the open "insertion test" item). Evidence: design-feedback spike 5b: 100% of
chunks outside touched sections keep their IDs; an index scheme lost 19 of 39 when an insertion added a chunk.

## 2026-10-17 (Phase 1): embeddinggemma:latest with its retrieval prompts is the provisional embedding space
Kind: evidence-resolvable, partially (only one model was available). Options: the proposal's candidates
(nomic-embed-text, mxbai-embed-large, bge-m3), none installed; embeddinggemma installed. Evidence: spike 5c: 768
dims, 39 chunks/s, recall@10 0.81 with templates vs 0.68 without on 31 hand queries. Rationale: adequate for the
baseline; spaces are keyed by model and templates, so switching costs one re-embed. Comparison pending Q4.

## 2026-10-17 (Phase 1): tooling versions
Kind: arbitrary. TypeScript 5.9.3 (not 7.0: dependency-cruiser and tsx rely on the JS compiler API), zod 4.1.12
(built-in JSON Schema export for the sidecar), vitest 3.2.4, dependency-cruiser 17.4.3, tsx 4.21.0, pnpm 10.29,
Node 22.17; packages export TypeScript sources directly (no build step). Any recent versions give the same result.

## 2026-10-17 (Phase 1): skeleton uses the in-memory store and log from testkit
Kind: arbitrary. A thin SQLite store would have been a second, untested implementation of the Phase 2 store;
the in-memory fakes pass the same conformance suites. schema.sql is still exercised against real SQLite in core's tests.

## 2026-10-17 (Phase 1): ingest is all-or-nothing per call
Kind: arbitrary. Doc versions, embeddings, pointers and the build are written in one transaction after every
document is parsed, chunked and embedded; parsed artifacts are stored immediately. Per-document commits would also
satisfy the rules; one transaction makes "no half-written document version" trivially true.

## 2026-10-17 (Phase 1): small contract choices
Kind: arbitrary, one line each. normName keeps brackets (R-01; the testable draft's own example needs it).
title headings are level 0 (any value below section headers gives the same paths). The search fixture's
HashEmbedder uses 4096 dims (fewer bucket collisions, so rankings are explainable by word overlap).
Feedback carries overall and per-item relevance in one call (R-06; same events, fewer MCP calls). Build labels
are insert-only (R-04; the design's "named, pinned manifest").

## 2026-10-17: Q4 resolved: embeddinggemma for Sprint 0 and the baseline; more embedding models only after the Phase 4 baseline
Kind: arbitrary under the user's standing instruction (cheap option for Sprint 0). The embedding space is keyed by model and templates, so a later switch re-embeds about 312 chunks and changes no chunk ID or eval question. Comparison runs against the pinned eval set, not against 31 hand queries.

## 2026-10-17: Phase 1 verified by the lead; independent review (stronger model) requested
Lead re-ran `pnpm check` (221 tests passing: core 17, testkit 126, app 78) and `pnpm skeleton --hash`; the log for one search reads query -> step 0 vector-knn -> step 1 truncate -> result -> feedback, and a feedback call on an unknown search fails with `not_found` and leaves `tool.failed`. P-1/P-2/P-3 (contract-revisions.md) are held until the independent review reports.

## 2026-10-17: Phase 1 review outcome and contract decisions (lead, autonomous)
Basis: `scratch/sprint-0/review-phase1.md` (independent reviewer, strongest model; no BLOCKER, 7 SHOULD-FIX, 38 mutants of which 25 caught). Kind: evidence-resolvable; the review contains the evidence.
- Adopt before fan-out, in `core` 0.2.0 and testkit: S1 (hash item IDs into the build ID), S2 (every build item must have an embedding in each manifest space, else `precondition`), S3 (`getItems` with `buildId` returns members only; `buildId` on `eval.run.started` with envelope equality; build tags tested on usage/outcome/step/result), S4 (eval card gets a store/staleness read, a defined `oracle-gold-first`, and `orphanedGold`), S5 (pack by `normText` length), S6 (viewer gets `itemInfo -> {label, text}`), `queryId` on `RankedRef`, P-3 via `AsyncLocalStorage` in `runTool`, P-2(b) merge-on-retrieve, plus the survivors' missing tests (M03, M08-M10, M16, M17, M20-M23, M31, N4).
- Defer: P-1 named pools (no consumer yet; revisit when decomposition is scheduled by evidence; the weaker option of allowing one entry per (itemId, queryId) between retrieval and fuse steps is recorded as the first thing to try), P-2(a) `done` skipping and P-2(c) `searched` (no consumer or test; contract text no test enforces invites drift), L1-L8 (design-feedback).
- S7 (skeleton duplicates five Phase 2 packages): parked in open-questions.md as Q5; provisional default is to leave it under `app/src/skeleton`, hidden from implementers.
- Not pulling forward: promoting skeleton code into packages, re-opening the package split, or folding eventlog into store.

## 2026-10-17 (Phase 1 fixes, contract 0.2.0): choices made while applying the review
Kind: arbitrary unless noted, one line each.
- S2 is enforced in `putBuild` (one place) and satisfied by ingest embedding the other current documents' missing
  chunks; the alternative (ingest fails with precondition after a space switch) would make switching spaces need a
  full re-ingest. Consequential but resolved by the design text ("switching embedding model" is sanctioned).
- Merge-on-retrieve does not cut to the pool: each variant contributes at most `pool`, the union is logged whole.
- Hard cuts take the shortest prefix of normalized length M, so single-spaced fixtures split exactly as before.
- The eval-runner suite builds its own environment from fixtures (scripted retrievals keyed by question text), so
  recall must equal expected-metrics.json; its control is a test-only reference runner, not shipped code.
- The MCP suite takes a `connect(api)` adapter so it runs without the SDK in testkit; app runs it on `mcpCall`.

## 2026-10-18: Sprint 1 additions and Rule 4 reading (user decisions)
Kind: user decision. (1) Adopt P-1 (named candidate pools in SearchState, `pools: {}` in v0; `vector-knn` gets an optional `into` param; fuse step deferred) as part of Sprint 1, a core 0.3.0 contract bump before fan-out. Rationale: cheap while no package is built; keeps decomposition expressible with per-subquery traces. (2) Rule 4 amendment wording: chunks are derived from source documents by a parse recipe and a chunk recipe recorded on the document version; they are the base layer that all later items cite, and are immutable; a different parser or chunker produces new chunks. "Ground truth" is dropped. (3) Sprint 1 task: a reviewer maps the provenance model onto W3C PROV and Nix/Bazel/DVC vocabulary to check for missed established ideas. (4) Keep a small agent-scored sample (about 30 answers) to validate the judge; no human scoring. (5) Q5 option (b). Amendments 1, 2 and 4 (builds, logging below MCP, "current ingest") approved for recording in design/ as a dated block, pending final wording sign-off.
