# @kg/kernel

The foundation that every use case shares: IDs, the three stores, the machine runner and its load-time check, and the model
and embedding interfaces. It imports nothing else in `packages/`. Third-party: better-sqlite3 and sqlite-vec.

## Open first

| For | File |
|---|---|
| any ID formula (the chunk-ID formula is the one the pinned evaluation questions name) | `src/ids.ts` |
| the index: documents, chunks, derived items, links, embeddings, the audit | `src/indexStore.ts` |
| the history: events (insert-only), sessions, evaluation results, confirmed corrections | `src/historyStore.ts` |
| the model-call cache: responses by request hash, import, export | `src/cacheStore.ts` |
| what a module and a machine are, and the check that refuses a miswired machine | `src/machine.ts` |
| how a machine runs, what a module may write, what is logged | `src/runner.ts` |
| opening a database folder, running a search, the shadow machine | `src/kg.ts` |
| the model client, the cache wrapper, `cacheOnly` | `src/llm.ts` |
| the configuration of a database and its defaults | `src/defaults.ts` |
| the program version and the on-disk format number | `src/version.ts` |

## Worth knowing

- A chunk is current when its ingest number equals its document's. Retiring a document commits it with no chunks, so none is
  current and the stored chunks remain.
- A module returns writes and never writes itself. The runner applies them and stamps them with `name@version`. A search
  run refuses any write.
- Metadata of a chunk is not part of its ID, and a reused chunk gets its metadata refreshed on every ingest.

## Tests

`test/kernel.test.ts` covers IDs, the stores, the runner and the wiring check. `test/beta.test.ts` covers cache import and
`cacheOnly`, call counts and the format stamp.
