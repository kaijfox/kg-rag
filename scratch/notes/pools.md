# P-1 named candidate pools (R-33, core 0.3.0)

Done: types in core `ports/search.ts` (SearchState.pools, StepTrace.pools, full semantics and the unbuilt `fuse` contract in the header comment), zod `stepTraceSchema.pools`, CONTRACT_VERSION and core package.json 0.3.0, testkit (StaticPoolStep reference, broken PoolDroppingStep and PoolLeakingStep, `StepHarness.into`, `miniStepHarness` option `into`, `pools: {}` in states), three new step-conformance cases, card updates (all cards' version stamp; search and viewer content), contract-revisions R-33.

Semantics chosen (arbitrary, logged): `into` merges via fuseMax into the pool, candidates untouched; `{queryId}` placeholder expands per variant; trace.pools = pools read or written, after the step; fuse = RRF (rrfK 60), replaces candidates unless keepExisting; pools never reach the final result.

Skeleton: only the runner's initial-state literal got `pools: {}` (typecheck forced it). Skeleton `vector-knn` has no `into`; the oracle diff of `search` against it covers non-`into` behaviour only.

Gaps: conformance for `into` is only exercised against StaticPoolStep until the search package builds `vector-knn`; the search card lists the harness calls to add. No JSON schema or golden/fixture changed (gen:schemas outputs unchanged). Open: viewer rendering of pools is described in its card but no fixture contains pools.
