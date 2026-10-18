# @kg/viewer (WP12, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else. Do not read `packages/app/src/skeleton`.

## Implements
`createViewerServer(reader: LogReader, o?: { port?: number; itemInfo?: (itemId: string) => { label: string; text: string } | null; machines?: (machine: string, version: string) => MachineMap | null }): http.Server`
(node:http, no framework; `port`: when given, the server listens on 127.0.0.1 at that port, otherwise the caller listens and must bind loopback; requests with a non-loopback `Host` get 403, and `POST /api/notes` needs a JSON content type and an absent or loopback `Origin`) serving one static HTML page (inline JS, no build step) and:
- `GET /api/sessions?kind=&limit=` -> `reader.sessions(...)`
- `GET /api/events?session=<id>&after=<seq>&limit=` -> `reader.events(...)`
- `GET /api/search/<searchId>` -> `reader.eventsBySearch(...)`
- `GET /api/notes?session=<id>` and `POST /api/notes {sessionId, text}` -> `reader.addNote` (the viewer's only write)
The page lists sessions, renders one as a timeline (one row per event: query, each search.step with its
top candidates and ranks, the result list, feedback, tool failures, ingest progress), and polls `after=<last
seq>` once a second so a live session grows in place. Holds no state of its own.
- `GET /api/items/<itemId>` -> `itemInfo(itemId)` (404 when null). `itemInfo` is supplied by `app`, which reads the
  store: the timeline shows a label (e.g. `ThermoKardar#12`) per ranked item and the chunk text on
  demand, which diagnosis needs and the log alone does not have.

## package.json
Already created. Do not run `pnpm install` and do not add npm dependencies (the diagram library is vendored as a file, below).

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

## Machine diagrams and the path overlay (0.5.0)
Every search, ingest and evaluation run is a state machine, and its log shows which states ran. The viewer draws the machine and lights up the path one run took.
- `GET /api/machines/<machine>@<version>` -> `machines(machine, version)` (a core `MachineMap`; 404 when null or when no `machines` function was given). `app` supplies
  `machines` from the registered machines; the viewer never imports a pipeline package.
- The page reads the `MachineMap` named by a session's `pipeline.started` event (`machine`, `version`) and renders the diagram with a vendored Mermaid bundle: a
  committed, version-pinned file under `packages/viewer/vendor/` (choose the newest `mermaid` release on npm that is more than two weeks old: `npm view mermaid time`;
  `npm pack` it in a scratch directory, copy only the minified browser bundle and its licence file; record version, date and file hash in `vendor/README.md`), served by
  the viewer server from its own origin. The page loads nothing from the network. The diagram text comes from a pure exported `mermaidOf(map: MachineMap): string`
  written in this package (same format as the one in the pipeline package: `stateDiagram-v2`, but do not import it).
- Overlay: a `search.step` event maps to the node whose id equals `trace.state`; an ingest event maps to the node whose `logs` contains the event type. Visited nodes
  are marked with a visit count, traversed moves are highlighted (unlogged routing states between two logged states are filled in by following the map's moves; the
  next logged state selects the move), a loop shows its round count, the final state is marked, and for a failed run the state in `pipeline.finished` is marked as the
  stop. Unvisited nodes stay grey. Clicking a node shows that visit's `search.step` payload (the viewer already renders it). Marking is done with classes or Mermaid
  `classDef` lines and edge labels generated into the diagram text (do not depend on the identity of rendered SVG elements).
- Pure exported function `pathOverlay(map: MachineMap, events: EventEnvelope[]): { visits: Record<string, number>; moves: {from: string; to: string; count: number}[]; stop: string | null; final: string | null }`, unit tested on
  the search fixtures in `testkit/fixtures/log` and a hand-made ingest log; `renderTimeline` shows the state name beside each `search.step` row.
- Live sessions: the overlay updates with each poll; the current node is the successor of the last logged state until `pipeline.finished` arrives.
- Degradation: an unknown machine or version, a log without `pipeline.started`, or a step without `state` falls back to the flat timeline. Everything shown comes from
  the event log and the immutable map, never from live actors.
- Tests: `GET /api/machines/...` returns what a stub returns (and 404); `pathOverlay` on a loop (a state visited twice) and on a failed run; the page for a session
  with `pipeline.started` includes the diagram text with the highlight lines (test the generated text, not a browser render).

## Fixtures you may read
`testkit/fixtures/log/*` (README.md describes each session event by event).

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). No store import: the viewer reads the log through `LogReader` and item
labels and texts through the `itemInfo` function `app` passes in.

## Decisions already made
Single static page plus a tiny server; polling, no websockets; notes in a side table, not events.

## Open questions (note, do not decide)
Nested tool calls are linked by parentId (eval runs show their searches as children). A `search.step` trace may carry `pools` (name -> ranked refs, after the
step): render the field when present (a step row can expand to "pools: name (n)" with the ranked list like `considered`) and tolerate its absence. A step that wrote
pools but did not change `candidates` (output equals considered) is normal, not a bug. Do not invent semantics beyond core `ports/search.ts`. Parallel tool calls in
one session are top-level siblings.
