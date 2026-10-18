# @kg/api (WP9, Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else.

## Implements
`createApiHandlers(d: { store: CorpusStore; log: EventLog & LogReader; search: SearchService; ingest: IngestService }): KgHandlers`
and `createApi(rt: ToolRuntime, d): KgApi = createKgApi(rt, createApiHandlers(d))`. **You write no logging
code**: core's `createKgApi`/`runTool` append tool.called / tool.returned / tool.failed; your handlers only
`ctx.emit` domain events.

## Handlers (core `api.ts` documents each method)
- `search`: delegate to `d.search.search(ctx, r)`.
- `getItems`: build = `r.buildId ?? current build` (none -> `precondition`, unknown -> `not_found`); return only
  items that are members of that build (`store.getBuild(b).itemIds`, R-26); emit `items.fetched {itemIds: <requested>}`
  with that build.
- `feedback`, `reportUsage`: look the search up with core `findSearch(log, searchId)` (unknown ->
  `not_found`); every named item must be in its `resultItemIds` (else `invalid_input`); emit with
  `{ searchId, buildId: <the search's build> }` (Rule 6: not the current build). Payload of feedback:
  `{overall: r.overall ?? null, items: r.items ?? [], note: r.note ?? null}`. Return `{eventId}` of the event.
- `reportOutcome`: search optional; build = the search's build if given, else the current build.
- `ingest`: delegate to `d.ingest`.
- `snapshotBuild`: current build (none -> `precondition`), `store.labelBuild(name, build)` (insert-only:
  `conflict` if the name names another build), emit `build.labeled`, then `staleCheck` and emit `build.stale`
  if stale. Return `{buildId, stale}`.
- `addNote`: `log.addNote(ctx.sessionId, text)`; return `{noteId}`; no domain event.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`.

## Tests you must pass
`test/conformance.test.ts`, exactly:
```ts
import { kgApiConformance, registerSuite } from '@kg/testkit/conformance';
import { miniApiHarness } from '@kg/testkit';
import { createApiHandlers } from '../src/index';
registerSuite(kgApiConformance(() => miniApiHarness((d) => createApiHandlers(d))));
```
15 cases incl. event sequences per method, Rule 6 after the build changes (feedback, usage, outcome,
items.fetched), a search pinned to a non-current build tagging every step and the result, getItems membership,
a stale snapshot announcing build.stale, unknown-search and invalid-input failures logged as tool.failed. Command: `pnpm --filter @kg/api test`.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). Never call `EventLog.append` (CI grep, app/test/architecture.test.ts).

## Decisions already made
Logging lives in the tool contract (`KgApi`/`runTool`), MCP is a thin adapter (user decision Q2); feedback
takes overall and/or per-item relevance in one call (contract-revisions R-06); relevance scale 0/1/2.

## Open questions (note, do not decide)
Whether `usage` should be allowed to name items fetched with `getItems` but not returned by the search.
