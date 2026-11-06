# @kg/kernel

The fixed foundation. Imports nothing else in `packages/`. Third-party: better-sqlite3 and sqlite-vec.

- `ids.ts`: every ID formula. The chunk-ID formula is the one the pinned evaluation questions cite.
- `indexStore.ts`: the index. A chunk is current when its ingest number equals its document's. `commitDerived` refuses a
  derived item with no source chunk and writes nothing in that case. `audit()` lists rule violations (empty is clean).
- `historyStore.ts`: events (insert-only), sessions, notes, evaluation runs and results, confirmed corrections.
- `cacheStore.ts`: compressed model responses by request hash, pruned least-recently-used to a size cap.
- `machine.ts`: `ModuleDef`, `MachineDef`, `Registry`, and `checkMachine`, the load-time check. A machine whose step needs a
  slot that is not available on every path to it is refused.
- `runner.ts`: runs a machine. A module may set only the slots it declares in `adds`; its `writes` are applied by the runner,
  which stamps them with `name@version`. Every step is logged with the ranked lists it received and returned.
- `kg.ts`: `Kg` opens a database directory and runs searches.

Search machines end by setting `results` (a ranked list of candidates). Build machines write through `writes`.
