# machine: a hand-written machine map and one recorded search run (contract 0.6.0)

Inputs for the machine conformance suites (`src/conformance/machine.ts`). Nothing here is produced by a pipeline
run; both files are written by hand and checked by the test suites.

- `search-map.json`: a MachineMap for the `similarity` search machine (topology `69bc55d30db24c90`, the topology of
  `DEFAULT_SEARCH_RECIPE`). States: `retrieve` (work, vector-knn, a loop target), `check` (routing: loops back to
  `retrieve` while the pool is too small, otherwise moves on), `cut` (work, truncate to k), and the finals `done` and
  `failed`. Every work state has an `error` move to `failed`.
- `search-run.jsonl`: the events of one search, one session (session.started, tool.called, query, pipeline.started,
  search.step x2 in states `retrieve` then `cut`, pipeline.finished with state `done`, search.result, tool.returned).
  Its steps and pipeline events agree with the map. The step traces carry empty `considered`/`output` lists: this
  file exercises envelope and machine structure, not ranking.
