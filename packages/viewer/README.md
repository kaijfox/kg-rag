# @kg/viewer

A read-only web view of the event log: a list of sessions, each one as a timeline, and for a pipeline run (search,
ingest, eval) a diagram of its state machine with the path that run took lit up. Node `http` only, no framework, no
build step. The browser page is plain JavaScript (`web/`), and Mermaid is vendored (`vendor/`), so the page makes no
network requests of its own.

`createViewerServer(reader, o)` returns an `http.Server`. It reads everything through the core `LogReader` port.
It keeps no state: a page refresh and a server restart show the same thing. The only write is `POST /api/notes`
(notes go to the reader's side table; no event is appended).

```ts
import { createViewerServer } from '@kg/viewer';
const server = createViewerServer(reader, { port: 4319, itemInfo, machines });
```

`port` makes the server listen on 127.0.0.1 at once. Without it the caller listens and must bind the loopback interface. `itemInfo(itemId)` returns
`{ label, text }` or `null`; `machines(machine, version)` returns a core `MachineMap` or `null`. The app supplies both
(the viewer never imports a store or a pipeline package).

## Endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/sessions?kind=&limit=` | `reader.sessions({kind, limit})`; `kind` is checked against the four session kinds |
| `GET /api/events?session=&after=&limit=` | `reader.events(session, after, limit)` |
| `GET /api/search/<searchId>` | `reader.eventsBySearch(searchId)` |
| `GET /api/notes?session=` | `reader.notes(session)` |
| `POST /api/notes` `{sessionId, text}` | `reader.addNote`, 201 with the note |
| `GET /api/items/<itemId>` | `itemInfo(itemId)`, 404 when null or when no `itemInfo` was given |
| `GET /api/machines/<machine>@<version>` | `machines(machine, version)`, 404 when null or when no `machines` was given |
| `GET /`, `/app.js`, `/render.js`, `/vendor/mermaid.min.js` | the page and its scripts |

## Cross-site and rebinding protection

The log and the chunk text are private to the machine, so the server only answers loopback names.

- Every request (API and page) whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (any port) gets 403.
  That stops DNS rebinding, where an attacker's name resolves to 127.0.0.1 and the browser sends the attacker's `Host`.
- `POST /api/notes` needs `Content-Type: application/json` (415 otherwise; a cross-site form or `text/plain` fetch is
  sent without a preflight, so the type is the check) and an `Origin` that is absent or loopback (403 otherwise).
- Responses carry `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` and
  `X-Content-Type-Options: nosniff`.
- The timeline is built as an HTML string (`renderTimeline`) and set with `innerHTML`: every string is passed through
  `escapeHtml` and every numeric payload field through a number check that escapes anything that is not a finite
  number, so a log row that bypassed validation cannot inject markup. The only other `innerHTML` sink is Mermaid's SVG
  (`securityLevel: 'strict'`); everything else in `web/app.js` uses `textContent`.

Errors are `{ error: { code, message } }`. `KgError` maps `not_found` to 404, `invalid_input` to 400 and anything else
to 500. Unknown paths give 404 and a method other than GET or POST gives 405.
A failed work state logs no `search.step`, so the diagram marks it as the stop without counting a visit and draws the path up to it.

## The page

- Sessions on the left (refreshed every five seconds). The selected session is in the URL hash.
- The page follows the hash (changing it switches session), clears the item panel on a session switch, and follows
  the latest run of a live session until the reader picks an earlier one. The session list is ordered by session
  start (not last event) and does not redraw while the pointer is over it. `web/render.d.ts` declares the module for
  consumers that do not set `allowJs`.
- Events are polled every second with `after=<last seq>`, so a live session grows in place. Each poll appends to
  client memory; nothing is kept on the server.
- Timeline: one line per event (`renderTimeline`). Search steps show the state beside them, the top five candidates by
  label and rank, and expandable lists of all considered candidates and of named pools. Item IDs are shown as labels
  from `itemInfo`; click one to see its chunk text. Failed calls show their error code.
- Machine run: the run picker lists every `pipeline.started` in the session; the latest is drawn. The diagram is
  drawn from the run's events and the `MachineMap` named in its `pipeline.started`. Below it, one button per state
  shows that state's search step payloads (JSON).
- Notes: a textarea and the list of the session's notes.

## Machine overlay

The pure functions live in `web/render.js` (no imports, so the page and the tests run the same code); `src/index.ts`
re-exports them.

- `pathOverlay(map, events)`: `visits` counts logged states (a `search.step` maps to its `trace.state`; any other
  event maps to the first node whose `logs` contains its type). `moves` counts map edges traversed between
  consecutive logged states, following the shortest path through unlogged routing states. `stop` is the state of a
  failed `pipeline.finished`. `final` is the final state reached.
- `nextOf(map, events)`: while a run has no `pipeline.finished`, the states it may enter next (done or always
  successors, through routing states). Empty once finished.
- `mermaidOf(map, overlay?)`: `stateDiagram-v2` text. Visited nodes show their count (or rounds, for a loop node);
  unvisited nodes are grey; traversed moves carry their count in the label (`x2`; `linkStyle` is not used, Mermaid's state diagrams draw it as extra states); the stop and final states are marked;
  next states are dashed. Nodes the run reached only by routing count as visited.
- `diagramOf(map, run)`: the text for one run, or `null` when the flat timeline must be shown instead (no
  `pipeline.started`, a different machine, version or topology, or a step in a state the map does not have).
- `runsOf(events)`: splits a session into runs, from each `pipeline.started` to its `pipeline.finished`.
- `renderTimeline(events, itemInfo?)` and `escapeHtml`.

## Vendored Mermaid

`vendor/mermaid.min.js` is Mermaid 12.1.0 (MIT, Knut Sveidqvist and contributors), the newest release on npm that was
more than two weeks old when vendored (published 2026-10-02). It is the `dist/mermaid.min.js` of the npm package,
self-contained (no lazy chunk loads), sha256 `6484afc32872a3aa16cac9a76ba1816a1ed4cc870a6593cc2e17757750f518b2`.
Its licence file is `vendor/LICENSE-mermaid`. Version, date and hash are also in `vendor/README.md`.

## Tests

`pnpm --filter @kg/viewer test` (30 tests):

- `test/server.test.ts`: every read endpoint returns what the reader returns, for each fixture session (JSON
  equality), with `after`/`limit`, by search, and for notes; bad requests and methods; the page and the vendored
  bundle served from the viewer's own origin; live view (`session-live-partial` grows by exactly the appended events,
  in order); item and machine endpoints with stubs and with the mini-corpus `itemInfo` (the agent timeline shows
  labels, not raw IDs); note writes; foreign `Host`, foreign `Origin` and non-JSON POST refused, security headers.
- `test/render.test.ts`: one line per event for `session-agent`; escaping; pools; the Mermaid text of the machine;
  `pathOverlay` on the recorded search run, on a loop (`retrieve` visited twice, `check` routed twice), on failed
  runs (stop at a work state, and at `failed` via the error edge), and on a hand-made ingest log; `nextOf` and
  `diagramOf` on an in-progress run; fallbacks to the flat timeline.

Typecheck: `pnpm --filter @kg/viewer typecheck`. The Mermaid overlay was checked as text only; no browser rendering
was run.

## Assumptions

- A run is the events from a `pipeline.started` to its `pipeline.finished`. A search without `pipeline.started`
  (the cut-off second search in `session-live-partial`) is shown flat.
- For an ingest or eval event, the mapping to a state uses the first node whose `logs` contains the type. A type
  listed by two nodes is not checked for; the first one wins.
- Ingest visits count events, not entries into a state.
- `port` in the options is applied by `createViewerServer` itself (listen on 127.0.0.1); without it the caller listens
  and must bind loopback. The Host check refuses other names but does not replace binding to loopback.
- The overlay is drawn with `classDef` and class lines and edge labels; no `linkStyle`.

## Known gaps

- The page was checked once in Chrome against the three fixtures (a finished session and the live search overlay); there is no automated browser test.
- The timeline is re-rendered whole on each poll. Fine for fixture-sized sessions; a long session would need
  incremental rendering.
- `itemInfo` is synchronous. The page fetches the labels of the items it sees before drawing and caches them for the
  page's lifetime; a label for an item that appears later is fetched on the next poll.
- The machine diagram needs `pipeline.started`. The fixture `session-live-partial` has none for its cut-off search,
  so the live overlay cannot be shown for that search (see the change proposal).
- Nested machine states (`parent`) are drawn as Mermaid composite states with their transitions at the top level.
  No map in the fixtures uses them.
- The vendored bundle contains third-party code whose notices (for example MIT) sit in its comments. Their full
  licence texts are not vendored separately.
