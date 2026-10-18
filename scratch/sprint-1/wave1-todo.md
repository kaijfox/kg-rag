# Wave 1 result: what 0.5.0 broke (0.6.0 additions at the end), as the to-do list for later waves

Contract 0.5.0 (core only) is applied. Checked on 2026-10-18:

| Check | Result |
|---|---|
| `pnpm --filter @kg/core test` | pass (37 tests) |
| `pnpm --filter @kg/core typecheck` | pass |
| `pnpm depcruise` | pass (no violations) |
| `pnpm --filter @kg/testkit typecheck` / `test` | pass / pass (170 tests) after the minimum fixes below |
| `pnpm --filter @kg/app typecheck` | FAIL, skeleton search (see below) |
| `pnpm --filter @kg/app test` | 25 of 99 skeleton tests fail, same cause; architecture and chunker tests pass |

Only `core`, `testkit` and `app` are real packages yet; `api`, `chunk`, `embed`, `eval`, `eventlog`, `ingest`, `mcp`,
`parse`, `parse-sidecar`, `search`, `store`, `viewer` have a CARD.md and no code or tsconfig, so there is nothing to typecheck.

## app (skeleton; the approved skeleton edit belongs to wave 4)
`packages/app/src/skeleton/search.ts`:
- imports `StepFactory` (removed): use typed step constructors (`vectorKnn`, `truncate`) with typed params.
- reads `recipe.spec.steps` (line 97): the recipe is now `{ machine, settings, topology }`. Approved minimal edit: a local legacy step-recipe type and legacy default recipe inside the skeleton, for the oracle test only.
- builds `SearchState` with `done: false` (line 107): field removed.
- builds `StepTrace` without `state` (line 112): add the state name (`retrieve`, `cut` for the two steps).
Cause of the 25 failing skeleton tests: `searchServiceConformance`, `searchFixture` (s1 to s9) and `kgApiConformance` search-dependent cases all die with "Cannot read properties of undefined (reading 'map')" because the default recipe no longer has `spec.steps`. Ingest and chunker conformance pass.

## testkit (beyond the minimum already done)
- `fakes/search.ts`: `ScriptedSearchService` sets `state: 'retrieve'` only; add `pipeline.started` / `pipeline.finished` and real state names.
- `harnesses.ts`, `minicorpus.ts`: `done` removed from state literals; `miniSearchHarness` should build the default machine recipe; add `machineSearchHarness(recipe)`.
- `conformance/search.ts`, `conformance/ingest.ts`: add the event-order, `state`, contiguous `stepIndex`, `pipeline.finished` (done / failed) cases. Currently the suites do not know the new events.
- New `conformance/machine.ts` (`machineMapConformance`, `machineLogConformance`; `validateMachineMap` in core covers the structural part).
- `fixtures/log/*.jsonl`: add `pipeline.started` / `pipeline.finished`, a session with a failed ingest, update `fixtures/log/README.md`.
- `broken/index.ts`: add `SilentMachineSearch`, `WrongStateNameSearch`; `test/meta.test.ts`, `test/fakes.test.ts` for them.
- `minicorpus.ts` `V1_SEARCH_RECIPE` carries the provisional topology of the default recipe; give it the real one with the machine.
- `golden/oracle.py`: the topology literal in `SEARCH` must change whenever the default recipe's topology does.

## search / ingest / eval / viewer / pipeline (new)
- All cards still describe the step-list runner, `done`, `StepFactory` and sprint markers; rewrite per plan section 8.4 and bump their stamp from 0.4.0 to 0.5.0 (api, chunk, embed, eventlog, mcp, parse, store cards already stamped 0.5.0).
- search: assert the `similarity` machine's computed topology equals `DEFAULT_SEARCH_RECIPE.spec.topology` and replace the provisional literal (then regenerate golden `ids.json` via `oracle.py`, and `core.test.ts` has no hard-coded id to change).
- eval: use `EvalRunInput.searchRecipes` and `eval.run.started.searchRecipes`.
- viewer: read `pipeline.started` and `StepTrace.state`; `MachineMap` type is available in core.
- ingest: emit `pipeline.started` / `pipeline.finished` with `pipeline: 'ingest'`; buildId on them is optional.

## Other
- Existing sprint markers in comments in untouched core files remain (`runTool.ts`, `model.ts`, `evalGold.ts`, `ports/store.ts`, `defaults.ts` space digest comment was cleaned); the marker lint (plan section 10) is a later wave.
- Cards of search, ingest, eval, viewer, and `design/` were not touched.

## Contract 0.6.0 (formulas), added 2026-10-18
Checks after 0.6.0: core test (39 pass) and typecheck pass; testkit typecheck and test (170) pass; `pnpm depcruise` passes; app unchanged (same 7 type errors, same 25 failing skeleton tests; the app test run now counts 114 tests).
- chunk: implement `renderChunkView` (`ChunkViewRenderer`), formula blocks at placeholder length when packing (verify), and resolve the split-block piece question on the card.
- parse-sidecar: `kg-parse decode-formulas` (GLM-OCR 4-bit, mlx-vlm); `check-recipe` must accept `formulaDecoding`.
- ingest: conditional decode state, `chunkView` and `formulaDecoder` dependencies, view-rendered embedding text; testkit ingest scenarios do not cover them yet (no conformance case was added in 0.6.0).
- parse: nothing to implement; keep `parse` working for recipes with `formulaDecoding`.
- search / eval / viewer cards still 0.4.0.
