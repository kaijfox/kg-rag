# Lifecycle: ingest sequence, search state, invariants (Sprint 1, Wave 0 item 3)

Written 2026-10-18 against `@kg/core` 0.2.0. Derived by reading `packages/core/src`, `packages/testkit` (conformance, fakes, tests), `scratch/sprint-0/architecture-proposal.md`, `scratch/sprint-0/contract-revisions.md`, and the hidden skeleton (`packages/app/src/skeleton/ingest.ts`, `search.ts`; read as a reader, not copied into any card). This document is an acceptance check for `store`, `ingest` and `search`: section 3 lists every invariant with the test that enforces it, and says "no test yet" where none does. "Fake" means `InMemoryCorpusStore`; a SQLite `store` must pass the same suites.

Vocabulary used here (from `prov-review.md` A1, A3): **content-addressed** ids are a hash of the output (`ch_`, `bd_`); **input-addressed** ids are a hash of recipe and inputs (`pa_`, `dv_`); `rc_` and `es_` are spec hashes; a **pointer** is one of the two mutable rows. Full glossary in section 0.

## 0. Glossary

- **content-addressed**: the id is a hash of the content itself (the output, or the set of members). Same content, same id; the recipe is not in the hash (`ch_`, `nd_`, `bd_`, `mp_`, `qs_`).
- **input-addressed**: the id is a hash of a recipe plus the inputs it was applied to (`pa_`, `dv_`). Same inputs give the same id, but the id does not check the output; a producer change the recipe does not record keeps the old id (CP-01).
- **spec hash**: the id is a hash of a canonical spec, not of a recipe applied to inputs (`rc_`, `es_`).
- **derivation**: a recipe applied to specific inputs (one artifact, one document, one set-level run). `DerivationRun` is the set-level case.
- **recipe** (plan): the declarative spec of how to derive something (`RecipeSpec`, `rc_`). It names no inputs.
- **early cutoff**: when a derivation's output is unchanged, downstream work that depends on it is not repeated. v0 example: an unchanged re-ingest writes and embeds nothing.
- **substitution**: using an existing output of the same derivation instead of running it again (v0: the parse cache keyed by (sha256, parse recipe) gives `origin: cache`; an artifact file gives `origin: imported`).
- **untracked dependency**: an input that changes the output but is in neither the recipe nor the id (v0 example: an embedding model named by a mutable tag, whose digest is not recorded; CP-01a).
- **lineage**: the chain of parent builds across ingests. It is recorded by the `build.created` event; `builds.parent_id` holds only the first-seen parent of a build ID (CP-03).

## 1. Ingest sequence

The two mutable rows in the whole database are `documents.current_version` (one per docKey) and `db_meta.current_build`. Everything else is insert-only (triggers in `schema.sql`). Ingest is all-or-nothing per call (R-09): reads and expensive work first, one transaction at the end.

| # | Phase | Writes | Pointer moved | Event (envelope buildId = current build when written, R-10) |
|---|---|---|---|---|
| 0 | precondition: embedder serves `config.space` (model, dims) | `putRecipe` x3 (parse, chunk, search), `putSpace` (idempotent) | none | none |
| 1 | identify (source file: `parser.identify` gives sha256; artifact file: sha is in the artifact) | none | none | `ingest.started {docKey, source{kind,path}, sourceSha256, parseRecipeId, chunkRecipeId}` |
| 2 | parse, cache or import: file -> `findArtifact(sha, parseRid)`; hit = `cache`, miss = `parser.parse` = `parsed` (echoed sha and recipe checked, else `upstream`); artifact file = `imported` | `putArtifact` immediately, outside the transaction (a finished parse is never thrown away) | none | `ingest.parsed {docKey, artifactId, origin: parsed/cache/imported, stats}` |
| 3 | chunk: `chunker(artifact, docKey, chunkRecipe)`; `dv_` = `docVersionId(docKey, artifactId, chunkRecipeId)`; counts computed against the store | none yet | none | `ingest.chunked {docKey, docVersionId, chunkCount, inserted, reused, dropped}` (dropped = chunks of the previous current version absent from this one) |
| 4 | embed: only `missingEmbeddings(space, chunkIds)`, rendered with `renderDocument` | none yet (vectors held in memory) | none | `ingest.embedded {docKey, spaceId, embedded, skipped, elapsedMs}` |
| 4b | S2/R-24: every OTHER current doc version lacking vectors in `config.space` is embedded too | none yet | none | `ingest.embedded` for that docKey, only if it embedded something |
| 5 | build + commit, ONE `store.transaction`: per document `putDocVersion` (not current), `putEmbeddings`, then `setCurrentDocVersion`; then `composeBuild` over `currentDocVersions()` with `parentId` = previous current build; `putBuild` (S2 check inside); `setCurrentBuild` only if the id differs from the previous current | doc versions, chunks, embeddings, build | **doc pointers** (every requested document, even when unchanged, as a no-op); **current build** only if `id !== previous` | none inside the transaction |
| 6 | after commit | none | none | `ingest.completed {docKey, docVersionId, unchanged}` per document, in request order; then `build.created {buildId, parentId, mixedRecipes, itemCount}` once, with envelope buildId = the new build, only if the current build moved |

Order of pointer moves: all document pointers first, then the build pointer, inside one transaction; no reader sees a build pointer ahead of its document pointers. A throw anywhere in phases 1-5 leaves no doc version, no pointer change, no build (artifacts from phase 2 may remain, and so may the `ingest.started/parsed/chunked/embedded` events already written; the failure is logged as `tool.failed`).

Event order per document is `started, parsed, chunked, embedded, completed`; with several documents the first four of all documents precede all `completed` events (the skeleton emits `completed` after the transaction). The scenario only requires the per-document order and that `build.created` is last.

Cases worth knowing:
- Unchanged re-ingest: `unchanged: true` per document, no build move, no `build.created`, nothing embedded.
- Space switch followed by a one-document ingest: the document may be `unchanged` while the build changes (the manifest's space changed); the build pointer moves, no document pointer moves.
- Return to an earlier state (ingest v1, v2, then v1 again): the rebuilt build id equals the old v1 build, which already exists. `putBuild` is a no-op, `setCurrentBuild` still runs, and `build.created` is still emitted (see section 4).

## 2. Search state and step rules

### 2.1 State (core `ports/search.ts`, 0.2.0)
`SearchState { query, k, buildId (readonly); queries: QueryVariant[]; candidates: Candidate[]; seeds: Seed[]; done: boolean; notes: JsonObject }`. Runner start state: one variant `{id:'q0', origin:'original', parentId:null}`, `candidates: []`, `seeds: []`, `done: false`, `notes: {}`. Runner event order: `query`, then one `search.step` per step (`stepIndex` 0..n-1), then `search.result`; the runner is the only emitter, all tagged with the search's `searchId` and `buildId` (not the current build). The final list is `sortCandidates(candidates).slice(0, k)`.

Step rules (conformance `searchStepConformance`): the input state is not mutated; output candidates are unique per item and sorted by `sortCandidates`; `output` of the trace equals the new candidates and is a subset of `considered`; both are properly ranked; query, k, buildId pass through; Rule 1 (non-empty `sourceChunkIds`) holds for every candidate.

### 2.2 `done` skip
Contract 0.2.0 says only that `done` is "reserved for critique loops; v0 runner ignores it (always false)" (`ports/search.ts`, search card step 3). The skip rule (the runner skips the remaining steps once `done` is set, except steps marked `final: true`) is proposal P-2a, **deferred by the lead**; no code, contract text or test implements it. This document records it as the intended rule for the state-machine spike to confirm, not as a v0 acceptance criterion. An implementation that skips on `done` today would diverge from the card.

### 2.3 Merge-on-retrieve (R-25, P-2b; adopted, in force)
A retrieval step outputs `fuseMax(existing candidates + retrieved)`, never a replacement; re-running a retrieval step on its own output changes nothing (scores only rise, no candidate is dropped). Every step's `considered` contains every candidate of the input state (the previous step's output) plus what it found, before its own cut. `vector-knn` embeds all `state.queries` in one call (`renderQuery`), runs knn per variant restricted to the build, tags candidates with `queryId`, and logs no cut: each variant contributes at most `pool` (default 100, `DEFAULT_POOL`). `truncate` is not a retrieval step: it cuts, so `output` is a strict prefix of `considered`.

### 2.4 Named pools (P-1) -- 0.3.0, applied (R-33); text below is the pre-0.3.0 note, superseded by `ports/search.ts`
Not in core 0.2.0 (`grep pools packages/core/src` is empty at the time of writing); another agent is adding it concurrently. As described by `contract-revisions.md` P-1 and `pipeline-recipes.md` (5d): `SearchState.pools: Record<string, Candidate[]>` (`{}` in v0); an optional `pools` summary on `StepTrace`; `vector-knn` gains an optional `into` param (default unchanged: fuse into `candidates`; when set, write the per-query lists to named pools such as `q0`, `q1`); a `fuse` step (not built in v0) reads named pools and writes `candidates`. Reason: with one candidate list, per-subquery fusion cannot be written. Rules this document will need once 0.3.0 lands (to be filled in from the final contract text, not guessed): whether R-25 merge applies to pools, whether `considered` must cover pool members, and the trace shape for pools. Until then: no pools invariant is checkable, and the step conformance suite has no pools case.

## 3. Invariants (one-line checks and the test that enforces each)

Test locations: `T/` = `packages/testkit/src/conformance/`, `C/` = `packages/core/test/core.test.ts`, `M` = `packages/testkit/test/meta.test.ts` (each suite must fail its broken fake). Quoted names are the start of the test name. A SQLite `store` is checked by running the same `corpusStoreConformance`; where the fake is the only thing proven, it is said.

### 3.1 Store and ids
| # | Check | Enforced by |
|---|---|---|
| S-1 | Only `documents.current_version` and `db_meta.current_build` are mutable; every other table rejects update and delete. | `C` "events are append-only and items insert-only (triggers)" (tests only `events` and `items`); `C` "Rule 4 CHECK: ... documents pointer is the mutable row" (documents). The other 20-odd triggers in `schema.sql`: **no test yet**. Port level: `T/store.ts` "Rule 2: an item id written again ..." (`M` catches `MutableStore`). |
| S-2 | Chunk id = `chunkId(docKey, sectionPath, text, occurrence)`, no recipe, no position. | `testkit/test/golden.test.ts` "chunkId"; `T/chunker.ts` "chunk IDs equal core chunkId ..."; `T/store.ts` "putDocVersion validates ids against core derivations" (`M` catches index-based ids). |
| S-3 | `putDocVersion` does not move the current pointer; `currentDocVersions()` lists only documents with a pointer, sorted by docKey. | `T/store.ts` "current doc versions: sorted by docKey ..." (empty after `seed`, which only calls `putDocVersion`). |
| S-4 | `setCurrentDocVersion`: `not_found` for an absent version, `invalid_input` for another docKey. | `T/store.ts` "current doc versions ...". |
| S-5 | `putDocVersion` is idempotent (`{inserted: [], reused: all}`) and reports inserted vs reused. | `T/store.ts` "putDocVersion reports inserted vs reused chunks and is idempotent". |
| S-6 | A reused chunk keeps its first-seen text; chunks are never deleted. | `T/store.ts` "a reused chunk keeps its first-seen text ..."; "Rule 5: staleCheck ..." (superseded chunk still readable). |
| S-7 | Re-putting an existing `dv_` with a different chunk list is rejected (`immutable_violation`, nothing written); the same ordered list stays a no-op. **Applied in 0.4.0 (CP-01b, R-34).** | `T/store.ts` "CP-01b: putDocVersion with an existing id and a different chunk list is an immutable_violation" (`M` catches `SilentDocVersionStore`). Port doc: `ports/store.ts`; fake: `fakes/store.ts`. A SQLite `store` must pass the same case. |
| S-8 | Embeddings are first-writer-wins; dims and references are checked. | `T/store.ts` "embeddings: missingEmbeddings, first writer wins ...". |
| S-9 | Build id = `buildId(manifest, sorted itemIds)`; parent and input order do not enter it; same manifest with different items gives a different build (S1). | `C` "composeBuild sorts items ... content-addressed"; `C` "S1: the build ID changes with the items ..."; `T/store.ts` "putBuild is content-addressed ..." and "S1: ...". Golden: `golden.test.ts` "artifactId, docVersionId, buildId". |
| S-10 | S2/R-24: `putBuild` refuses (`precondition`) any build holding an item without a vector in a manifest space; nothing is written. | `T/store.ts` "S2: putBuild refuses ..."; ingest side: `T/ingest.ts` "S2: after a space switch ...". |
| S-11 | `builds.parent_id` is the first-seen parent: a repeat `putBuild` of an existing id keeps the stored build whole, including `parentId`. | `T/store.ts` "S-11: putBuild of an existing build keeps the first-seen parentId" (added with 0.4.0). Documented in `ports/store.ts` ("parentId of the first write wins") and the store card (CP-03). |
| S-12 | `knn` is restricted to the build's items and the requested kinds; superseded chunks never come back; unknown build or space is `not_found`; wrong dims `invalid_input`. | `T/store.ts` "knn is restricted to the build ..." (`M` catches `LeakyKnnStore`), "... requested kinds", "knn on an unknown build ..."; fixtures: `knnFixtureSuite`. |
| S-13 | Rule 5: `staleCheck` flags a build citing chunks outside the current ingest (union of chunks of each document's current version). | `T/store.ts` "Rule 5: staleCheck ..."; `T/ingest.ts` "v1 -> v2: ... old build becomes stale". |
| S-14 | Labels are insert-only (same name + build: no-op; same name, other build: `conflict`). | `T/store.ts` "labels are insert-only ..."; `T/kgapi.ts` "snapshotBuild labels the current build ...". |
| S-15 | `transaction` undoes every write on a throw; nested calls join the outer one. | `T/store.ts` "transaction: a throw undoes every write ...". Against SQLite this is the load-bearing case for ingest atomicity. |
| S-16 | `setCurrentBuild` needs an existing build; `currentBuild()` is null on a fresh database. | `T/store.ts` "current build pointer: null at first ...". |

### 3.2 Ingest (`T/ingest.ts`, suite `ingestScenarios`, counts from hand-derived fixtures)
| # | Check | Enforced by |
|---|---|---|
| I-1 | First ingest: chunks inserted, pointers set, one build over all chunks, all embedded, search recipe in the manifest. | "first ingest: chunks inserted ..." |
| I-2 | Per document `ingest.started, parsed, chunked, embedded, completed`; `build.created` once, last, with the new build on the envelope; `chunked.inserted` equals the report. | "events: per document started, parsed, chunked, embedded, completed ..." (`M` catches `EagerIngestService`). |
| I-3 | Unchanged re-ingest writes nothing, embeds nothing, keeps the build id, emits no `build.created`. | "re-ingesting unchanged content ...". |
| I-4 | Parse artifacts are cached by (sha256, parse recipe): no second parse, `origin: cache`. | "parse artifacts are cached ...". |
| I-5 | Importing artifact files gives the same doc versions and build as parsing the sources; `origin: imported`; zero parses. | "importing artifact files gives exactly ...". |
| I-6 | v1 -> v2: inserted/reused/dropped equal the hand-derived diff; new build whose stored `parentId` is the old build; old build stale, new not. | "v1 -> v2: ...". |
| I-7 | Failure (embedder) leaves no doc version, no pointer change, no new build; the last event is `tool.failed`. Fresh database stays empty. | "an embedder failure mid-ingest ..."; "a failure on a fresh database ...". Only an embedder failure is scripted; a failure inside the commit transaction (e.g. `putBuild` precondition) is **no test yet**. |
| I-8 | Documents are embedded through the space template (headings included). | "chunks are embedded through the space document template ...". |
| I-9 | S2: after a space switch, a one-document ingest still gives a build fully embedded in the new space. | "S2: after a space switch ...". |
| I-10 | Incremental documents: the build covers all current documents. | "ingesting one document then another ...". |
| I-11 | The same docKey named twice in one request is `invalid_input`; embedder/space mismatch is `precondition`. | **no test yet** (card text only). |
| I-12 | Pointer order: all document pointers move before the build pointer, atomically. | **no test yet** (only the all-or-nothing outcome is tested, via I-7). |
| I-13 | `build.created` is emitted only when the current build moved; its `parentId` equals the build that was current before; `revert: true` iff the build already existed (0.4.0). `ingest.completed.previousDocVersionId` is the document's previous current version (null if none; equals `docVersionId` when unchanged). | `T/ingest.ts` "0.4.0 pointer events: previousDocVersionId on ingest.completed; build.created.parentId and revert" (v1, v2, back to v1 as a revert, unchanged re-ingest). Absence on unchanged: I-3; presence on first ingest: I-2. |

### 3.3 Search
| # | Check | Enforced by |
|---|---|---|
| Q-1 | Event sequence `tool.called, query, search.step x n (n>=1), search.result, tool.returned`; all search events carry the response `searchId`, `buildId` and the `tool.called` parent. | `T/search.ts` (`searchServiceConformance`) "event sequence ..." and "every search event carries ..."; `T/kgapi.ts` "search: tool.called -> query -> ...". |
| Q-2 | An explicit build is honoured by every event, and the recipe comes from the searched build (not the current one). | `T/search.ts` "an explicitly requested build is honoured"; `T/kgapi.ts` "search on an explicit, non-current build ...". |
| Q-3 | Steps do not mutate input; candidates unique and sorted; trace ranked, output within considered and equal to the new candidates; query/k/buildId pass through; Rule 1. | `T/search.ts` `searchStepConformance`: "does not mutate ...", "output candidates are ordered ...", "trace: considered and output ...", "query, k and buildId pass through", "Rule 1 ...". |
| Q-4 | Each step's `considered` contains the previous step's output. | step suite "considered contains every input candidate"; service suite "step traces: contiguous stepIndex ...". |
| Q-5 | R-25 merge-on-retrieve: a retrieval step keeps every existing candidate (score not lower) and is idempotent on its own output. | step suite "P-2b: a retrieval step merges ...", run for `vector-knn` with `retrieval: true` only. A retrieval step registered without that flag is not checked. |
| Q-6 | The query is embedded through the space query template. | service suite "the query is embedded through the space query template" (optional harness fields); `searchFixtureSuite` asserts the rendered query text. |
| Q-7 | Response validates, ranks 1..n, n <= k, `search.result` equals the response, `stale` equals `staleCheck`. | service suite "response validates, ranks are 1..n ..."; `searchFixtureSuite` (`stale` true for the v1 build once v2 is current). |
| Q-8 | Rankings on the mini-corpus equal the hand-derived expectations; superseded chunks never appear. | `searchFixtureSuite`, `knnFixtureSuite`. |
| Q-9 | Trace pool: `vector-knn` logs up to `pool` (default 100) candidates per variant without cutting `considered`. | **no test yet** (the `pool: 3` harness runs the generic cases only, no size assertion). |
| Q-10 | `done` skip (P-2a). | **no test yet; not in the contract** (section 2.2). |
| Q-11 | Pools (P-1). | **pending 0.3.0**, no test yet (section 2.4). |

### 3.4 Events and pointers
| # | Check | Enforced by |
|---|---|---|
| E-1 | Payloads validate against the catalog; Rule 6 (build-dependent events carry a build; payload buildId equals the envelope's); search events carry a searchId. | `T/eventlog.ts` "payloads are validated ..." and "Rule 6 and search linkage ..." (`M` catches `NoValidateLog`); `C` "validateEventDraft enforces buildId ..."; `C` "eval.run.started: payload buildId must equal ...". |
| E-2 | Event `buildId` is the current build when written (R-10); events of a search/feedback/usage keep the build of their search after the pointer moves. | `C` "the default buildId is the current build when an event is written ..."; `T/kgapi.ts` "after the build changed, usage, outcome and items.fetched keep the right builds"; "feedback after the current build changed ...". |
| E-3 | The log is append-only with contiguous per-session `seq`. | `T/eventlog.ts` "append assigns id, ts and contiguous per-session seq ..." (`M` catches `GappySeqLog`); trigger test `C` "events are append-only ...". |
| E-4 | Every pointer move emits an event carrying old and new values (section 4). | Covered for ingest by I-13 (both pointers; 0.4.0). Not covered: pointer moves outside ingest (none exist in v0). |

## 4. Pointer moves are events (PROV review A5, A6)

Rule: **every change of a pointer (the current build, a document's `current_version`) emits an event with the old and the new value.** The log, not the tables, is the history: the pointers are the only mutable rows, and a reflog is what makes them auditable. `builds.parent_id` is the **first-seen** parent only (`putBuild` keeps the first writer; a build is content-addressed and has no single true parent). The real lineage of how the database arrived at a build is the sequence of `build.created` events with their `parentId`. Docs and the store card should say so (A5).

What the events carried in 0.2.0, with the 0.4.0 changes marked (checked against `events.ts`, the ingest card and the skeleton):

| Pointer | Event | New value | Old value | Gap |
|---|---|---|---|---|
| `documents.current_version` | `ingest.completed {docKey, docVersionId, unchanged, previousDocVersionId}` | yes (`docVersionId`) | yes (`previousDocVersionId`, null if none). **Applied in 0.4.0.** Optional in the schema only so pre-0.4.0 logs validate; ingest always sets it. | none |
| current build, via ingest | `build.created {buildId, parentId, mixedRecipes, itemCount, revert?}` | yes (`buildId`, also the envelope's buildId) | yes (`parentId` = previous current build). **Applied in 0.4.0:** optional `revert: true` when the build already existed (the pointer moved back to an existing build); then `parentId` differs from the stored first-seen `parent_id`. Chosen as an optional field (no new event type, no rename). | none |
| current build, other paths | none exist | -- | -- | The design says "the winning build becomes current" and a rollback is conceivable; no tool or event does this in v0. A later "make build X current" path must emit the same old/new event (A6); add the event type when its tool is built. |
| build labels | `build.labeled {buildId, name}` | n/a (labels are insert-only, not a pointer) | n/a | none |

Status after 0.4.0 (R-34): (a)-(c) below are resolved: both old values are in the log and tested (I-13). The text that follows is the 0.2.0 assessment, kept for the record. Acceptance against this rule at 0.2.0: (a) the new value is present for both pointers (testable now; the event-order and build tests cover `build.created.buildId` indirectly through the envelope, I-2); (b) the old value on `build.created.parentId` is a convention in the card, **no test yet** (I-13); (c) the old document version is **not carried by any event**, so the rule is not met for document pointers until `ingest.completed` or a new event gains it. Both gaps are contract proposals for core and are not made here.

## 5. Open points for the three consumers
- `store` (SQLite): S-1 (all triggers), S-7, S-11 and S-15 are where the fake proves least; add cross-checks (fake vs SQLite) for S-7 and S-11.
- `ingest`: I-7 beyond embedder failure, I-11, I-12, I-13 have no test; the card and this document are the only specification.
- `search`: Q-9, Q-10, Q-11 have no test; Q-5 only covers steps registered as `retrieval`.
