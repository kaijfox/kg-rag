# Skeleton against @kg/core 0.6.0

## Changed files
- packages/app/src/skeleton/search.ts
  - `StepFactory` is now defined locally: a step factory returns a `SearchStep` plus a `state` name ('retrieve' for vector-knn, 'cut' for truncate). The trace's `state` is set from it.
  - Legacy step list kept inside the file: `MACHINE_STEPS` maps the recipe's machine name to a fixed step list. `similarity` -> vector-knn (params = recipe settings, e.g. {pool, kinds}) then truncate ({}). Unknown machine -> `invalid_input`, thrown before any event.
  - `done` removed from the initial `SearchState`.
  - Event order: `query`, `pipeline.started` (pipeline search, machine/version/topology from the recipe, recipeId = the search recipe id; tagged searchId + buildId), `search.step`*, `pipeline.finished` (done, state 'done'), `search.result`.
  - Failure after `pipeline.started`: `pipeline.finished` with status 'failed', state = the last state entered (or 'failed'), error {code, message} via `errorCodeOf`, then rethrow.
- packages/app/src/skeleton/ingest.ts
  - `pipeline.started` (pipeline ingest, machine ingest, version '1', topology '0000000000000000', recipeId null), emitted after the embedder precondition and before the first `ingest.started`. No explicit buildId/searchId tag.
  - Body wrapped in try. `pipeline.finished` (done, state 'done') after the last `ingest.completed` and `build.created`, before return. On failure: `pipeline.finished` status 'failed', state 'failed', error {code, message}, then rethrow.
- No other skeleton file needed changes (`pnpm --filter @kg/app typecheck` was failing only in search.ts).

## Not changed
- core, testkit: not touched.
- App tests: no test assertion was edited. Two testkit conformance suites still assert the pre-0.5.0 sequence (no pipeline events), so they fail on the skeleton; see the test report.

## Open
- The testkit suites `searchServiceConformance` "event sequence" (packages/testkit/src/conformance/search.ts) and `kgApiConformance` search sequence (packages/testkit/src/conformance/kgapi.ts) need `pipeline.started` / `pipeline.finished` allowed around the steps.
- `test/architecture.test.ts` fails on `@kg/eval` depending on `@kg/pipeline`; packages/eval/package.json is untracked and in progress elsewhere.
