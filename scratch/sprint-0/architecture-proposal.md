# v0 architecture proposal (lead synthesis of three drafts)

Status: for user sign-off. Sources: `drafts/minimal.md`, `drafts/extensible.md`, `drafts/testable.md`, each written independently from `brief-architecture.md`. This document records the review and the synthesis. The drafts hold the full type definitions and SQL; Phase 1 turns the chosen parts into `core`. Nothing here is committed to `design/`.

## 1. What the drafts agree on (treated as settled)

All three, reached independently:
- **Chunk ID** = hash(document key, section path, normalized text, occurrence of identical text in the section). No global index or ordinal, no database ID, no recipe. An insertion early in a document changes IDs only for chunks whose text changes. Spike evidence in design-feedback (2026-10-17, parse recipe) supports keeping the section path.
- **Star dependency shape.** Implementation packages import only `core`; one composition root wires them. Collaborators arrive by constructor injection.
- **One SQLite file per database**; embeddings in a plain table searched with `vec_distance_cosine` (no virtual tables), keyed by model and conditioning; parse artifacts stored gzipped in the file; immutability enforced by triggers.
- **Search pipeline** as a recipe of named steps; the runner logs every step's candidates and ranks, with a 100-candidate pool so the "ranked low" pre-check can be read from the log alone.
- **Builds from v0**, content-addressed, so an unchanged re-ingest yields the same build and superseded chunks (never deleted) stay out of results.
- **Docling sidecar** as a thin Python CLI, not docling-serve. The parse artifact is docling JSON in an envelope (source hash, recipe, stats), importable without Python. Chunk IDs are assigned in TypeScript, so they cannot depend on where parsing ran.
- **Logging one layer below MCP**, so agent and eval traffic share one path.
- Eval sets as content-hashed JSON files with gold text embedded; relevance scale 0/1/2; `usage` and `outcome` as typed events with no v0 tool.

## 2. Where they differ, and what I chose

| Question | Minimal | Extensible | Testable | Chosen | Why |
|---|---|---|---|---|---|
| Package granularity | 6 TS packages; one `engine` holds ingest, builds, search, logging | 16 packages incl. `derive`, `build`, `tools` | 14 packages, one per port | **Testable's split** | `engine` in the minimal draft is the one package a cheap model could not build from its contract alone (its own table rates it mid-to-strong). Extensible's `derive`/`build`/`tools` packages exist for layers v0 does not contain |
| Machinery for later layers | none; additive steps | producer runner, `BuildView`, registries, module augmentation, service locator | ports and step types added when needed | **Minimal's restraint, plus three cheap seams** (below) | Extensible's walk-throughs claim "no interface change" only because the interfaces already carry the machinery. Building it before a second consumer exists risks the wrong abstraction. Its own list of "where this still breaks" is as long as the others' |
| Chunker | TS reimplementation | sidecar `/chunk` (HybridChunker) | TS reimplementation (`section-pack/1`) | **TS, provisional** | The user's GPU-server goal needs an import-only machine to chunk without Python. Phase 1 compares it against HybridChunker on the four saved parse artifacts; if clearly worse, fall back to a second sidecar command with IDs still assigned in TS |
| Derived item IDs | derivation ID + output index | adds a text hash | adds a text hash | **Deferred** | v0 writes no derived text items. Logged in design-feedback |
| Store/log ports | sync | async | sync | **Sync** | better-sqlite3 is synchronous; fakes become trivial. A remote store later is a signature change, accepted |
| Test strategy | fakes + conformance | fakes + conformance | adds a *broken fake* per port that must fail its suite, golden ID vectors, meaningful fixtures with named failure modes, per-package cards | **Testable's** | Directly answers the Phase 1 criterion that fixtures must not pass trivially, and the independence criterion |
| Logging mechanism | `logged()` wrapper in Engine | `defineTool` + `Recorder` | `runTool` in core, used by `api` and by the fake | **Testable's** | The fake and the real API share one implementation, so their logging cannot diverge |

**Three cheap seams taken from the extensible draft** (all additive, none exercised by v0 logic): `SearchState` carries `queries` (v0 has one), `seeds` (empty) and `done`/`notes` (unused), so query refinement and graph walk add no field later; `StepTrace` has `considered`, `output` and a free `details` slot; embedding spaces are keyed by model plus conditioning template, so contextual node embeddings can add a space without touching items.

**Taken from the minimal draft:** the explicit definition of Rule 5's "current ingest" (the union of chunks over each document's current version) and the mutable-row list (only the document-version pointer and the current-build pointer).

## 3. Review against the Phase 0 criteria

**Traceability.** Each of the six Rules and v0 items 1-6 maps to a place in all three drafts (their section 9). Gaps I found:
- Rule 4 for chunks: chunks are "not derived", so they carry no recipe; parse and chunk recipes are recorded on the document version. The design says a chunk is never derived from anything else, while in practice a chunk comes from an artifact via a chunker. Reading adopted: chunks are ground truth, and recipe provenance sits one level up. Amendment worth making.
- Oracle variant "gold relations supplied" cannot exist until relations do. Condition names are open strings, so it is added later.
- Rule 5's "current ingest" is undefined in the design (definition above).
- The companion analysis tools are not in v0 and read only the log and eval results, so they join without contract change.

**Extension walk-throughs** (consolidated, all three agree on the substance):
- Relation layer, graph walk, reranking: additive (new step types, ports, tables already present). Reranking may need a second sidecar since Ollama has no cross-encoder endpoint.
- Equivalence: changes what an existing read means (a duplicate's sources join the canonical item). Plan: an optional `raw|canonical` view on reads, or a `canonicalize` step. Eval recall code must know which it gets.
- Query refinement: single-pass rewrite is additive. Critique loops need the runner to re-enter earlier steps. The `done` flag is reserved now; the loop itself is a runner change later.
- Community summaries: staleness gains member semantics inside `store`; eval already scores per kind.
- Weakest assumption across drafts: a linear step list can express decomposition and critique. Cheap Phase 1 test (from the extensible draft): *write* those two pipeline recipes against the contract and see whether they say what is meant.

**Independence.** With the testable split, each package depends on `core` and `testkit` only. Residual hidden couplings:
1. `core` is a hub and also holds logic (IDs, `runTool`, scoring, conditioning). A wrong core type ripples everywhere; Phase 1 must exercise it hard.
2. `store` and `eventlog` share one file and one `schema.sql` in core; coupling is through that text only.
3. `chunk` is the only package that knows docling's JSON layout, and the fixture it is judged on (a real ThermoPlischke slice) must exist before it starts.
4. `ingest` correctness (idempotency, no half-written document version) depends on `store` transaction semantics that the in-memory fake must reproduce.

**Decision quality.** Where drafts labelled a choice "needs the user" I re-sorted them (section 4). Two were mislabelled: document identity (arbitrary for v0, since the four stems are distinct; revisit when project databases start) and cross-database chunk IDs (they come for free from leaving the database ID out of the hash).

**Feasibility.** Spikes run: docling parse (speed, OCR, formulas), JSON round-trip, SQLite plus sqlite-vec, ID stability under OCR change. Still to run in Phase 1 before commitment: TS chunker against HybridChunker, embedding model comparison, and an insertion test on a real edited section.

## 4. Decisions

Settled by me (arbitrary or evidence-resolvable; each is in the decision log or visible above): package split, test strategy, logging mechanism, sync store ports, CLI sidecar, chunk ID scheme, content-addressed builds with an optional name and a mutable `current` pointer, 100-candidate trace pool (configurable), `docKey` default = file name without extension (overridable), embeddings brute-force.

Provisional pending a Phase 1 spike: TS chunker; embedding model (candidates `nomic-embed-text`, `mxbai-embed-large`, `bge-m3`).

**Needs you** (also in `scratch/open-questions.md`):
1. Builds in v0. The design's v0 section does not mention builds; all three drafts add them because Rule 6 needs a build on events, and superseded chunks must stay out of results. Recommend yes; costs one package of modest size.
2. Logging below MCP. The design says logging is "a property of the MCP tool layer" while also saying eval and agent sessions share one path. Recommend reading "MCP tool layer" as the tool contract, with MCP a thin adapter over it. This amends a sentence in the design.
3. Eval LLM provider for question generation and judging. Claude API behind a replay cache (better questions and judging, small cost, reproducible reruns) versus a local Ollama model (free, weaker judge, more passage-echo risk). Recommend Claude API. Blocks only the eval prompts and Phase 4.

## 5. Phase 2 work breakdown (from the testable draft, adjusted)

Phase 1 produces `core`, `testkit` and the package cards. Then, all startable in parallel: `parse-sidecar` (Sonnet), `parse` (Haiku), `chunk` (Sonnet; frozen before Phase 4), `embed` (Haiku), `store` (Sonnet), `eventlog` (Haiku), `ingest` (Sonnet), `search` (Haiku runner tests, Sonnet runner), `api` (Sonnet), `mcp` (Haiku), `eval` metrics/runner (Haiku) and eval prompts (Opus; waits on question 3), `viewer` (Haiku/Sonnet). `app` integration is Phase 3.

## 6. Biggest risks

1. `core` is a hub with logic in it; a wrong type there is expensive. Mitigation: the Phase 1 skeleton, plus writing the decomposition and critique pipeline recipes against the contract.
2. The TS chunker must match real docling output on cases the hand-built fixtures may not cover. Mitigation: real fixtures from both authors and the side-by-side with HybridChunker before the chunker card is frozen.
3. Parse recipe and chunker must be frozen before eval generation; an OCR escalation later invalidates that document's questions.
