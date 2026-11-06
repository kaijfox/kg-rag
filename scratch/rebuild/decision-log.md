# Rebuild decision log

Written while rebuilding the repository around the proposal in `scratch/proposal-report.html` (the "flexible GraphRAG
on a small engine" report). The user approved working without a sprint document and asked that decisions be logged
here. Each entry: what was decided, why, and what it replaces. Entries are in the order made.

Standing constraints taken from the working preferences: `design/` is not edited (proposed amendments go to
`proposed-amendments.md` in this folder); local Ollama for every model call; cheap options first; plain words in
documents that outlive the work (no sprint markers in READMEs or code comments).

## Plan

1. Commit the old state (done: commit 04f2913), then replace the 17 packages with four: `kernel`, `modules`, `eval`,
   `app` (plus the Python `parse-sidecar`, unchanged).
2. `kernel` holds what every use case shares: IDs, the three SQLite stores (index, history, cache), the module and
   state-machine types with the load-time check, the runner, and the model and embedding interfaces.
3. `modules` holds the things a use case swaps: chunker, parser adapters, ingest and search modules, fact extraction,
   the "replaces" rule, the machines that wire them, and `rebuild`.
4. `eval` keeps the question generator, answerer, judge and metrics, as plain functions over the kernel.
5. `app` holds the `kg` command line, the MCP server and the session viewer.

## Decisions

**D1. Four packages instead of seventeen.** The reviews found that package boundaries followed our implementation
(parse, chunk, embed, store) and not what varies between use cases. The seams that matter are now module kinds, not
packages. Replaces: api, chunk, core, embed, eventlog, ingest, mcp, parse, pipeline, search, sqlite, store, testkit,
viewer. The import rule shrinks to: kernel imports nothing in `packages/`; modules imports kernel; eval imports kernel
and modules; app imports all three.

**D2. Own state-machine runner, no XState.** A machine is plain data: states, each naming a module and a next state or
a guarded route. The runner checks at load that every module exists and every slot a state needs is provided by the
start or added by a state on every path to it (a small data-flow check), and logs each step. XState cost 258 lines of
toolkit, a topology fingerprint that moved every saved index when a label changed, and a 5.5 MB diagram library for the
viewer. The machines are still explicit, nameable and drawable from their plain data. Loops are a route back to an
earlier state. Replaces: `@kg/pipeline`, xstate, the pinned topology files.

**D3. A database is a directory.** `kg.json` (configuration and the source list), `index.sqlite` (rebuildable),
`history.sqlite` (durable: event log, feedback, evaluation results, confirmed corrections), `cache.sqlite` (optional:
model responses), `artifacts/` (parsed documents, kept). `rebuild` writes `index.<id>.sqlite.tmp`, then renames it over
`index.sqlite`; the old file is deleted unless `--keep-old`. Replaces: one file holding everything, builds, snapshots.

**D4. Chunk IDs and the chunker are unchanged.** The 63 pinned evaluation questions cite chunk IDs, so the ID formula
and the section-pack chunker move over untouched. A test checks that re-chunking the real artifacts gives the IDs that
the pinned evaluation sets name.

**D5. Derived items are `facts` and `summaries`, one table.** ID = hash of kind, the module name and version, the
sorted source chunk IDs and the normalised text. Text is in the hash because models give different sentences for the
same input and a new sentence must be a new record. A derived item with no source chunk is refused by the store
(inside the commit, so a failed module leaves nothing behind).

**D6. Mentions are a plain table; names are normalised strings.** No node table. `normName` from the first build is
reused.

**D7. Links have two kinds, `replaces` and `alias-of`.** `refines` is left out: it was motivated only by the concept
framework demand, which is deferred. A link records the module that made it. `replaces` runs from the newer record to
the older one. Confirmed corrections (aliases a person approved) live in the history and are replayed by rebuild.

**D8. Facts come from one extraction call per chunk.** The model returns `{"facts": [{"text", "names"}]}`. A fact must
be a standalone sentence; the module rejects empty text, empty names and text copied verbatim from the chunk beyond a
length (nothing is dropped silently: rejected drafts are logged with a reason). The first build's pilot found a second
"anything missed" pass raises coverage; it is a setting, off by default, because it doubles cost.

**D9. Vector search is brute force through sqlite-vec's `vec_distance_cosine`.** Same as the first build. Revisit when a
measurement says so.

**D10. Evaluation is plain functions.** The eval-set JSON format and the prompt files are unchanged, so the pinned
sets keep working. The five XState machines (run, question, generate, judge, retry) become async functions with the
same retry-with-corrective-instruction behaviour for malformed judge replies.

**D11. Formula decoding leaves the core.** The default parse recipe never used it. The `[formula]` placeholder view of
a chunk (used in embeddings) stays, because the baseline's embeddings depend on it.
