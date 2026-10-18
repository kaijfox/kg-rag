# Phase 1 independent review

Reviewer: not the author. Scope: core, testkit, app, the 12 CARD.md files, contract-revisions.md, pipeline-recipes.md. Only this file was written in the repo; mutations and one experiment ran on a copy in the session scratchpad.

## 0. Verdict

`pnpm check` passes: typecheck (core, testkit, app), dependency-cruiser (94 modules, 285 deps, no violations), tests 17 + 126 + 78 = 221, 7.6 s.

**No BLOCKER.** Seven SHOULD-FIX items are cheap before the core freeze and costly after (they change IDs, fixtures or contract text). 25 of 38 mutants were caught. The 13 survivors sit where the skeleton never exercised the code: build tags on non-query events, embedding conditioning, explicit pinned builds.

## 1. Findings

### SHOULD-FIX before fan-out

**S1. A build's ID does not cover its items.** `buildId = H(canonicalJson(manifest))`; the manifest lists `derivedRecipes`, not derived items; `putBuild` keeps the stored build when the ID exists. Harmless in v0 (items follow from doc versions). Once relations exist, re-extracting the failed chunks under the same recipe adds items but leaves the manifest, the ID and the stored item list unchanged, so the design's "re-extract only what failed" yields no new build. Fix: hash the sorted `itemIds` into the build ID. Golden build IDs and log fixtures change once, now.

**S2. A build can hold chunks that search cannot see, silently.** `ingest` embeds only requested documents, but `composeBuild` covers every current doc version. Experiment (copy, `app/scripts/exp1.ts`): ingest gas and entropy (17 chunks, search returns 17); change the space template (new SpaceId); re-ingest gas only. The new build lists 17 items, search returns 8, `stale=false`, no event. `knn` skips items without a vector. Switching embedding model is a sanctioned operation, so this will happen. Fix: contract text requiring `missingEmbeddings(space, build.itemIds) == []` for each manifest space (`precondition` otherwise), plus an ingest scenario that switches the space mid-corpus.

**S3. Build tags are weakly enforced.**
- `getItems` ignores `buildId` (handler calls `store.getItems(ids)`; the card repeats it). The experiment fetched an item with the bogus build `bd_aaaa…` and logged `items.fetched` under it. The Rule 6 tag is decorative.
- M08, M09, M10 survived: `usage`, `outcome`, and `search.step`/`search.result` on an explicit non-current build can carry the wrong build. Only `query` and `feedback` are tested against an advanced build.
- `eval.*` events default to the current build via `ctx.emit`; a run pinned elsewhere records the wrong one unless the runner passes `buildId`. The eval card does not say so, and `eval.run.started` has no `buildId` payload to cross-check (unlike `build.*`).

Fix: `getItems` with `buildId` returns members only; add `buildId` to `eval.run.started` with envelope equality; extend kgApiConformance (advance the build, then check usage, outcome, step, result); add an eval-event build test.

**S4. The eval card is not implementable as written.** "Refuse a stale pinned build unless `allowStale`" needs a staleness read, but `runEval` gets only `rt, api, answerer, judge, repo`, and `KgApi` exposes none (`snapshotBuild` labels the *current* build). `gold` and `no-context` never search. `oracle-gold-first` is named, not defined. Nothing finds questions whose gold chunks left the build: after re-chunking, `goldChunkIds` point at vanished chunks and recall reads 0 silently (Rules 5 and 6 together; the design demands regeneration "for the affected chunks"). Fix: give `runEval` a store read, add a core `orphanedGold(set, store, build)`, define the oracle condition.

**S5. Packing uses raw lengths, IDs use `normText`.** Hand example: `gas/1-ab` = P1a(491)+P1b(443) = 936 and closes before P1c (936+2+98 = 1036 > 1000). If a re-parse adds 70 extra spaces inside P1a, raw 561+2+443 = 1006 > 1000, so P1a and P1b split and both IDs change though `normText(P1a)` is identical. Measuring blocks with `normText(text).length` (fixtures unchanged, they use single spaces) makes IDs invariant to whitespace-only differences. One-line card edit plus a whitespace-variant case in chunkerConformance.

**S6. The viewer cannot show what diagnosis needs.** The card passes only `labelOf`; chunk text needs a store read, and the design says the viewer "reads the store directly". Change the card to `itemInfo(id) -> {label, text}` supplied by app.

**S7. The skeleton already contains finished versions of five Phase 2 packages** (`chunker.ts`, `ingest.ts`, `search.ts`, `api.ts`, `ollama.ts`; about 640 lines) that pass the required suites and are greppable in the same repo. "Needs only card, core, testkit" cannot be verified and the independence experiment is contaminated. Decide before fan-out: promote the files into the packages (Phase 2 work becomes review plus the missing tests), or hide `app/src/skeleton` from implementers and treat passing as one data point.

### LATER

- **L1. Greedy packing cascades.** 20 paragraphs of 300 characters pack 3 per chunk (904 <= 1000; four is 1206). Insert one at the start and every group shifts: all 7 old IDs vanish, 7 new appear, no resync. The gas fixture resynced only because P1e (1037) cannot join a neighbour. Spike 5b's "100% outside touched sections" holds, but a touched section can lose every ID. Matters for project databases, not the static baseline. Content-defined boundaries would fix it.
- L2. Path `[]` and `[""]` (empty heading) hash identically. L3. Default docKey is the file stem: `a/foo.pdf` then `b/foo.pdf` in separate calls silently replaces the first (its chunks go stale, no warning).
- L4. `derivedItemId` throws, so Rule 4 on derived items is tested only with hand-made `rl_` IDs. L5. `parseArtifactSchema` checks only top-level DoclingDocument keys; bad sidecar output fails at chunk time.
- L6. `pool < k` silently returns fewer than k. L7. A throwing `finish()` in `runTool` masks the original error. L8. An identical-text duplicate counts as a recall miss; say so in the eval card.

## 2. Hand traces

**(a) chunkId.** `ID = H("chunk/1", docKey, normText(h1)␞normText(h2)…, sha256(normText(text)), occurrence)`, 20 base32 chars.
- *Insertion* (gas v2: N300, P1a 491, P1b 443, P1c 98, P1d 910, P1e 1037): N+P1a = 793; +P1b = 1238 closes. P1b+P1c = 543; +P1d = 1455 closes. P1d alone (+P1e = 1949). P1e alone, with the same docKey, path, text and occurrence 0 as v1 `gas/1-e`, so it keeps its ID. v1 `1-ab` and `1-cd` vanish and three chunks are new, although P1a-P1d are unchanged paragraphs. This matches expected-diff (14 survive, 3 vanish, 4 new; 17 and 18 chunks).
- *Duplicates* (entropy 2.1: D233, X880, D233): D+X = 1115 > 1000 and 233 >= 200, so D closes; X+D = 1115 closes; the last D is >= 200 so rule 5 does not merge. Chunks 1 and 3 share path and normalized text: occurrence 0 and 1, IDs differ only in the last hash part. A third copy inserted earlier renumbers, but identical text is identical evidence.
- *Whitespace-only*: "Entropy  rises.\nIt grows." and "Entropy rises. It grows." both normalize to the same text and ID. The store keeps the first-seen verbatim text (R-03), so a stored chunk may differ from the current document's whitespace. See S5 for the packing exception.
- *Gap*: no fixture repeats text in two sections (M03 survived), though the decision log relies on the path to keep them distinct.

**(b) Build and Rule 5.** The manifest is `{docVersions, embeddingSpaces, searchRecipeId, derivedRecipes, mappingRuns, mixedRecipes}`; `itemIds` is the sorted union of chunk IDs (see S1). "Current ingest" = union of `chunkIds` over `currentDocVersions()`. After v2, current = 18 chunks; v1's 17 minus those = {gas/1-ab, gas/1-cd, entropy/3-a1}, so `stale(v1)` = true and `stale(v2)` = false, matching the scenario. A v2 that only adds chunks leaves v1 non-stale, per the Rule 5 wording. Staleness is flagged lazily (search, snapshot, `staleCheck`): ingesting v2 emits nothing for labelled or pinned builds that just went stale, only `dropped` counts. Acceptable if the ingest card says so. S2 is the unflagged embedding-side gap.

**(c) runTool.** Success of `search`: `session.started`, `tool.called` (build = current at call), `query` (searchId, searched build, parent = tool.called), `search.step` x n, `search.result` (with `stale`), `tool.returned` (current build). Failure at step 0 (Ollama down): `tool.called, query, tool.failed{upstream}`; `findSearch` then gives `resultItemIds: null`, so a later `feedback{overall}` is accepted and item-level feedback rejected. Invalid input: `tool.called` with the raw input, then `tool.failed{invalid_input}`, no domain events. Domain events get `parentId = tool.called`, and `buildId` explicit or the current build *when emitted* (R-10). `BUILD_REQUIRED`, `SEARCH_REQUIRED` and `build.*` payload equality are envelope rules, so Rule 6 holds for the event types listed, but only as strongly as S3 allows. `ingest.*` are exempt (no derived items).

**(d) Search logging.** The log shows query, k and recipe ID; per step type, params, the full ranked pool (`considered`, 100 per variant, full-precision scores), `output`, and the variants; then the final ranking with `stale`. Ties show as equal scores under a deterministic rule (score descending, itemId ascending); the eval fixture has ranks 1-2 tied at 0.507178305673277 and ordered by ID. It cannot show (i) which variant produced a candidate (`RankedRef` lacks `queryId`; `fuseMax` keeps the winner), (ii) anything beyond depth 100, (iii) item text, (iv) the model or rendered query (derivable via build, manifest). (i) matters once query refinement exists; add `queryId` to `RankedRef` (additive).

**(e) mixedRecipes=true.** The three real slices carry `page_range` [2,4], [3,5], [6,7] in their parse recipes: three RecipeIDs, so `parseRecipes.size = 3 > 1`. Correct under the written definition; a false positive for its purpose, since parser, version and options are identical and only the page window differs. A whole-PDF ingest gives false. Compare recipes minus `page_range`, or document it. LATER.

## 3. Mutation experiment (38 mutants, full suite each)

Caught (25): ordinal and occurrence bugs in `assignChunkIds` (M01, M02), `normText` variants (M04), knn ignoring the build (M05, M06), feedback not copying the search build (M07), tie-break reversed (M11), item overwrite (M12, M18), stale-check variants (M13-M15, M19), Rule 1 (M24), foreign feedback items (M25), `canonicalJson` order (M27), re-ingest idempotency (M28, M29, N5), `fuseMax` (M32), chunkId parts (N1-N3), log score drift (N6).

**Survived (12 real, plus M33 `eventsBySearch` stopping at the first session, an equivalent mutant), each a finding:**

| # | Mutant | Why it lives |
|---|---|---|
| M03 | occurrence counted across sections | no cross-section duplicate fixture |
| M08 | `usage` not copying search build | test never advances the build for usage |
| M09 | `outcome` uses current build | same |
| M10 | `search.step`/`result` tagged current build | explicit-build test checks `query` only |
| M16 | `mixedRecipes` ignores chunk recipes | no fixture has two chunk recipes |
| M17 | default build frozen at call start (the R-10 bug) | Rule 6 test asserts non-null only |
| M20 | `truncate` logs `considered` after the cut | nothing compares it with the prior output |
| M21 | `snapshotBuild` never emits `build.stale` | no stale-snapshot case |
| M22 | ingest embeds without headings | scenarios never check vector content |
| M23 | search embeds raw query | `HASH_SPACE.queryTemplate` is `{query}`, a no-op |
| M31 | recipe from current, not searched, build | no case where recipes differ |
| N4 | `considered` cut to `pool` | one variant only in search tests |

M10, M17, M22, M23 matter most: a cheap implementer will write exactly these. Fixes in section 8.

## 4. Rules audit

| Item | Enforced at | Test fails if violated? |
|---|---|---|
| R1 | `anyItemSchema`, `putItems`, step conformance | Yes (M24) |
| R2 | schema triggers, store conformance | Yes (M12, M18); no SQLite store yet, only core's trigger test |
| R3 | `putMappings` insert-only, triggers | Yes ("Rule 3" case); no v0 producer |
| R4 | `CHECK(kind='chunk' = recipe_id IS NULL)` | Yes for derived items; chunk reading is the author's amendment |
| R5 | `staleCheck`, `stale` on responses | Yes (M13-M15, M19); M21 survives; S2, S4 uncovered |
| R6 | envelope rules, `findSearch` | Partly (M07 yes; M08-M10, M17, `getItems`, eval no) |
| v0-1 ingest idempotent | ingest scenarios | Yes (M28, N5) |
| v0-2 one store | `schema.sql` | Fakes only; no SQLite store |
| v0-3 search + step log | runner, trace schema | Mostly; M20, N4 survive |
| v0-4 log below MCP | `runTool` + CI grep for `.append(` | Yes (design sentence amended by user) |
| v0-5 feedback | api handler, R-06 | Yes (M07, M25) |
| v0-6 eval | `EVAL_RUN_TOOL`, metric fixtures | Metric fixtures only; no runner or event conformance |

## 5. Independence of the Phase 2 cards

Assuming the skeleton is hidden (S7):
- **chunk, search, api, eventlog, store, ingest, parse:** implementable from card, core and testkit, with acceptance suites pre-written. Gaps: store has float32 vs float64 near-ties and only a "smoke" use of the mini-corpus; its 50 ms latency assertion will flake in CI. Ingest has M22/S2. Api has S3. Chunk has S5.
- **embed:** the acceptance test needs `recordedFetch` recorded from live Ollama keyed on the conformance texts, which is circular. Use a stub `fetch` backed by `HashEmbedder`.
- **mcp:** the trap is SDK vs zod 4 input schemas; the card names it. Pre-write the in-memory transport round-trip.
- **viewer:** only a pure `renderTimeline` is testable; page JS is untested. See S6.
- **eval:** least ready (S3, S4).
- **parse-sidecar:** Python tests need docling 2.140.0; whether `page_range` is a known option for `check-recipe` is ambiguous.

Do the five un-pre-written suites block fan-out? No for the seven with suites. Before fan-out, pre-write the mcp round-trip and the eval runner event-order plus Rule 6 test (the two with cross-package semantics). Viewer, embed and parse-sidecar tests can be implementer-written and reviewer-checked, accepting a departure from the "tests not written by the implementer" rule.

## 6. Proposed contract changes

- **P-1 named pools: adopt later.** The spike proves a single unique-per-item list cannot hold per-query ranks, but no near layer needs decomposition and the fix has no second consumer (the proposal's own warning). "Three packages after fan-out" is overstated: the runner, `stepState`/`miniStepHarness`, and the viewer, which reads traces and has `details?: Json`. A simpler option needs no new field: allow one entry per `(itemId, queryId)` between a retrieval step and a fuse step, and move the uniqueness check to the final list. Revisit when decomposition is scheduled by evidence.
- **P-2: adopt (b) now, defer (a) and (c).** (b) retrieval merges into existing candidates (idempotent), testable by one conformance case (run `vector-knn` twice, same state), and prevents replace-semantics. (a) `done` skipping and (c) `searched` have no consumer or test; contract text no test enforces invites drift.
- **P-3 nested tool calls: adopt before freeze, via `AsyncLocalStorage` in `runTool`** (core only, about 10 lines, no `KgApi` signature change): a nested `runTool` in the same session sets `parentId` to the enclosing `tool.called`. Order inference breaks once an MCP client issues parallel calls in one session. Cost: re-record `session-eval.jsonl` (script exists) and one conformance case.

## 7. Overbuilt, left alone, or contradicting the design

- Mildly overbuilt: 12 packages for little v0 logic (`eventlog`, `api` are tens of lines); folding `eventlog` into `store` would remove the shared-`schema.sql` coupling. I would leave it; the split is a defensible bet for cheap-model work.
- Core holds logic (runTool, IDs, composeBuild, findSearch). Accepted, but S1 and S3 live there, so freeze after the fixes.
- Silent contradictions: "unchanged content keeps its ID" (L1); "nothing silently orphaned" (S2, S4, no event when a pinned build goes stale); "an item's ID derives from its recipe and input chunk IDs" (`derivedItemId` throws); viewer "reads the store directly" (card: log only).
- Root test weakness: suites run only against fakes and a skeleton built on the same in-memory store. No fake-vs-SQLite cross-check exists, and the store is the riskiest Phase 2 package.

## 8. Changes before fan-out

1. Core: hash `itemIds` into the build ID (S1); `buildId` in `eval.run.started` with envelope equality (S3); `queryId` on `RankedRef`; P-3 via `AsyncLocalStorage`; bump `CONTRACT_VERSION`; re-record fixtures and goldens once.
2. Core contract text: embeddings must exist for every build item in each manifest space (S2); `getItems` with `buildId` returns members only (S3).
3. Chunk card: measure blocks by `normText` length (S5); add fixtures for identical text in two sections (kills M03) and a whitespace-variant parse.
4. Testkit: advance the build for usage, outcome, step and result (M08-M10, M17); spy on rendered document text in ingest scenarios (M22); non-identity query template in the search fixture (M23); stale-snapshot case (M21); `considered` vs previous output (M20, N4); space-switch ingest scenario (S2).
5. Eval card: store/staleness read, define `oracle-gold-first`, explicit `buildId` on `eval.*`, `orphanedGold` (S4); pre-write the runner event-order test.
6. Viewer `itemInfo` (S6); embed stub `fetch`; store card runs the mini-corpus knn fixture against SQLite and drops the 50 ms CI assertion; pre-write the mcp round-trip.
7. Decide S7 (promote or hide the skeleton).
8. Adopt P-2(b) as one card line plus a conformance case; defer P-1 and P-2(a)/(c).
