# @kg/search (WP8, Haiku for steps and tests, Sonnet for the runner)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.

## Implements (core `ports/search.ts`)
- `createSearch(d: { store: CorpusStore; embedder: Embedder; steps?: Record<string, StepFactory>; llm?: Llm }): SearchService`
- `vectorKnn: StepFactory` (type `vector-knn`, params `{pool = DEFAULT_POOL (100), kinds = ['chunk']}`) and
  `truncate: StepFactory` (type `truncate`, params `{k?}`, default the request's k); `V0_STEPS` registry.

## Runner (the only code that emits search events)
1. build = `req.buildId ?? store.currentBuild()` (none -> `precondition`; unknown -> `not_found`); recipe =
   `req.searchRecipeId ?? build.manifest.searchRecipeId` (must be kind `search`); space =
   `build.manifest.embeddingSpaces[0]`; refuse (`precondition`) if the embedder does not serve it; unknown
   step type -> `invalid_input`.
2. `searchId = ctx.ids.ulid('sr_')`; emit `query` with `{searchId, buildId}` on the envelope.
3. Initial state: one query variant `{id:'q0', text: query, origin:'original', parentId:null}`, empty
   candidates, seeds `[]`, `done:false`, `notes:{}`. For each step i: run it, emit `search.step` with
   `{...trace, stepIndex: i, durationMs}` (time from `ctx.clock.monotonicMs()`). The v0 runner ignores `done`.
4. Final = `sortCandidates(candidates).slice(0, k)`, texts from `store.getItems`; `stale =
   store.staleCheck(buildId).stale`; emit `search.result`; return `{searchId, buildId, stale, items}`.
Steps: never mutate the input state; return candidates sorted by core `sortCandidates`, unique per item;
`considered` always contains every input candidate (the previous step's output). Retrieval steps MERGE (P-2b,
R-25): output = `fuseMax(existing candidates + retrieved)`, so re-running one on its own output changes nothing;
`vector-knn` embeds every `state.queries` entry (one embed call, `renderQuery`), runs knn per variant, tags
candidates with `queryId` (copied into every `RankedRef`), fuses with the existing candidates, logs
`considered` = all fused (no cut: each variant contributes at most `pool`), `output` = the same list, and `queries`. Rule 1: candidates carry the item's `sourceChunkIds`.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`.

## Tests you must pass
`test/conformance.test.ts`:
```ts
import { searchFixtureSuite, searchServiceConformance, searchStepConformance, registerSuite } from '@kg/testkit/conformance';
import { miniSearchHarness, miniStepHarness } from '@kg/testkit';
import { createSearch, truncate, vectorKnn } from '../src/index';
registerSuite(searchFixtureSuite((mc) => createSearch({ store: mc.store, embedder: mc.embedder })));
registerSuite(searchServiceConformance(() => miniSearchHarness((mc) => createSearch({ store: mc.store, embedder: mc.embedder }))));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 3, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(truncate({}), vectorKnn({ pool: 100, kinds: ['chunk'] }))));
```
Command: `pnpm --filter @kg/search test`.

## Fixtures you may read
`testkit/fixtures/search/*` (README.md explains every expected ranking), mini-corpus through `loadMiniCorpus`.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests).

## Decisions already made
Linear step list (proposal); 100-candidate trace pool per variant (D12); merge-on-retrieve (P-2b); score/tie rules in core; `queries`, `seeds`,
`done`, `notes` reserved for later layers; stale flag on every response (R-05).

## Open questions (note, do not decide)
Decomposition with per-subquery fusion (named pools, P-1) and `done`/`searched` semantics (P-2a/c) are deferred
(decision log, Phase 1 review outcome); the v0 runner ignores `done`.
