# @kg/api

The handlers behind core's `KgApi` tool contract. `createApiHandlers(deps)` returns the `KgHandlers` that core's
`createKgApi` wraps; `createApi(runtime, deps)` builds the full `KgApi`. Logging is done by core (`runTool`), so
handlers only emit domain events through `ctx.emit`.

Imports only `@kg/core`. Tests use `@kg/testkit`.

## Assumptions

- `search`, `ingest` are delegated to the injected `SearchService` and `IngestService` unchanged.
- `getItems` defaults to the current build. Items are returned only if they are members of that build; the
  `items.fetched` event carries the requested IDs and the build used.
- `feedback`, `reportUsage` and `reportOutcome` (with a search) take their build from the search's `query` event
  (core `findSearch`), not from the current build (Rule 6). Unknown searches fail with `not_found`.
- Feedback and usage may only name items that the search returned; otherwise `invalid_input`.
- `reportOutcome` without a search records the current build.
- `snapshotBuild` labels the current build, emits `build.labeled`, and emits `build.stale` only when the store
  reports the build as stale.
- `addNote` writes through the event log's note table and emits no domain event.

## Known gaps

- Whether `usage` may name items that were fetched with `getItems` but not returned by the search is open in the
  card. The handler follows the card and rejects them.
- No handler-level test beyond the shared conformance suite.
- `reportOutcome` with no search and no current build records a null build; nothing checks this.
