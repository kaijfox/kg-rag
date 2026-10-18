# Contract revisions from the Phase 1 walking skeleton

Baseline: `scratch/sprint-0/architecture-proposal.md` (signed off) and the drafts it adopts, mainly
`drafts/testable.md`. Each entry: the change, the evidence, the packages and tests it affects, and the in-flight
work it invalidates. **Applied** = already in `@kg/core` 0.1.0 / `@kg/testkit` (cheap, needed to build the
skeleton; reviewer may reverse). **Proposed** = not applied; needs a decision before fan-out.
In-flight work: Phase 2 has not started, so no package code is invalidated by any entry; where an entry
supersedes text in a draft, that text is named so nobody builds from it.

## Applied

**R-01 normName keeps brackets.** testable §2.1 says leading/trailing punctuation is stripped and that
"Dorsolateral Striatum (DLS)." becomes "dorsolateral striatum (dls)"; stripping `)` contradicts its own example.
Now: brackets `( [ {` are kept at the start and `) ] }` at the end. Evidence: golden vector. Affects: core ids,
golden vectors, future relation layer (node IDs). Supersedes testable §2.1 normName comment.

**R-02 `headings` removed from Chunk/ChunkDraft and the `chunks` table.** In section-pack/1 it always equals
`sectionPath`; two fields that must agree invite divergence. Conditioning reads `sectionPath`. Affects: core
model, schema.sql, conditioning, chunk, store, ingest. Supersedes testable §3 ChunkDraft and §4 `chunks.headings`.

**R-03 Per-version chunk provenance.** The chunk ID ignores pages, block refs and whitespace, so a re-parse (other
recipe, other docling refs) or a whitespace-only difference yields the same ID with different provenance; an
insert-only `chunks` row then either throws or silently rewrites. Now: `chunks` keeps the first-seen text and
provenance; `doc_version_chunks` carries per-version `pages` and `block_refs`; a reused chunk is never rewritten.
Evidence: corpusStoreConformance "a reused chunk keeps its first-seen text". Affects: schema.sql, store, ingest.

**R-04 Build names are insert-only labels.** Builds are content-addressed (an unchanged re-ingest gives the same
ID), so a mutable `builds.name` column conflicts with idempotent `putBuild`. The design calls a build "a named,
pinned manifest". Now: `build_labels(name PK, build_id)`, `CorpusStore.labelBuild/getLabel`,
`KgApi.snapshotBuild` labels the current build, new event `build.labeled`; `Build.name` removed. Affects: core
model/ports/events/api, schema.sql, store, api, viewer.

**R-05 `stale` on every SearchResponse and `search.result`.** Rule 5 needs a flag when a search runs against a
pinned build that cites chunks outside the current ingest (eval on a pinned build); the testable draft only
flagged staleness on snapshot. Evidence: searchFixture expects `stale: true` for every v1-build query once v2 is
current. Affects: core model/events, search, api, eval, viewer.

**R-06 Feedback takes overall and/or per-item relevance in one call** (`{searchId, overall?, items?: [{itemId,
relevance}], note?}`, one `feedback` event; per-item IDs must be among the search's results). testable §3.2 had one
item or overall per call, so an agent rating five results makes five MCP calls. Design v0.5: "per item or
overall". Affects: core api/events, api, mcp, viewer, eval (feedback analysis).

**R-07 Eval's path to the log.** `eval.*` and `llm.called` were in the catalog with no emitter: eval is not a
KgApi tool, and `EventLog.append` may only be called by runTool. Now: core `EVAL_RUN_TOOL` (a ToolDef not in
TOOLS, so MCP never exposes it) run through `runTool`, and `loggedLlm(llm, ctx)` that emits `llm.called`.
Evidence: fixtures/log/session-eval.jsonl. Affects: core, eval.

**R-08 Recipes come from a DatabaseConfig, not the ingest request.** testable's IngestService took parse, chunk
and space recipes per request, which an MCP client should not have to send. Now: `createIngest({..., config})`,
`IngestRequest = {sources?|artifacts?: {path, docKey?}[]}`. Affects: core ports/ingest + api TOOLS.ingest, ingest,
mcp, app. (Comparing chunk recipes is then a second database, not a request flag.)

**R-09 Parser gains `identify(path)` and `readArtifact(path)`.** Ingest needs the sha256 before parsing to hit the
artifact cache, and artifact import needs file reads; neither ingest nor api may do I/O outside a port. Affects:
core ports/parse, parse, ingest. Supersedes testable §3 Parser and §7 "ingest accepts a list of artifact files".

**R-10 Ctx changes.** `emit` returns the stored envelope (feedback must return its eventId); the default
`buildId` is the current build when the event is written (a call-start value went stale during ingest);
`Ctx.buildId` removed; `Ctx.parentEventId` added. Affects: core, every handler/service.

**R-11 section-pack/1 packing rule 4.** A chunk shorter than minChars may take the next block up to maxChars
(testable §7 only merged a short *final* piece). Without it a short lead-in sentence before a long paragraph
becomes a chunk of its own. Evidence, honestly small: on the four stat-mech artifacts it changes one chunk
(312 chunks with the rule, 313 without; chunks under 200 chars 3 vs 4). Kept because it is cheap and the
fixture encodes it; dropping it is also defensible (arbitrary). Affects: chunk (spec in
packages/chunk/CARD.md), mini-corpus fixture (`gas/1-cd`, `entropy/2`).

**R-12 section-pack/1 precisions from real docling output.** Furniture texts sit inside `body.children` (filter
by `content_layer`, and drop page_header/page_footer labels regardless); pictures have child texts (axis
labels: 194 in ThermoKardar) that must not leak; captions appear both as picture/table children and as
standalone body texts (never referenced by both, but dedupe visited refs anyway); `title` = level 0; table
block = caption + grid; formula = its text if decoded else `[formula]`; inline groups join with spaces.
Affects: chunk, fixtures (docling-real).

**R-13 `QueryVariant.parentId`** (lineage for decomposition and paraphrase; additive).

**R-14 `searchId` lives on the envelope only** (removed from query/search.step/search.result/feedback/usage
payloads); `SEARCH_REQUIRED` types need it; build.* events need envelope `buildId` = payload `buildId`.
Duplication invited divergence. Affects: core events, every emitter, viewer.

**R-15 `ingest.parsed.origin` = parsed | cache | imported** (was `cached: boolean`, which cannot say "imported").

**R-16 testkit has two entry points**: `@kg/testkit` (fakes, fixtures, broken fakes; no vitest) and
`@kg/testkit/conformance` (suites). Evidence: the skeleton script crashed importing vitest at runtime.

**R-17 `Clock.monotonicMs()`** for durations, so no package calls `performance.now()`.

**R-18 Object outputs for every tool** (`getItems -> {items}`, `addNote -> {noteId}`): MCP structured content must be
an object.

**R-19 Eval IDs**: `EvalRunId` (`er_` ULID), `EvalSetId` (`qs_`, `evalSetId(questions)` content hash); IdGen gains `er_`.

**R-20 Error codes are contract** (`KgError.code`: invalid_input, invalid_event, not_found,
immutable_violation, conflict, precondition, upstream, not_implemented, internal); `tool.failed` carries them;
suites assert them.

**R-21 Small port additions**: `CorpusStore.getDocVersion`, `getSpace`; `EvalRepo.getRun`;
`LogReader.getSession`; `LogReader.addNote` returns the note; core `findSearch` (the one Rule 6 lookup) and
`composeBuild` (the one definition of a build's contents).

**R-22 JSON Schemas generated from zod** (`core/schemas/parse-artifact.schema.json`, `parse-recipe.schema.json`)
with a freshness test, for the Python sidecar. `parseArtifactSchema` checks only DoclingDocument's top-level keys.

## Applied in 0.2.0 (pre-fan-out fixes from `review-phase1.md` section 8; scope: decision log "Phase 1 review outcome")
In-flight work: none (Phase 2 not started). Re-recorded once: `testkit/fixtures/log/*.jsonl`, the golden build vector.

**R-23 Build ID covers the items (S1).** `buildId(manifest, itemIds)` = H('build/2', canonical manifest, sorted
unique itemIds). Evidence: the manifest names derived recipes, not items, so re-extracting failed chunks under the
same recipe gave the same build. Affects: core ids/builds, every putBuild, golden vector, store card. Test: store
conformance "S1", core "S1".

**R-24 A build never holds unembedded items (S2).** `putBuild` refuses (`precondition`) when an item lacks a vector
in any manifest space; ingest embeds every current document's missing chunks in the config space before building.
Evidence: review experiment (space switch, one-document re-ingest: build of 17, search sees 8, no flag).
Affects: core store/ingest docs, fake store, skeleton ingest, ingest and store cards. Tests: store "S2", ingest
scenario "S2: after a space switch".

**R-25 Merge-on-retrieve (P-2b).** Retrieval steps output `fuseMax(existing + retrieved)`; re-running one is
idempotent; every step's `considered` contains the previous step's output. Affects: core search doc, skeleton
vector-knn (no longer cuts `considered` or output to the pool), search card. Tests: step conformance "P-2b",
"considered contains every input candidate", service conformance step chaining.

**R-26 getItems returns build members only (S3).** Unknown build -> `not_found`. Affects: core api doc, api card,
skeleton and fake handlers. Test: kgApi "getItems returns members".

**R-27 Nested tool calls are linked (P-3).** runTool uses AsyncLocalStorage: a runTool inside a running handler of
the same session sets the inner tool.called parentId to the outer one; other sessions and parallel top-level calls
stay null. Affects: core runTool/events, eval runner, viewer. Tests: core "P-3", eval runner suite, log fixture.

**R-28 `orphanedGold(set, store, build)` in core (S4).** Questions whose gold chunks are not build members. Affects:
eval. Test: core, eval runner suite "S4".

**R-29 `eval.run.started` carries `buildId`; any payload buildId must equal the envelope's** (generalizes the
build.* rule). The eval card requires an explicit buildId on every eval.* emit. Test: core, eval runner "Rule 6".

**R-30 Chunk lengths are normText lengths (S5)**, sentence ends are "." + whitespace run + uppercase, and a hard
cut is the shortest prefix of normalized length M. Evidence: the review's hand case (70 extra spaces in P1a split
`gas/1-ab`); the new conformance case doubles every space. Affects: chunk card, skeleton chunker. No fixture output
changed (single-spaced text).

**R-31 Viewer gets `itemInfo(id) -> {label, text}` from app (S6)**; `RankedRef.queryId` added (which variant
produced a candidate, review 2(d)); RunEval deps gain a store read (S4) and `oracle-gold-first` is defined (eval card).

**R-32 Test-surface additions (testkit, no contract change):** non-identity query template in HASH_SPACE
(`question: {query}`, rankings re-verified by the oracle); v1 build of the mini-corpus uses its own search recipe;
recording embedder; `miniSearchHarness`; `knnFixtureSuite` (store card runs it on SQLite; the 50 ms latency
assertion is dropped); `mini-corpus/extra/dupsec`; pre-written `evalRunnerConformance` and `mcpConformance`, each
passing a control (test-only reference runner; app's `mcpCall`) and, for eval, failing a broken runner.

**R-33 Named candidate pools (P-1), contract 0.3.0. Applied (Sprint 1, Wave 0).** `SearchState.pools:
Record<string, Candidate[]>` (`{}` in v0; unique per item, sorted by `sortCandidates`); optional `StepTrace.pools`
(name -> `RankedRef[]`, the pools the step read or wrote, after the step); `vector-knn` param `into` (merge hits
into the named pool, `candidates` untouched; `{queryId}` in the name expands per variant); contract text for an
unbuilt `fuse` step (RRF over named pools, writes `candidates`). Without `into` no v0 behaviour changes. Affects:
core search types, `stepTraceSchema`, CONTRACT_VERSION 0.3.0 (and package.json), testkit (`StaticPoolStep`,
broken `PoolDroppingStep`/`PoolLeakingStep`, `StepHarness.into`, `pools: {}` in step states), searchStepConformance
(3 cases), search and viewer cards, skeleton runner (one literal, `pools: {}`, forced by typecheck; skeleton
`vector-knn` does not implement `into`). No golden vector or fixture changed. Tests: step conformance "P-1" cases,
meta tests for both broken steps.

**R-34 Contract 0.4.0 from the provenance review (CP-01, CP-02, pointer events). Applied (Sprint 1).** (a) `EmbeddingSpaceSpec.digest`
(required; Ollama `/api/tags` digest, hex): enters `es_`, so `DEFAULT_SPACE` is now pinned to embeddinggemma:latest
`85462619ee72...79f1` and the golden `es_` moved from `es_edhtnrpirwpjcmeofygk` to `es_v2g4uetfrwe6cioxgl4t` (only the
canonical JSON gained the `digest` key; `oracle.py` re-run, no other vector changed); embed card: an embedder given a
digest fails `precondition` on a mismatch. (b) `putDocVersion` of an existing `dv_` with a different ordered chunk
list throws `immutable_violation` (port doc, fake, conformance case, broken `SilentDocVersionStore` caught by a meta
test); S-11 conformance case added (first-seen `parent_id`). (c) chunk card versioning rule. CP-02: `MappingKind`
`refines`/`supersedes` renamed `refined-by`/`superseded-by` (model, schema.sql CHECK, doc comment). Events:
`ingest.completed.previousDocVersionId` and `build.created.revert`, both optional in zod. CONTRACT_VERSION and
package.json 0.4.0, all card stamps; skeleton ingest emits the two fields (conformance case "0.4.0 pointer events").
No schema_version bump (no database exists). Tests: core "0.4.0 additions", store and ingest conformance, meta.

**R-35 Contract 0.5.0: pipelines are state machines (plan: `scratch/sprint-1/state-machine-revision.md`). Applied (Sprint 1, Wave 1, core only).**
In plain language: every multi-step pipeline is going to be a small hand-written state machine (named stations, the
allowed moves between them), and the contract now describes that. A search recipe is no longer a list of steps; it is
the machine's name, the machine's version, its typed settings, and a pin of the machine's wiring (a 16-hex
fingerprint, plus an optional prompt digest for machines that carry prompt text). The recipe id hashes all of it, so
editing the wiring or a prompt gives a new id. Every logged search step now names the machine state that ran it, and
two new events bracket a pipeline run: `pipeline.started` (which machine, version, wiring pin, recipe) and
`pipeline.finished` (done or failed, and the state where it ended), so the viewer can draw the machine and light up
the path a session took. Changes: `SearchStepSpec` and the `{steps}` recipe removed, `MachineRecipeSpec`,
`SearchRecipeSpec` (strict `searchRecipeSchema`) and `MachineMap`/`MachineNode`/`MachineEdge` (+ `machineMapSchema`,
`validateMachineMap`) added; `StepTrace.state` required; `StepFactory` and `SearchState.done` removed (a loop is a move
back in a machine, so the "done" flag, skip-after-done and unrolled-loop rules go); `eval.run.started.searchRecipes` and
`EvalRunInput.searchRecipes` (optional recipe per retrieved condition); `DEFAULT_SEARCH_RECIPE` is the `similarity`
machine, version 1, with a provisional topology literal. Envelope rule for the new events (settled here): the payload
carries `pipeline` (`search`, `ingest`, `eval-run`, `eval-generate`); `search` requires buildId and searchId,
`eval-run` requires buildId, `ingest` and `eval-generate` require neither (the first ingest has no build yet).
Identity: only `DEFAULT_SEARCH_RECIPE`'s `rc_` moved (`rc_dsttj7ftrqu6ebxcedps` to `rc_qabaozbopsfdecarndip`); parse and
chunk recipe ids, `es_`, and the build vector (which uses a placeholder recipe id) are unchanged, but every real build
id changes once because the default recipe id changed. No schema.sql change (the recipes table stores the spec JSON).
No migration: development databases written with the step-list recipe are discarded. Nothing about formulas is in 0.5.0.
Affects: core, testkit (`oracle.py`, `ids.json`, log fixtures gain `state` on steps; fake/harness literals), and, still
to do in later waves, the skeleton search, testkit fakes and suites, and the search, ingest, eval, viewer and app
packages (list: `scratch/sprint-1/wave1-todo.md`). Tests: core "0.5.0 additions".

**R-36 Contract 0.6.0: formulas in v0 (plan: `scratch/sprint-1/state-machine-revision.md` section 13). Applied (Sprint 1, core).**
In plain language: display formulas can now be decoded to LaTeX by a separate step, and what the embedder sees of a
formula is a setting. Two new fields. (a) `EmbeddingSpaceSpec.formulaView`, required, `placeholder` (a formula block is
embedded as `[formula]`; the default) or `full` (as its decoded text, i.e. exactly the stored chunk text). It is part of the
hashed spec, so the view is part of the space id: another view is another space, and the default space gets a new `es_`.
(b) `ParseRecipeSpec.spec.formulaDecoding`, optional: `{model, revision, prompt, cropMargin}` of the decoder. Absent means
decoding is off and the key is simply not in the hashed recipe, so every existing parse recipe id (and artifact and doc
version id) is unchanged; present gives a new parse recipe, hence new chunk ids by the usual rule. A new port type,
`ChunkViewRenderer` (`ports/parse.ts`): `(parse artifact, a chunk's block refs, view) => string`, implemented by the
`chunk` package (the only code that reads docling structure) and called by ingest's embed state; the embedder and
`renderDocument` are unchanged (they still receive text). Cards: chunk (renderer; formula blocks measured at placeholder
length when packing, recommended, to verify), parse-sidecar (`decode-formulas`: artifact plus source PDF in, new artifact
out; GLM-OCR 4-bit via mlx-vlm), ingest (conditional decode state between parse and chunk; view-rendering before
embedding), embed and parse (notes). Identity: `DEFAULT_SPACE` `es_v2g4uetfrwe6cioxgl4t` to `es_rw4fhkj5gv6blkrzm4ss`;
all recipe ids and the artifact, doc version and build vectors are unchanged (the build vector uses placeholder ids);
a new golden recipe vector covers a parse recipe with `formulaDecoding`. Real builds change once because the space id is in
the manifest. `schemas/parse-artifact.schema.json` and `parse-recipe.schema.json` regenerated (optional `formulaDecoding`).
No schema.sql change. No migration: development databases are discarded. Known gap: a chunk's block refs name a block, not
the piece of a split block, so the renderer cannot reproduce a chunk that holds only a piece of a long prose block; recorded
on the chunk card. Affects: core, testkit (`oracle.py`, `ids.json`, two space literals), and the chunk, parse-sidecar, ingest
cards. Tests: core "0.6.0 additions", golden recipe vector.

## Proposed (P-2b and P-3 adopted as R-25, R-27; P-1 adopted in Sprint 1 as R-33; P-2a, P-2c deferred by the lead)

**P-1 Named candidate pools in SearchState (adopted: R-33)** (`pools: Record<string, Candidate[]>`, `{}` in v0, plus a trace
slot). Evidence: spike 5d (`pipeline-recipes.md`): decomposition with per-subquery fusion cannot be written,
because `vector-knn` must fuse to one unique-per-item list before any fusion step sees per-query ranks.
Affects: core search types, search (vector-knn `into` param, a fuse step), searchStepConformance, viewer.
Invalidates: nothing yet; after fan-out it would touch three packages. Recommendation: adopt now.

**P-2 Runner semantics for `done`, merge-on-retrieve, and `QueryVariant.searched`.** Evidence: spike 5d: the
critique loop is expressible by unrolling, but only if the runner skips steps after `done` (except
`final: true`), retrieval steps merge into existing candidates (idempotent re-run), and variants record that they
were searched. Affects: core search contract text, search runner and steps, searchStepConformance.
Recommendation: adopt (a) and (b) now as contract text; (c) as an optional field.

**P-3 Nested tool calls.** An eval run's nested `search` tool.called has `parentId: null`, so the log does not
link the search to the eval run except through order (fixtures/log/session-eval.jsonl, seq 4). Option: runTool
accepts an optional parent (the enclosing ctx) and records it. Affects: core runTool, eval, viewer.
Recommendation: adopt with P-1/P-2 if core is reopened; otherwise viewer infers nesting from order.

## Felt wrong, left alone
- `core` holds logic (runTool, IDs, conditioning, composeBuild, findSearch). Accepted by the proposal; it is
  the price of one definition per rule. A bug there ripples everywhere; the golden vectors and suites guard it.
- Store and log ports are synchronous (better-sqlite3); a remote store will be a signature change.
- A build manifest lists embedding spaces but search uses `embeddingSpaces[0]`; multi-space search is undefined.
- `vector-knn`'s fuse-by-max discards per-query ranks even when nobody needs them yet (see P-1).
- The log has item IDs, ranks and scores for the whole 100-candidate pool but no text: diagnosing a failed query
  from the log alone tells you where gold ranked, not why; the text needs a store read. By design (chunk IDs are
  the currency), but the viewer will need a store-backed `labelOf`.
- Per-item feedback is limited to items the search returned; an agent may want to rate an item it fetched later.
- `tool.returned.buildId` is the current build when it is written, so an ingest's `tool.returned` carries the new
  build while its `tool.called` carries the old one. Consistent with R-10, but surprising when reading the log.
- `EventLog.openSession` writes `session.started` outside runTool (the one exception to "only runTool appends").
- `page_range` is a parse-recipe option, so three slices of different pages are three parse recipes and a build
  over them is `mixedRecipes: true`. Page ranges are arguably artifact metadata, not recipe.
- The artifact cache key is (sha256, config parse recipe); an imported artifact under another recipe is kept but
  never hit by a later source ingest with the config recipe. Correct, possibly confusing.
- `Chunker` is a bare function type; dispatch on `recipe.spec.algorithm` is the caller's job.
- `Item.meta` is free-form JSON with no schema per kind.
- InMemoryCorpusStore transactions deep-clone the whole state (fine for fixtures, slow at corpus scale).
- HashEmbedder keeps stopwords and collides at small dims; the search fixture uses 4096 dims and distinctive
  tokens, and asserts only rank 1 where collisions touch ranks 2-3.
