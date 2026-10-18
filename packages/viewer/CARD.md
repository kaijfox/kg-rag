# @kg/viewer (WP12, Haiku/Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.

## Implements
`createViewerServer(reader: LogReader, o?: { port?: number; itemInfo?: (itemId: string) => { label: string; text: string } | null }): http.Server`
(node:http, no framework) serving one static HTML page (inline JS, no build step) and:
- `GET /api/sessions?kind=&limit=` -> `reader.sessions(...)`
- `GET /api/events?session=<id>&after=<seq>&limit=` -> `reader.events(...)`
- `GET /api/search/<searchId>` -> `reader.eventsBySearch(...)`
- `GET /api/notes?session=<id>` and `POST /api/notes {sessionId, text}` -> `reader.addNote` (the viewer's only write)
The page lists sessions, renders one as a timeline (one row per event: query, each search.step with its
top candidates and ranks, the result list, feedback, tool failures, ingest progress), and polls `after=<last
seq>` once a second so a live session grows in place. Holds no state of its own.
- `GET /api/items/<itemId>` -> `itemInfo(itemId)` (404 when null). `itemInfo` is supplied by `app`, which reads the
  store (S6, R-31): the timeline shows a label (e.g. `ThermoKardar#12`) per ranked item and the chunk text on
  demand, which diagnosis needs and the log alone does not have.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`.

## Tests you must pass
- Load each `testkit/fixtures/log/*.jsonl` with `InMemoryEventLog.fromEnvelopes`, start the server on port 0,
  and check every endpoint returns what the reader returns (JSON equality).
- Live view: serve `session-live-partial.jsonl`, fetch with `after=<last seq>` (empty), then append the
  remaining events of that search to the reader (e.g. replay from `session-agent.jsonl`) and fetch again:
  exactly the new events, in order.
- `GET /api/items/<id>` returns what a stub `itemInfo` returns, and 404 for an id it maps to null; the timeline
  for `session-agent.jsonl` with an `itemInfo` built from `loadMiniCorpus()` (label = mini-corpus label, text =
  chunk text) shows the labels, not raw IDs.
- A pure `renderTimeline(events, itemInfo?): string` (exported, used by the page) renders `session-agent.jsonl`
  with one line per event and shows the failed call's error code.
Command: `pnpm --filter @kg/viewer test`.

## Fixtures you may read
`testkit/fixtures/log/*` (README.md describes each session event by event).

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). No store import: the viewer reads the log through `LogReader` and item
labels and texts through the `itemInfo` function `app` passes in.

## Decisions already made
Single static page plus a tiny server; polling, no websockets; notes in a side table, not events.

## Open questions (note, do not decide)
Nested tool calls are linked by parentId since 0.2.0 (eval runs show their searches as children).
Parallel tool calls in one session are top-level siblings.
