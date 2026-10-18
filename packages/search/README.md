# @kg/search

The search service and its one machine. A search is a state machine: `similarity` retrieves the nearest passages of
every query variant (`vector-knn`), then keeps the top k (`truncate`). The service resolves the build and the recipe,
checks the recipe against the registered machine, runs the machine through `@kg/pipeline`, and logs the search
(`query`, `pipeline.started`, one `search.step` per state, `pipeline.finished`, `search.result`).

## Layout

- `src/service.ts`: `createSearch`, the service entry point.
- `src/machines/similarity.ts`: the machine, its settings, and `similarityRecipe()`.
- `src/machines/kit.ts`: `stepActor`, the only place that emits `search.step`.
- `src/steps/`: `vectorKnn` and `truncate`, the two step constructors the machine calls.
- `src/registry.ts`: registered machines keyed by `machine@version`.
- `src/machines/pins.json` and `docs/similarity.mmd`: the pinned topology and the generated diagram. A test fails if either drifts.

## Assumptions

- The topology of `similarity@1` is `ab74647e68ade0b3`. It is the literal in core's `DEFAULT_SEARCH_RECIPE`.
- The embedder must serve the build's embedding space (same model name and dimensions); otherwise the search is refused
  with `precondition`. The digest cannot be checked because the embedder interface does not carry one.
- Retrieval merges: re-running `vector-knn` on its own output changes nothing.
- Settings are checked by hand, not with zod: this package does not declare zod and dependencies cannot be added.
  The check has the same effect as a strict schema (unknown keys, bad `pool`, bad or repeated `kinds` are rejected).

## Known gaps

- The `fuse` step and the named-pool readers of later machines are not built.
- Only one machine exists; decomposition and critique loops are future work.
- The `llm` dependency is passed to the steps but no v0 step uses it.
- The mini-corpus fixture suite for v1 builds depends on testkit's v1 search recipe carrying a registered version.
