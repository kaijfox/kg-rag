# @kg/search notes

## What was done
- Machine `similarity@1` (retrieve: vector-knn, cut: truncate) built with `setup()`, invoked through `stepActor`
  (built on `loggedActor`, so declared logs are visible to the map check).
- Service `createSearch` follows the card order: build, recipe, registry lookup (name, topology, settings), `query`,
  `runPipeline`, result, `search.result`.
- Topology changed from the placeholder `69bc55d30db24c90` to `ab74647e68ade0b3`.
  - core `packages/core/src/defaults.ts`: the literal in `DEFAULT_SEARCH_RECIPE.spec.topology`.
  - testkit `golden/oracle.py`: the SEARCH string; `golden/ids.json` regenerated with `python3 -I oracle.py`.
  - Only `DEFAULT_SEARCH_RECIPE`'s id changed: `rc_qabaozbopsfdecarndip` -> `rc_o3vj74kof7ugqctjnqhn`. The buildId
    vector is unchanged (its manifest is fixed).
  - Core and testkit tests pass after the change (core 39, testkit 173).

## Assumed
- `embedder.model` and `embedder.dims` stand in for "the embedder serves the space".
- A step's trace `params` for the into-write includes `into` as given (the placeholder is not expanded in params).
- For `truncate`, `considered` is the sorted input candidates.

## Surprised by
- testkit's `V1_SEARCH_RECIPE` uses version `mini-v1`, which the card's registry lookup rejects (see the change proposal).
- zod is not resolvable from this package, so the settings check is hand-written.
- The service conformance suite (testkit) was written before pipeline events; the other agent's update now allows them.
- `packages/app/test/skeleton.test.ts` appeared in a grep result for `miniStepHarness`. I did not open it.

## Review fixes
- Truncate trace records the effective `k` (`{k}`) whether it comes from the recipe or the request. Tests added in `test/steps.test.ts` for the embedder precondition, recipe kind, knn pool limit, `queryId`, pool merge and truncate k (91 tests).

## Would flag
- Core's comment on `DEFAULT_SEARCH_RECIPE` still says provisional (proposal 3).
- The embedder check cannot compare digests.
