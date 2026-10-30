# Review C: surfaces and tooling (mcp, viewer, app, testkit, root config)

Read: packages/mcp, viewer (src, web), app, testkit; root package.json, pnpm-workspace.yaml, .dependency-cruiser.cjs, tsconfig.base.json; package cards and tests; sprint briefs, retros, decision log, notes. Checks run: `pnpm -r test` (all green, 17 s wall for roughly 1,000 tests), `pnpm depcruise` (clean, 1.8 s), machine sizes via `machineMaps()`. Nothing edited except this file.

## Summary

The surfaces are small and mostly sound: MCP is 81 lines over the SDK, the viewer server is 210 lines of node:http, tests are fast. The cost sits elsewhere. The viewer's diagram feature pulls in a 5.5 MB library and about 180 lines of path-matching code to draw machines of 4 nodes (the search machine) in the common case. The app package is mostly a retired oracle (the skeleton, 117 of its 119 tests) plus one-off scripts, and it still offers no way to run the tool on a new document. Testkit is the largest package (4,514 source lines, bigger than anything it tests except core). Counts (15 findings): 3 needs-the-user, 5 evidence-resolvable, 7 arbitrary.

## Findings (most severe first)

### F1. The tool cannot be pointed at a new corpus without writing a script
- **Finding:** There is no CLI or config loader; the only entry points are three `tsx` scripts that hardcode `scratch/integration/` and, for MCP, disable the PDF parser fallback.
- **Where:** packages/app/README.md:16 ("no config file loader; no CLI wrapper"); packages/app/scripts/serve-mcp.ts:6-8 (`compose` called without `sidecar`); packages/app/src/compose.ts:46,99 (sidecar default false, missing artifact dir defaults to `/nonexistent-artifact-dir`); packages/app/package.json:12-16.
- **Evidence:** with `sidecar` unset a PDF with no cached artifact returns `not_found` (compose.ts:70-75). The MCP `ingest` tool (core api.ts:134) therefore only works for the four pre-parsed stat-mech PDFs. Sprint 2 ingest ran through `baseline.ts` with author names hardcoded (baseline.ts:20-25).
- **Lens:** 1 (specified but missing), 5.
- **Kind:** needs the user (is a launch command part of v0 scope?).
- **Proposed direction:** A single `kg` entry (flags: database path, corpus directory, sidecar on/off, `--serve mcp|viewer`) replacing serve-mcp, serve-viewer and the hardcoded scripts. Before the relation layer, decide whether v0 is "a library plus scripts" or "a tool someone can run".
- **Plain-language line:** Today you cannot hand the tool a new PDF and ask questions of it; only the stat-mech books work, because someone has to write a script for anything else.

### F2. The viewer's machine diagram costs more than it shows
- **Finding:** Mermaid (5.5 MB vendored) plus a hand-written path-overlay layer draw a state diagram whose usual subject has 4 nodes and 4 edges.
- **Where:** packages/viewer/vendor/mermaid.min.js (5,493,176 bytes), vendor/README.md; web/render.js:155-330 (`loggedStates`, `pathTo`, `pathOverlay`, `nextOf`, `mermaidOf`, `diagramOf`, about 180 lines), web/app.js:195-235; server.ts:21 and `no-store` on it (server.ts:36).
- **Evidence:** machine sizes: `similarity@1` 4 nodes/4 edges, `ingest@1` 8/13, `document@1` 13/23, `eval-run@1` 9/16. Agent sessions (the viewer's purpose in the design) only run the similarity machine. The search path is already shown as the list of `search.step` rows and the `states` chips (app.js:238-255). The design's viewer is "a timeline ... like a chat transcript" (design, Companion Tools); the diagram came from the state-machine amendment, and the retro (sprint-1/retro.md) says its reason (loops, decomposition) has no v0 consumer. Overlay code also guesses unlogged routing states by shortest path (render.js:106-135), which is a heuristic, not a record.
- **Lens:** 2, 3.
- **Kind:** needs the user (it changes a visible feature added by amendment).
- **Proposed direction:** Smallest version: show the run's states as an ordered strip ("retrieve x1, cut x1, done") from the log alone, with the existing click-to-see-payload; delete `pathOverlay`, `nextOf`, `diagramOf`, `mermaidOf`, the vendor directory and its CSP/route. If a picture is wanted later, draw the map as a plain inline SVG in a layer-by-layer layout (the maps are tiny DAGs with at most one loop) rather than reintroduce a library. Do not add d3 or graphviz-wasm; they add a layout concept the tool does not need.
- **Plain-language line:** The viewer can draw the search pipeline as a diagram, but the pipeline has four steps, so a plain list of the steps taken tells you the same thing without shipping a 5 MB drawing library.

### F3. Most of the app package is a retired oracle
- **Finding:** `src/skeleton/` (784 lines), its 117 tests and a root script keep a second implementation of ingest, search, chunking, API and Ollama clients alive that no real package uses.
- **Where:** packages/app/src/skeleton/* (chunker 272, ingest 171, search 152, ollama 72, api 66, viewer 51); packages/app/src/index.ts:1-76; test/skeleton.test.ts (103 tests), test/chunker.test.ts (13); root package.json:11 (`skeleton` script); package.json:20 (`@kg/testkit` as a runtime dependency, only for the skeleton).
- **Evidence:** only 2 of the 119 app tests are not skeleton tests (architecture.test.ts) and 1 exercises `compose` (test/compose.test.ts). Real packages pass the same conformance suites; the oracle diff is finished (sprint-1/review-oracle-diff.md); cards forbid reading the skeleton. Remaining users: `record-log-fixtures.ts` (cannot reproduce the committed fixture, see F8), `scripts/spikes/*` (import `skeleton/chunker`), testkit/README.md:13 (names the skeleton ingest as "the reference"). Duplicates: `ollamaEmbedder` exists in @kg/embed and in skeleton/ollama.ts:12; `ollamaLlm` in app/src/ollamaLlm.ts and skeleton/ollama.ts:52.
- **Lens:** 1 (built but unused), 2.
- **Kind:** evidence-resolvable. Check: delete `src/skeleton`, `skeleton.test.ts`, `chunker.test.ts`, `scripts/skeleton.ts` in a scratch copy, run `pnpm check`; grep shows no other package imports them.
- **Proposed direction:** Remove from the tree (it stays in git history at 9fa235e), run the ingest conformance scenarios against `@kg/ingest` in its own tests, and drop `@kg/testkit` from app's dependencies.
- **Plain-language line:** The repository carries a throwaway first draft of the whole system that nothing uses any more; it makes the test count look bigger than the real coverage of the finished app.

### F4. Testkit is the largest package, and exists mainly because of the import rule
- **Finding:** Testkit is 4,514 source lines (conformance 2,700, fakes 1,000, broken fakes 359), against 81 to 1,329 for every package except core (2,638). The in-memory store fake (396 lines) shadows the 733-line SQLite store.
- **Where:** packages/testkit/src/fakes/store.ts, src/conformance/*.ts, src/broken/index.ts, test/meta.test.ts (tests that the suites catch the broken fakes); .dependency-cruiser.cjs:20-27 (star rule), :107-113 (testkit rules).
- **Evidence:** sprint-1/retro.md: 39 change proposals, "most came from conformance suites and cards that disagreed with each other after contract 0.5.0"; wave1-todo.md: 25 of 99 skeleton tests failed after one contract bump until suites were patched. The fake exists because packages may not import `@kg/store` even in tests; but `compose.test.ts:20-26` already uses SQLite `:memory:` as the fast store.
- **Lens:** 2, 3, 4.
- **Kind:** needs the user (it questions the star rule, signed off in Sprint 0).
- **Proposed direction:** Do not grow testkit for the relation layer. Consider letting package tests import `@kg/store` and `@kg/eventlog` over `:memory:`, retiring the store, eventlog and evalrepo fakes and their meta-tests, and keeping testkit for fixtures, golden vectors, the scripted LLM and the conformance suites that real implementations run. Saves roughly 600 to 900 lines and the "two implementations must agree" cross-check.
- **Plain-language line:** A large share of the test scaffolding re-implements the database so tests do not need the real one; it slowed every contract change, and the real in-memory database is already fast enough.

### F5. The viewer page builds HTML by string, so safety and speed rest on hand-written escaping
- **Finding:** `renderTimeline` returns concatenated HTML set through `innerHTML`; escaping each field is the only barrier, and the whole timeline is rebuilt on every poll.
- **Where:** web/render.js:13-35 (`escapeHtml`, `n()` that escapes numerics), :56-125 (`rowBody`); web/app.js `draw` (full re-render each second); viewer/README.md cross-site section; notes/viewer.md "Would flag".
- **Evidence:** review-ingest-eval-viewer.md should-fix 4 and 5 (Host/Origin gaps; numeric fields injected unescaped, fixed by a number check). Sprint-1 integration found five page defects only in real Chrome (list reorder, hash change, run picker, item panel, failed run grey), none caught by the 33 tests, because `app.js` (334 lines) has no test. The render path was never timed on a long session.
- **Lens:** 3, 5.
- **Kind:** evidence-resolvable. Check: time `draw` on a 5,000-event session (a 300-search eval run is about that size).
- **Proposed direction:** Build rows with `document.createElement`/`textContent` and append only new events. This removes the escaping layer without a framework, and the server checks (loopback Host, Origin, JSON type) stay, since they are small and the log is private. Do not adopt a UI framework.
- **Plain-language line:** The viewer could slow down on long sessions, and its protection against odd log content depends on every field being cleaned by hand.

### F6. The sprint-2 scripts are the real eval entry points but live as ad hoc files
- **Finding:** `baseline.ts`, `baselineRun.ts`, `precheck.ts`, `extractPilot.ts` (about 380 lines) drive every number in the sprint-2 results, hardcode `scratch/sprint-2/` and the author names, are not in package.json, and the analysis is a separate Python file.
- **Where:** packages/app/scripts/baseline.ts:20-25, baselineRun.ts:17-20, precheck.ts:15-17, extractPilot.ts:1-18; sprint-2/results.md "Reproduction"; no `package.json` script entries (package.json:12-16).
- **Evidence:** results.md names these as the reproduction path; the run is not replayable (local model answers not bit-reproducible, no replay cache: results.md Reproduction).
- **Lens:** 1, 4.
- **Kind:** arbitrary (the numbers do not change; only where the files live).
- **Proposed direction:** Keep them, move into a `scripts/eval/` area (or into the eval package) with a corpus/author argument, and record the exact commands in results.md. Delete `integrate.ts` (174 lines): its ingest/search/mcp stages are covered by compose.test.ts and baseline.ts, and its eval stage by baselineRun.ts.
- **Plain-language line:** The commands that produced the baseline numbers exist but are scattered and tied to one pair of books, so repeating the experiment on another corpus means copying and editing them.

### F7. Dead and over-built dependency rules
- **Finding:** Three of the 12 depcruise rules (and half the header comment) govern `@statelyai/inspect`, which no package uses; four more narrow who may import `@kg/pipeline`.
- **Where:** .dependency-cruiser.cjs:3-7, :60-80 (`statelyai-inspect-app-devdep-only`, `statelyai-inspect-not-runtime-in-app`, the pathNot in `xstate-only-in-pipeline`), :31-56 (pipeline-specific rules); `grep statelyai packages/*/package.json pnpm-lock.yaml` returns nothing.
- **Lens:** 1, 2.
- **Kind:** arbitrary (the result of `pnpm depcruise` is unchanged).
- **Proposed direction:** Delete the inspector rules; keep star, core-leaf, core-runtime-deps, xstate-only-in-pipeline, testkit-only-in-tests, unresolvable and circular (7 rules). Fold `architecture.test.ts:12-26` (package.json check) into the same set or leave; it overlaps only partly.
- **Plain-language line:** The architecture checker still guards a debugging tool that was never installed.

### F8. The log fixtures cannot be regenerated as documented
- **Finding:** `record-log-fixtures.ts` says it records testkit's log fixtures from the skeleton, but `session-live-partial.jsonl` was patched by hand afterwards (open question Q10), so rerunning clobbers a committed fixture; the viewer tests and the machine-conformance fixtures depend on these.
- **Where:** packages/app/scripts/record-log-fixtures.ts:1-8; testkit/fixtures/log/README.md:7,12; decision-log.md:161.
- **Lens:** 4.
- **Kind:** arbitrary.
- **Proposed direction:** With F3, declare the three `.jsonl` files static fixtures, delete the recorder, edit the README to say "hand-maintained".
- **Plain-language line:** The sample logs the viewer tests rely on are described as machine-generated but are partly hand-edited, which is a trap for whoever next tries to refresh them.

### F9. Mutation testing is a manual ritual run from outside the repo
- **Finding:** Each sprint's mutation rounds (sprint 0: 38 mutants; sprint 1: 203, 65 survived; sprint 2: 91 on the chunker) use one-token mutation scripts kept in a scratchpad.
- **Where:** notes/chunk-freeze-tests.md:4 (`scratchpad/mut.py`); sprint-0/retro.md; sprint-1/retro.md.
- **Evidence:** survivors concentrated in boundary comparisons; the harness is not in the repository, so the next round must be rewritten.
- **Lens:** 3, 4.
- **Kind:** evidence-resolvable. Check: run StrykerJS (vitest runner) on `packages/chunk` and compare its survivors with the 5 equivalent survivors in the notes. It adds a dev tool, not a concept (it automates what is already done). If a round is not repeated, do nothing.
- **Proposed direction:** Adopt only if mutation rounds continue past sprint 3; otherwise commit `mut.py` next to the chunk tests so the work is repeatable.
- **Plain-language line:** The checks that tested our tests were run by a throwaway script that is not saved, so the next round starts from scratch.

### F10. MCP and viewer documents describe code that has since changed
- **Finding:** Three accounts of how MCP schemas are produced disagree.
- **Where:** packages/mcp/README.md (says the schemas come from SDK internal `zod-json-schema-compat.js` by deep path); packages/mcp/CARD.md:10-14 (says register with `TOOLS[k].input`); packages/mcp/src/index.ts:50-56 and core jsonSchemas.ts:14-17 (uses `z.toJSONSchema`, no SDK internals); notes/mcp.md.
- **Lens:** 4.
- **Kind:** arbitrary.
- **Proposed direction:** Rewrite the README gap list to the code; drop the false "future SDK may move it" risk.
- **Plain-language line:** The MCP notes warn of a fragility that is not in the code.

### F11. Smaller items
- **A. Viewer re-exports 9 pure functions that no package imports** (viewer/src/index.ts:5, web/render.d.ts); they force `allowJs` in viewer and app tsconfigs (decision-log.md:235, kind arbitrary). Only `createViewerServer` is consumed (app compose.ts:36). Drop the re-exports and `render.d.ts`; tests can import `../web/render.js` directly. Arbitrary. Plain line: type-system plumbing exists only to export functions nobody calls.
- **B. App's package.json lists `@modelcontextprotocol/sdk` as a runtime dependency** but only `scripts/integrate.ts` and `test/compose.test.ts` import it (package.json:32). Make it a devDependency or remove with `integrate.ts`. Arbitrary.
- **C. The only test of the real composition is one case** (compose.test.ts:15-60), skipped when the corpus is absent (the corpus is committed, so it runs); the sidecar fallback and `CachedParser` are not tested (README:16). Evidence-resolvable (add a CachedParser fallback test with a stub parser). Plain line: the one place everything is wired together has a single end-to-end test.
- **D. Mermaid licence record** (vendor/README.md:11-12): the MIT licence is kept, but the README itself says third-party notices inside the bundle are not copied in full (the bundle contains several libraries). For a private repo the risk is low; settle it by deleting the bundle (F2) or copying the notice texts. Evidence-resolvable.
- **E. `McpServer` is used only to reach `.server`** (mcp/src/index.ts:35); the low-level `Server` class would do, since `registerTool` is deliberately bypassed (index.ts:5-8). Arbitrary; leave it, because the card signature names `McpServer`.

## Concepts in this area

| Concept | Status |
|---|---|
| One MCP connection = one agent session, opened on `initialized` | needed now |
| Tools = core `TOOLS` one to one; validation inside core, errors as `isError` | needed now |
| Loopback Host/Origin/content-type guards on the viewer | needed now (private log) |
| Timeline per session, polling by `after=seq`, notes side table | needed now |
| `itemInfo` injection (labels and chunk text) | needed now |
| Machine map (nodes, edges, logs) used for diagrams | needed later (loops, decomposition); today only feeds the diagram |
| Path overlay (visits, moves, next, stop, final) and run picker | only exists to serve the diagram |
| Vendored diagram library | unused by any v0 question |
| Composition root `compose` | needed now |
| Skeleton as test oracle | unused |
| Star dependency rule with testkit exception | needed now; its cost is F4 |
| Conformance suites plus broken fakes plus meta-tests | needed now for ports with several implementations (store, log); doubtful elsewhere |
| Golden vectors by independent Python oracle (ids.json, oracle.py) | needed now (cheap, caught real defects) |
| `@statelyai/inspect` rules | unused |

## Hand-rolled pieces

| Piece | Candidate | Verdict |
|---|---|---|
| MCP wiring (81 lines) | `@modelcontextprotocol/sdk` already used | already the dependency; keep |
| Viewer HTTP server (210 lines, node:http) | express/fastify | none: adds a concept for 7 routes; keep |
| Viewer HTML renderer (string templates) | lit-html or preact | not recommended: DOM building with textContent suffices (F5) |
| Diagram and overlay | mermaid (already) | F2: drop both rather than keep either |
| Ollama chat client (app/src/ollamaLlm.ts, 40 lines of fetch) | `ollama` npm client | none worth it; skeleton copy should be deleted |
| Mutation harness | StrykerJS | F9, conditional |
| Dependency boundary checks | dependency-cruiser (already) | keep, trim (F7) |
| JSON schema for tool inputs | zod's `toJSONSchema` (already) | in use |

## Surprises

- The root `src/`, `docs/` and `test/` (only `corpa`) directories contain nothing but the corpus; `src` and `docs` are empty.
- The viewer's per-machine diagram is exercised on real data almost only for `similarity@1`; ingest and eval runs are written by cheap-model cards and were never viewed on the real 13-node `document@1` outside the integration run.
- Testkit's README says "no vitest dependency", but package.json lists vitest as a runtime dependency (the conformance suites import it).
- The test run is not a friction source: all 16 packages pass in 17 s sequentially. The friction is in keeping suites, cards and fixtures consistent after each contract bump (F4), not in running them.
- The viewer security hardening (Host, Origin, CSP) came from a review, not the card; it is proportionate and should stay whatever happens to F2 and F5.
