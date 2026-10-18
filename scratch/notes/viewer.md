# @kg/viewer notes

## What was done
- `packages/viewer/src/server.ts`: `createViewerServer(reader, o)` on node:http. Read endpoints for sessions, events,
  search, notes, items and machines; `POST /api/notes` is the only write. Static files come from `web/` and `vendor/`,
  read once at startup, fixed paths only.
- `packages/viewer/web/render.js`: pure functions (`renderTimeline`, `mermaidOf`, `pathOverlay`, `nextOf`, `diagramOf`,
  `runsOf`, `escapeHtml`). Plain JS with JSDoc and `// @ts-check`; the browser and the tests import the same file.
- `packages/viewer/web/index.html` and `web/app.js`: the page. Plain JS, no build; polls `after=<last seq>` every second.
- `packages/viewer/vendor/`: Mermaid 12.1.0 `mermaid.min.js`, its MIT licence, and `README.md` with version, date and hash.
- `packages/viewer/src/index.ts` re-exports the server and the pure functions. `tsconfig.json` gained `allowJs` and
  `web` in `include`. `package.json` untouched.
- Tests: 25 pass (`test/server.test.ts` 12, `test/render.test.ts` 13). Typecheck passes. `pnpm depcruise` passes.
- Served the three fixture sessions (plus the mini-corpus item source and the similarity machine) on port 4319 and
  fetched the endpoints with curl. Results: agent session 57 events, `after=52&limit=3` gave seq 53 to 55; eval session 25
  events; live session 12 events, then 16 after the simulated tail (`after=12` gave seq 13 to 16, `after=16` gave `[]`);
  `/api/items/ch_k6...` gave the chunk label `entropy/2.1-d0` with its text; unknown item 404; bad kind 400; notes POST 201
  and GET listed it. Computed the diagram text of the finished search: `retrieve (x1)`, `check` marked visited (routing on
  the path), `cut (x1)`, `done` final, three links highlighted.
- Not done: no browser run of the page. `web/app.js` passes `node --check` only.

## Assumed
- A run is the events from `pipeline.started` to `pipeline.finished`. Live overlay needs `pipeline.started`; the cut-off
  search in `session-live-partial` has none, so it shows flat (change proposal 1, open question Q10).
- Ingest and eval events map to a state through the first node whose `logs` lists their type.
- Ingest visits count events.
- `port` makes the server listen on 127.0.0.1 at once. Otherwise the caller listens.
- `itemInfo` is synchronous; the page prefetches labels for items it sees and caches them.
- Mermaid link indexes: initial `[*]` transition is link 0, map edges follow in order, finals last. Checked on the text only.

## Surprised by
- `session-live-partial`'s second search has no `pipeline.started`, even though the 0.5.0/0.6.0 contract says every
  search writes it right after `query`. The fixture README says the search was "left as it was".
- The `tool.called` and `tool.returned` rows carry item IDs inside JSON (`report_usage` input, `top` in summaries).
  Labels have to be substituted there too, or the timeline shows raw IDs.
- Tool events of a search have `searchId` null on `tool.returned`, so re-keying fixture events for the live test needs care.
- `mermaid.min.js` has no `import()` calls and no chunk directory dependency, unlike the `chunks/` folder in the same
  package; the single file was enough.

## Would flag
- The page is untested in a browser, and the Mermaid overlay (link indexes, class names) is verified against the text only.
- Full timeline re-render on each poll; fine at fixture size, not for long sessions.
- The overlay for a live run stops at the last logged state; the "next" set can contain two states after a loop.
- `renderTimeline` output is rebuilt for the whole session on every poll, not only for new events.

## Reads beyond style references
- Read core `src/` (events, machineMap, ports/log, model, schemas, ids, errors, index) and testkit `src/` (fakes/eventlog,
  fixtures, minicorpus, index) and `fixtures/` READMEs, as the card allows.
- Read `packages/mcp/CARD.md` (first lines) and `packages/store/README.md` only for style.
- Read `.dependency-cruiser.cjs` to check the star rule.
- Read `scratch/` (decision log, open questions, change proposal format) to match formats.
- Did not open `packages/app/src/skeleton`.
