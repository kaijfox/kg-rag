# Integration report: real composition on the stat-mech corpus

## What ran
`packages/app/src/compose.ts` wires SQLite store, event log and eval repo (one file, `scratch/integration/stat-mech.kg.sqlite`, git-ignored), `ArtifactDirParser` over the cached artifacts (sidecar not needed, not run), section-pack chunker with chunk view, Ollama embeddinggemma (digest pinned), ingest, search, `createApi`, the MCP server, the viewer and the eval runner. `pnpm depcruise` passes. `scripts/integrate.ts` ran four stages on real Ollama; `test/compose.test.ts` repeats ingest, re-ingest, search, MCP client and rule checks offline (hash embedder, in-memory database). App suite 119 tests pass.

## Numbers
- Parse from cache: 5 to 8 ms per document; identify 1 to 4 ms; chunking 2 to 15 ms. 312 chunks (147, 50, 76, 39), length 94 to 1500, mean 797, 3 under 200.
- First ingest 8.0 s, of which embedding 7.85 s (25 ms per chunk, batches of 32). Re-ingest 60 ms: same build `bd_47kbfvjc...`, `buildChanged:false`, all `embedded:0, skipped:n`.
- Search (11 queries, k=5): median 29 ms, range 21 to 76 ms (the first includes the digest check).
- Eval: generation 46 s per run (8 or 10 groups, qwen3.5, single-hop). Answer 6.2 s and judge 3.3 s per call. Run A: 6 questions x 2 conditions, 114 s (19 s per question). Run B: 6 questions x 3 conditions, 173 s (29 s per question). Total LLM time about 8 minutes. Questions were fewer than asked because generation kept 6 of 8 and 6 of 10 groups.
- Database 3.3 MB; the log is most of it.

## Behaviour
Queries behaved well. Exact terms: "Clausius inequality" 5 of top 5 chunks contain the term (11 in corpus); "Maxwell relations" 4 of 5; "Gibbs-Duhem" 3 of top 5 by text, the others are under that heading. Paraphrases (gas into vacuum, most efficient engine) put Joule-expansion and Carnot sections on top. Eval: retrieved judge mean 1.0 (recall@1 0.83 and @5 1.0 on run A), gold 0.92, no-context 0.75. The judge is unvalidated, scored 1.0 on a gold answer that began "Based on my own knowledge", and questions are answerable without context, so these means show the pipeline runs, not quality.
MCP SDK client (in-memory): 8 tools, no `eval_run`; search, feedback ok; empty query and unknown search return `isError` with codes.

## What the log can and cannot diagnose
Successful search: `query` (text, k, recipe), `pipeline.started` (machine, topology), one `search.step` per state with params, all 100 considered candidates with scores, ranks and `queryId`, `search.result` with source chunks, build id on every event. This explains why an item was returned and what ranked just below. Cannot tell: which embedder served the query (derivable through the build), the conditioned query text.
Failing searches: invalid input and unknown build are visible as `tool.failed` with a code. For an embedder outage inside the machine, `pipeline.finished` has `state:"failed"` (the final state), so the log shows the error text but not that `retrieve` was the state that threw (inferred from a missing `search.step`). `eventsBySearch` does not return `tool.failed`. Eval generation is not logged at all and drops drafts silently; eval LLM calls log hashes and tokens, not text (answers are in `eval_results`).
Size: about 28 KB of events per search (100 candidates written by both steps). Design feedback entry added.

## Rule audit (SQL on the real database)
- Rule 1: 0 items without `item_sources`; 0 sources naming a missing chunk.
- Rule 4: 0 non-chunk items without recipe (none exist); chunks carry parse and chunk recipe via the document version.
- Rule 5: build has 312 items, current ingest 312, 0 stale.
- Rule 6: every search, step and result event has a build (0 null); the feedback event has the build of its search (checked by join). Null builds only on events before the first build existed (first ingest, 1 `tool.called`, 1 `pipeline.started`, 4 ingest events), which is correct. No `tool.called` without a returned or failed event.
- All 312 chunks have an embedding; no duplicate chunk text.

## Viewer (real Chrome)
Finished session: timeline, diagram overlay with counts, item click showing chunk text, notes (POST then listed) all work. Live: three searches fired against an open page appeared within about 2 s (25 events), and a running eval session showed up in the list. Problems: the session list reorders as sessions update, so clicks mis-target (twice); URL hash change on an open page does not switch session; the run picker does not follow the newest run; the item panel stays over the timeline and across sessions; a failed run shows every node grey, no stop mark (see defect 1). No console errors read.

## Defects (details in `change-proposals/integration.md`)
1. Medium: `pipeline.finished` loses the failing state (pipeline/run.ts:50-61).
2. Medium: question generation drops 25 to 40 percent of groups with no log or reason (eval).
3. Low to medium: viewer list reordering under live updates; other viewer items.
4. Low: viewer ships undeclared JS (consumers need `allowJs`); MCP `search` requires `k`; judge leniency and passage-dependent questions (eval review items).

## What the unit suites missed
Typecheck of the viewer from another package; the viewer's behaviour with live updates in a real browser; the failure state in the log from a real outage; log size at real scale; silent loss in question generation. Concurrent processes (eval run, viewer, MCP client, live searches) shared one WAL file with no lock errors.

Not done: sidecar fallback (cache covered everything), no-context-only judge validation, formula decoding.
