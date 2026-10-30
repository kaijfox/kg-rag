# log: recorded event streams (JSONL, one EventEnvelope per line)

Re-recorded once for contract 0.2.0 (RankedRef.queryId, eval.run.started.buildId, nested parentId).

Contract 0.6.0: every whole search gets `pipeline.started` (pipeline `search`, machine `similarity`, topology
`69bc55d30db24c90`, right after `query`) and `pipeline.finished` (status `done`, state `done`, right after the last
`search.step` and before `search.result`), inserted by hand with the same ids and buildId as its search. Lines were
inserted, so `seq` was renumbered after each insertion; no other field changed. The second search of
`session-live-partial` is cut off before its end, so it has no `pipeline.finished` and is left as it was. The ingest
runs in `session-agent` are not bracketed by `pipeline.started`/`pipeline.finished`: only searches were added.

Originally recorded from a deterministic skeleton run (FixedClock start 2026-10-17T12:00:00Z step 250 ms, SeqIds,
HashEmbedder(4096), mini-corpus v1 artifacts). The recorder and the skeleton were removed in sprint 3, so these files are
hand-maintained. They are inputs for viewer and analysis tests; nothing regenerates or asserts them byte for byte.

- `session-agent.jsonl` (57 events): seq 2-14 ingest of both documents (started/parsed/chunked/embedded per
  document, completed x2, build.created); three searches, each tool.called, query, pipeline.started, search.step x2
  (vector-knn, truncate), pipeline.finished, search.result, tool.returned: "Boltzmann formula tombstone microstates"
  (15-22), "der Waals" (26-33), "Avogadro" (37-44, a corpus gap: every score is 0); per-item feedback on search 1
  (24, relevance 2 and 1), overall feedback on searches 2 and 3 (35, 46); feedback on an unknown search
  (48-49, tool.failed not_found); usage (51); outcome (54); add_note (56-57, the note itself is in the
  session_notes side table, not an event).
- `session-eval.jsonl` (25 events): one `eval_run` tool call (2 ... 25) containing eval.run.started, two
  nested KgApi.search calls (4-11, 14-21), one llm.called per question (12, 22), eval.question.scored per
  question (13, 23) and eval.run.completed (24). The nested search tool.called events (4, 14) have parentId = the
  eval_run tool.called (seq 2): runTool links nested calls of the same session (contract 0.2.0, R-27).
  eval.run.started carries the pinned buildId in its payload (R-29).
  Contract 0.6.1: it also carries `judge` ({recipeId, model}) and `answerer` ({model, promptDigest}); the values are
  the testkit's reference ones (`REFERENCE_JUDGE`, `REFERENCE_ANSWERER` in src/fixtures.ts).
- `session-live-partial.jsonl` (13 events): an agent session cut off after the first search.step of its
  second search (pipeline.started at seq 12; no search.result, no tool.returned, no pipeline.finished): what a viewer polling a live session sees.
  Its first search (2-9) is whole and bracketed (4-7).
