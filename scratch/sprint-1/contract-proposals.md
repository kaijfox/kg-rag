# Contract proposals from the provenance review (Sprint 1, item 6)

2026-10-18. Source: `scratch/sprint-1/prov-review.md` section 2 (A1-A5, A7). Entry style follows `scratch/sprint-0/contract-revisions.md`. Review only: no code, `design/` or `packages/` changes. Every entry is **Proposed, needs user approval**; nothing here is applied. Line numbers were checked by reading or grepping the files named. Where a claim rests on the review rather than on code, the entry says so.

In-flight work: Phase 2 has not started, so no package code is invalidated by any entry. Entries that touch golden vectors or ID derivations say which vector moves.

## Batch summary

| ID | prov-review item | Change | Packages / tests touched | Recommendation | Status |
|---|---|---|---|---|---|
| CP-01 | A2 | (a) `EmbeddingSpaceSpec` gains the model digest; (b) `putDocVersion` throws `immutable_violation` when the stored chunk list differs; (c) chunk card rule: any output change bumps `version` | core ids/model/defaults, embed (stub), app skeleton ollama, store port + fake + conformance, chunk card, golden `ids.json` | Adopt (a) and (b) before `store` is built; adopt (c) now as card text | **Applied** (0.4.0, R-34): approved as recommended |
| CP-02 | A4 | Rename `supersedes`/`refines` to `superseded-by`/`refined-by` (alternative: keep names, document direction) | core model.ts, schema.sql CHECK; no other consumers found | Rename: no rows and no readers exist yet | **Applied** (0.4.0, R-34): approved |
| CP-03 | A5 | `builds.parent_id` = first-seen parent; document in store card and lifecycle doc | store card, core port doc, lifecycle doc (not yet written) | Documentation only; adopt | Applied |
| CP-04 | A1, A3, A7 | Name addressing mode per ID prefix; `derivation` = recipe applied to inputs, `recipe` = plan; glossary | core `ids.ts` docs, chunk/ingest/store cards, lifecycle doc | Documentation only; adopt | Applied |

---

## CP-01. Input-addressed rows are first-writer-wins (A2)

The review's point: input-addressed rows keep the first writer's content, so a producer change the recipe does not record is dropped without a trace. Three parts.

### (a) Embedding model digest in `EmbeddingSpaceSpec`

**Change.** Add a `digest` (Ollama model digest, from `/api/tags`) to `EmbeddingSpaceSpec`, set when the space is registered, and have `embed` fail on a mismatch with the digest recorded for the space. The review's alternative is verification only, without a schema change.

**Evidence.**
- `packages/core/src/model.ts:148-154`: `EmbeddingSpaceSpec = {model, dims, documentTemplate, queryTemplate}`. The model field is documented as "Ollama model name including tag, e.g. 'embeddinggemma:latest'". There is no digest field.
- `packages/core/src/defaults.ts:37-42`: `DEFAULT_SPACE.model = 'embeddinggemma:latest'`, a mutable tag.
- `packages/core/src/ids.ts:222`: `spaceId(s) = hashId('es_', 'space/1', [canonicalJson(s)])`, so the whole spec, including any new field, enters the ID.
- `packages/core/src/ports/store.ts:85-86`: `putEmbeddings` is insert-only, "an existing (space, item) row is kept (first writer wins)". This is the mechanism the review describes.
- `packages/app/src/skeleton/ollama.ts:40-50`: `ollamaAvailable(model)` reads `/api/tags` but checks only `m.name === model`; it ignores `digest`. Confirmed by reading the file. The review's claim that `/api/tags` returns a per-model digest is from the Ollama API docs (review's source list), not verified here against a live server.
- `packages/embed/src/index.ts` is a stub; `packages/embed/CARD.md:6-7` specifies `ollamaEmbedder(model, dims, ...)` with `POST /api/embed`. No digest in the card.

**Affects.**
- Golden vectors: `packages/testkit/golden/ids.json` lines ~258-261 hold the `DEFAULT_SPACE` canonical JSON and `es_edhtnrpirwpjcmeofygk`. Adding a field changes both; the vector must be re-recorded (as R-23 did for the build vector).
- Core tests: `packages/core/test/core.test.ts` uses `DEFAULT_SPACE` at lines 4, 101-111 (conditioning). Those assertions do not depend on the digest.
- Packages: core (model, ids, defaults, schemas), embed (stub, CARD), app skeleton `ollama.ts`, store (`putSpace`, `packages/testkit/src/fakes/store.ts:249-255`).
- Migration: not checked. I did not look for a populated database file, so whether any stored `es_` rows exist is unknown.

**Recommendation.** Option 1 (digest in spec, recorded when the space is created) gives the strongest guarantee but changes `es_` for every space and re-records the golden. Option 2 (`embed` verifies the digest against a value stored with the space, no ID change) is cheaper. Decide before `embed` is built. Note for the decision: a digest in the spec means a model update produces a new space ID, which is the Nix-style outcome the review wants.

**Status.** Applied in 0.4.0 (R-34), approved as recommended.

### (b) `putDocVersion` throws `immutable_violation` on a different chunk list

**Change.** When a `dv_` already exists, compare the stored chunk ID list with `v.chunkIds`. If they differ, throw `immutable_violation`. If they match, keep the current no-op (`{inserted: [], reused: all}`).

**Evidence.**
- `packages/core/src/ports/store.ts:55-62`: "an existing doc version id returns {inserted: [], reused: all}". No comparison is specified.
- `packages/testkit/src/fakes/store.ts:142`: `if (this.s.docVersions.has(v.id)) return { inserted: [], reused: [...v.chunkIds] };` This early return happens before any comparison of chunk lists, which confirms the review's observation for the fake.
- `packages/core/src/ports/store.ts:69-70` and `packages/testkit/src/fakes/store.ts:228`: `putItems` already throws `immutable_violation` when the same ID carries different content. So the proposed behavior matches the existing item rule.
- `packages/core/src/ids.ts:219-220`: `dv_ = H('docversion/1', docKey, artifactId, chunkRecipeId)`. Two different chunk lists under one `dv_` means the same artifact and chunk recipe produced different chunks, which is the case the review describes (a chunker change without a recipe bump).
- The review's "silently ignored" claim for `ingest`: `packages/app/src/skeleton/ingest.ts:134` calls `store.putDocVersion(p.v, p.drafts)` and I did not trace the reported status. The statement that ingest reports `unchanged` is from the review; not verified here.

**Affects.**
- Store port doc (`packages/core/src/ports/store.ts`), fake (`packages/testkit/src/fakes/store.ts:138-150`), conformance (`packages/testkit/src/conformance/store.ts:154-159` expects `reused: all` for identical drafts; still true under the proposal, which needs a new case for a differing list).
- Other callers: `packages/testkit/src/minicorpus.ts:71`, `packages/testkit/src/broken/index.ts:221` (a broken fake; check it still fails for the right reason), `packages/app/src/skeleton/ingest.ts:134`, `packages/ingest/CARD.md:28`, `packages/store/CARD.md:51` (error list).
- Packages: core (port doc), testkit (fake, conformance, broken), store, ingest (card).

**Recommendation.** Adopt before `store` is built. The check is one set comparison and matches the existing item rule. It is the store-side enforcement of the chunk-card rule in (c).

**Status.** Applied in 0.4.0 (R-34), approved as recommended.

### (c) Chunk-card rule: any output change bumps `version`

**Change.** Add to `packages/chunk/CARD.md` (and the recipe docs): any change to the chunker's output for any input bumps the recipe `version`. A change of algorithm definition (not just a fix) bumps `algorithm` to a new name (e.g. `section-pack/2`) with a new golden vector.

The review's wording is "bumps algorithm or version". The code has `version` on the recipe, not inside `spec`. The rule should name the field: `version` is the recipe field (see below), `algorithm` is the spec field.

**Evidence.**
- `packages/core/src/model.ts:138-141`: `ChunkRecipeSpec = {kind: 'chunk', version: string, spec: {algorithm: 'section-pack/1', targetChars, maxChars, minChars}}`. `version` sits at the top level, outside `spec`.
- `packages/core/src/defaults.ts:15-24`: `DEFAULT_CHUNK_RECIPE.version = '1'`, `algorithm = 'section-pack/1'`, with the comment "Provisional until the chunker freeze before Phase 4."
- `packages/testkit/golden/ids.json` (~line 249): the chunk recipe canonical is `{"kind":"chunk","spec":{...},"version":"1"}`. A version bump changes the `rc_` ID and therefore every `dv_` (since `dv_` includes the chunk recipe, `ids.ts:219-220`).
- Existing evidence that output changed without a bump: `scratch/sprint-0/contract-revisions.md` R-11 says the packing rule 4 change alters the stat-mech output (312 chunks with the rule, 313 without), and R-12 changed real-docling handling; both were made under `section-pack/1` with `version '1'` still in `defaults.ts:24`. R-30 changed length to normText and says no fixture output changed. The pre-freeze status excuses R-11/R-12 for Phase 1, but it shows the rule is not currently followed.
- `packages/chunk/CARD.md:35-37` names the algorithm as "authoritative" and gives the rules; it has no versioning section (grep for `version` in the card found only the fixture reference at line 24 and a note at 83).

**Affects.** `packages/chunk/CARD.md` (new rule), `packages/core/src/defaults.ts` (version string, if bumped), golden `ids.json` (recipe and `dv_` IDs), `packages/testkit/fixtures/mini-corpus` (expected output if any output changes), `packages/app/src/skeleton/chunker.ts:213` (dispatch on `algorithm`; not changed by a `version` bump).

**Recommendation.** Adopt the card rule now (text only). Before the chunker freeze, decide whether R-11/R-12 need a `version` bump at freeze; the freeze is the natural point to set `version '1'` as final.

**Status.** Applied in 0.4.0 (R-34), approved as recommended.

---

## CP-02. Mapping direction for `supersedes` / `refines` (A4)

**Change (recommended).** Rename the kinds so each reads from `fromId`:
- `supersedes` -> `superseded-by`: `{fromId: old, toId: new, kind: 'superseded-by'}` reads "old is superseded by new".
- `refines` -> `refined-by`: `{fromId: general, toId: specific}` reads "general is refined by specific".
- `same-as` and `duplicate-of` stay. `duplicate-of` already reads from `fromId`.

**Alternative.** Keep the names and document "from KIND to" for each kind, with one example each. This keeps the CHECK constraint and every existing mapping ID unchanged.

**Evidence.**
- `packages/core/src/model.ts:86`: `export type MappingKind = 'same-as' | 'duplicate-of' | 'refines' | 'supersedes';`
- `packages/core/src/model.ts:88-91`: `fromId`, then `/** canonical / newer side */ toId`. The only direction information is this comment on `toId`. Each kind has no doc comment, so `{kind: 'supersedes', fromId: old, toId: new}` reads "old supersedes new", which is the backwards reading the review describes.
- `packages/core/src/schema.sql:81`: `CHECK (kind IN ('same-as', 'duplicate-of', 'refines', 'supersedes'))`. A rename changes this constraint. I did not check whether `schema.sql` carries a version number that would also need a bump.
- `packages/core/src/ids.ts:232-233`: `mappingId` hashes the canonical mapping, so a rename changes the ID of any mapping that uses the renamed kinds. No such mapping exists in the code.
- Readers: `grep` for `supersedes`, `refines`, `superseded-by`, `refined-by` across `packages/` finds only `model.ts`, `schema.sql`, and nothing in api, eval, viewer, mcp or search. The only mapping written in tests uses `same-as` (`packages/testkit/src/conformance/store.ts:485`). Mapping IDs are not in `golden/ids.json`.
- `packages/core/src/schema.sql:82-83`: `from_id`, `to_id` columns, index `mappings_from` on `from_id`.

**Affects.** core `model.ts` (type, comment), core `schema.sql` (CHECK), core `ids.ts` docs if the examples mention kinds (not checked), conformance `store.ts:485` (only if `same-as` is renamed, which the recommendation does not do). No other package found.

**Recommendation.** Rename now. The review says the change "costs nothing now", and the grep supports that: no rows, no readers, no golden vectors. The doc-only alternative leaves a reading trap in the schema for every future reader. Note: `superseded-by` and `refined-by` are the review's proposed names; no naming decision was made elsewhere.

**Status.** Applied in 0.4.0 (R-34), approved as recommended (kinds renamed in model.ts, schema.sql CHECK and docs; no other consumers).

---

## CP-03. Build parent is first-seen history, not identity (A5)

**Change.** Document in the store card and in the lifecycle document: `builds.parent_id` records the parent of the first write of that build ID. Lineage across ingests comes from the `build.created` event, which carries the parent it was created with. `parentId` is excluded from `buildId`.

**Evidence.**
- `packages/core/src/schema.sql:58`: `builds(build_id PK, parent_id, created_at, manifest, mixed_recipes)`.
- `packages/core/src/ports/store.ts:95-96`: "if the id exists the stored build is kept (parentId of the first write wins)". The port already states the rule; the store card does not (`packages/store/CARD.md` has no `parent` mention; the only match was for first-seen chunk text at line 53).
- `packages/testkit/src/fakes/store.ts:305-307`: `putBuild` returns early on an existing ID, without comparing the parent.
- `packages/core/src/builds.ts:34`: `buildId(manifest, itemIds)` does not include `parentId`. Confirmed by the call; the ID function itself is in `ids.ts:229-230` (`build/2`, manifest plus sorted item IDs).
- `packages/app/src/skeleton/ingest.ts:143-152`: the parent passed to `putBuild` and emitted in `build.created` is `prevBuild`.
- `scratch/sprint-0/contract-revisions.md` R-23 records the build ID change to cover items.

**Affects.** `packages/store/CARD.md` (add the rule), `packages/core/src/ports/store.ts` (already correct; optional cross-reference), the lifecycle document `scratch/sprint-1/lifecycle.md` (listed in the brief as item 3 and not yet written, so this is a requirement for it). No code change.

**Recommendation.** Adopt as documentation. No test change is needed; a conformance case that `putBuild` keeps the first parent would pin the behavior, optional.

**Status.** Applied (user approved; store card, core `ports/store.ts` comment, lifecycle glossary).

---

## CP-04. Addressing modes, `derivation` vs `recipe`, glossary (A1, A3, A7)

Documentation only. No contract change.

**Addressing modes per ID prefix (A1).** The table below reflects `packages/core/src/ids.ts` as read. The review's classification is the basis; the code comments are cited where they say something.

| Prefix | Derivation in `ids.ts` | Mode (review's classification) | Evidence |
|---|---|---|---|
| `ch_` | `H(chunk/1, docKey, section path, sha256 of normText(text), occurrence)` | content-addressed | `ids.ts:166-172`; comment says "no recipe" |
| `nd_` | hash of normalized name | content-addressed | `ids.ts:194-197` |
| `pa_` | `H(artifact/1, source sha256, parse recipe)` | input-addressed | `ids.ts:214-216` |
| `dv_` | `H(docversion/1, docKey, artifact, chunk recipe)` | input-addressed | `ids.ts:219-220` |
| `rc_` | hash of canonical recipe spec | spec hash (not a recipe-plus-input derivation) | `ids.ts:192` |
| `es_` | hash of canonical space spec | spec hash | `ids.ts:222` |
| `bd_` | `H(build/2, manifest, sorted unique item IDs)` | content-addressed over its members | `ids.ts:229-230` |
| `mp_` | hash of canonical mapping | content-addressed | `ids.ts:232-233` |
| `qs_` | hash of canonical questions | content-addressed | `ids.ts:235` |
| `rl_` / `sm_` | reserved, formula not fixed | reserved | `ids.ts:19`, `ids.ts:203` ("the formula is not [fixed]") |

Caveats:
- `rc_` and `es_` are spec hashes, which the review lists with input-addressed IDs. This entry keeps them as a separate row, since the ID is the hash of the spec itself, not of a recipe applied to inputs.
- The review's Nix/Bazel semantics come from its own source list (checked by the reviewer). They were not re-checked here.
- The deferred `rl_`/`sm_` formula is the decision the review ties to A1. This entry does not decide it.

**Terminology (A3, A7).**
- **Recipe**: the plan. `RecipeSpec` (`packages/core/src/model.ts:124`), `recipeId` (`ids.ts:192`).
- **Derivation**: a recipe applied to specific inputs. The code already uses the word for the set-level run: `DerivationRun` (`model.ts:100-107`, fields `recipeId`, `inputStateHash`, `baseBuildId`) and the `derivation_runs` table (`schema.sql:77`). The design uses "recipe" for both; the code currently does not have a term for the per-item case.
- The review's proposed term for the per-item case is "derivation" (Nix's usage); this would make `DerivationRun` and per-item derivations share a word, which is the intent per the review.
- **Glossary (A7)**: content-addressed, input-addressed, derivation, plan, early cutoff, substitution, untracked dependency, lineage. Grep for `bundle` and `lineage` in `packages/` found no matches, so "bundle" is not in use and the avoidance is cheap.

**Affects.** Documentation only: `packages/core/src/ids.ts` header and per-ID comments; `packages/chunk/CARD.md`, `packages/ingest/CARD.md`, `packages/store/CARD.md` where they describe IDs; the lifecycle document (not yet written). No tests.

**Recommendation.** Adopt the table and the glossary now as the `ids.ts` header comment and the lifecycle document's glossary. Defer the `rl_`/`sm_` formula and any per-item derivation ID to the relation-layer sprint.

**Status.** Applied (user approved; `ids.ts` header and labels, chunk/ingest/store cards, lifecycle glossary in section 0).

---

## Not in this batch

- A6 (log every pointer move) was not in the requested scope; it is left for a later batch.
- The review's section 3 (C1-C7) and section 4 are not covered.

## Event proposals from lifecycle.md section 4 (A5, A6): Applied in 0.4.0 (R-34), approved
- `ingest.completed` gains `previousDocVersionId: DocVersionId | null` (optional in the schema so pre-0.4.0 logs validate; ingest always sets it).
- `build.created` gains optional `revert: boolean` (true when the current build moved to an already-existing build; `parentId` is then the previous current build and differs from the stored first-seen `parent_id`). Chosen over a new `build.current` event or a rename because it is additive and needs no change to readers. See `scratch/notes/contract-0.4.md`.

## Proposed (state-machine spike, 2026-10-18; none applied, user decides; evidence in `scratch/sprint-1/spike-state-machine/results.md`)

**CP-SM-1 `repeat` construct for bounded loops (replaces P-2a and P-2c).** A search step spec `{type: "repeat", params: {max: N, steps: SearchStepSpec[]}}` runs its body up to `max` times; before each iteration, and after each step inside the body, the runner stops the loop if `state.done` is true (the rest of that iteration is skipped). Outside a loop `done` has no meaning and the runner never skips (so no `final` marker). Each executed step is logged as today (`search.step`, contiguous `stepIndex`); an optional `details.iteration` is advised. Evidence: the critique loop as a machine, as an unrolled recipe with the deferred done-skip, and as a 22-line runner with `repeat` give identical results and traces (`test/loop.test.ts`); unrolled recipes grow by two steps per round. Affects: core `ports/search.ts` text and `SearchStepSpec` docs, search runner, `searchServiceConformance` (a loop case: bound, early `done`, step order), viewer (the same step type can appear several times), search card. Invalidates: nothing built (skeleton runner and testkit fakes do not run loops).

**CP-SM-2 `fuse.from` accepts a prefix pattern.** `from` entries may end in `*` (e.g. `"sub:*"`) and then match every existing pool with that prefix, ordered by name; an exact name that is absent stays `invalid_input`, a pattern that matches nothing is `invalid_input`. Evidence: with decomposition the model chooses how many sub-questions exist, so a recipe naming `sub:q0..sub:q2` fails with `fuse: no pool sub:q2` when the model returns two (`test/search.test.ts`, "GAP"). Affects: core `ports/search.ts` fuse contract text, the future `fuse` step, its conformance case, search card. Nothing built yet.

**CP-SM-3 (only if resumable ingest is adopted, open question Q8) Ingest resume storage and event delivery.** (a) A vector checkpoint: embedded-but-uncommitted vectors keyed (space, chunk id), outside the transaction, because `putEmbeddings` needs existing items and items only enter the store in the commit transaction (I-7). (b) Snapshot storage that respects S-1: an insert-only table (run key, seq, JSON, latest wins) or files, never a third mutable row. (c) State in `IngestService` docs that during a resumed run `ingest.*` events are at-least-once (a stage's events can repeat, none are lost) and that `build.created.revert` is computed before the commit transaction. Evidence: 50 simulated crash points, `results.md` section 5. Affects: core store port docs or a new small port, `ingest` and `store` cards, lifecycle I-2 (event order wording), `ingestScenarios` (a resume scenario), viewer (tolerate duplicate ingest events). Tests: a crash-sweep scenario like `test/ingest.test.ts`.
