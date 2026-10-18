# log: recorded event streams (JSONL, one EventEnvelope per line)

Re-recorded once for contract 0.2.0 (RankedRef.queryId, eval.run.started.buildId, nested parentId).

Recorded by `packages/app/scripts/record-log-fixtures.ts` from a deterministic skeleton run (FixedClock
start 2026-10-17T12:00:00Z step 250 ms, SeqIds, HashEmbedder(4096), mini-corpus v1 artifacts). They are
inputs for viewer and analysis tests; nothing asserts that a later run reproduces them byte for byte.

- `session-agent.jsonl` (51 events): seq 2-14 ingest of both documents (started/parsed/chunked/embedded per
  document, completed x2, build.created); three searches, each tool.called, query, search.step x2
  (vector-knn, truncate), search.result, tool.returned: "Boltzmann formula tombstone microstates" (15-20),
  "der Waals" (24-29), "Avogadro" (33-38, a corpus gap: every score is 0); per-item feedback on search 1
  (22, relevance 2 and 1), overall feedback on searches 2 and 3 (31, 40); feedback on an unknown search
  (42-43, tool.failed not_found); usage (45); outcome (48); add_note (50-51, the note itself is in the
  session_notes side table, not an event).
- `session-eval.jsonl` (21 events): one `eval_run` tool call (2 ... 21) containing eval.run.started, two
  nested KgApi.search calls (4-9, 12-17), one llm.called per question (10, 18), eval.question.scored per
  question (11, 19) and eval.run.completed (20). The nested search tool.called events (4, 12) have parentId = the
  eval_run tool.called (seq 2): runTool links nested calls of the same session (contract 0.2.0, R-27).
  eval.run.started carries the pinned buildId in its payload (R-29).
- `session-live-partial.jsonl` (10 events): an agent session cut off after the first search.step of its
  second search (no search.result, no tool.returned): what a viewer polling a live session sees.
