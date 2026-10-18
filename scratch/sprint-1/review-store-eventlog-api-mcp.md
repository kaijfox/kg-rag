# Review: store, eventlog, api, mcp

Mechanical: all four packages pass `test` and `typecheck`; `pnpm depcruise` clean. No sprint/wave/WP markers in code except one README pointer (nit 5). Mutation runs were in a scratch copy (`scratchpad/rev-sam/repo`); the real repo was not touched.

## Findings

### Should-fix

1. **Multi-process appends silently lose events** (`eventlog/src/sqliteLog.ts:81,101,123`; also `store/src/db.ts` `Sql.transaction`). `db.transaction(fn)()` starts a deferred transaction: it reads `MAX(seq)`, then upgrades to a write lock. In WAL, if another process committed in between, the upgrade fails at once with `SQLITE_BUSY_SNAPSHOT`, and `busy_timeout` does not help. Probe: 4 processes x 300 appends to one session gave 57/104/59/300 successes. The rest threw raw `SqliteError` (not `KgError`). `UNIQUE(session_id, seq)` held, so there were no duplicate seqs, but events were lost. Applying `.immediate(...)` to `appendTx` and `openTx` in the copy gave 1200 of 1200 and distinct seqs. This matters once MCP, ingest CLI and eval run as separate processes on one file (the design's normal shape). Fix: use `.immediate` for the outermost transaction in eventlog and in `Sql.transaction` (store has the same read-then-write pattern, e.g. `putBuild`). Add a two-process test.
2. **Constructing a store or log needs the write lock** (`store/src/db.ts:35` `prepareSchema`, `sqliteLog.ts:67`). Every constructor runs the whole `schemaSql()` including `INSERT OR IGNORE INTO db_meta`. Probe: with a writer holding `BEGIN IMMEDIATE`, a second connection's `new SqliteCorpusStore` threw "database is locked" (after busy_timeout, 5 s by default). So a viewer or reader cannot start while ingest is mid-write, and a read-only handle can never be used. Fix: check `schema_version` first and run the schema only if absent. Consider `openDatabase(path, {readonly})` and have `SqliteEventLog` skip schema in read-only use. Needs a decision for the viewer wave; the lead may decide.
3. **`SqliteEventLog` sets no pragmas** (card says "WAL lets viewer read while MCP writes"). The card test opens `new Database(':memory:')`; app must use `openDatabase`. Nothing enforces it. Fix: document in the card that app must pass an `openDatabase` handle, or have the log constructor assert `journal_mode=wal` on file databases.
4. **Relation node order relies on rowid** (`sqlite-store.ts:286`). Without an `INTEGER PRIMARY KEY`, `VACUUM` may renumber rowids. Mutation `ORDER BY rowid DESC` survived: no test checks node order. See proposal P2.

### Nits

5. `store/README.md:35` points to `scratch/sprint-1/...`; remove (sprint marker in docs).
6. `putItems` with a duplicate node (same node and surface, different role) gives `conflict` from the PK, not `invalid_input` (`sqlite-store.ts:238`). Validate up front.
7. `eventlog/toEvent` hardcodes `schemaVersion: 1` and ignores the stored column. `events()` on an unknown session returns `[]`, not `not_found` (documented in README).
8. `mcp`: `opened ??= openAgentSession(...)` caches a rejected promise, so a failed `openSession` fails every later call on the connection. Reset `opened` on rejection. `scratch/notes/mcp.md` still describes the SDK-internal schema conversion; the code uses core's `toolInputJsonSchema`. The notes are stale.
9. `schema.sql` comments say vectors are "L2-normalized" and `build_id = buildId(manifest)`; the store stores vectors as given (cosine is scale-invariant) and the id includes item ids. Fix the comments in core.
10. `putEmbeddings` silently keeps the first vector when a different vector arrives for the same (space, item). This is the port's documented "first writer wins", but a differing vector is never reported. Not a defect; worth a log line later.

## Specific checks

- **Insert-only triggers**: all store tables except `documents` (UPDATE allowed; DELETE trigger) and `db_meta` have both triggers; tests cover UPDATE and DELETE on the main tables. Trigger aborts map to `immutable_violation`.
- **Fake vs SQLite cross-check**: real. `crosscheck.test.ts` loads the mini corpus into both stores and compares builds, items, staleness, spaces, and knn rankings on fixture queries and 300 random vectors (including zero-norm vectors), scores within 1e-5. Error codes are compared too. `knnFixtureSuite` is run (`knn-fixture.test.ts`).
- **S2 on SQLite**: enforced in `putBuild` (line 372) and killed by mutation (two mutants).
- **Atomicity**: nodes inserted by `putItems` roll back when a later item fails (probed). Removing the transaction wrapper is killed by tests.
- **Foreign keys**: `foreign_keys=1` and WAL confirmed on `openDatabase`. FK failures map to `not_found`. Eventlog tests use a raw `Database`, so FK there depends on the `PRAGMA` inside `schemaSql` (works, since it is executed at construction).
- **schema.sql ownership**: the store ran no DDL of its own; no divergence from core. `build_runs` and `summary_members` stay unwritten.
- **mcp**: runs against the real SDK 1.32.0 with a real `Client` over `InMemoryTransport`. I also ran a real stdio child-process roundtrip: the tool list has 8 tools and no `eval_run`; invalid input returns `isError` with `invalid_input: ...`; an unknown tool is a protocol error. The zod 4 trap is avoided by using core's JSON schema and bypassing `registerTool` (documented in the file header and notes). All calls go through `api[k]`; there is no logging or `append` code in mcp or api.
- **api**: handlers follow the card (Rule 6 build tagging killed 6 mutants). No `append` calls.

## Mutation results

| package | mutants | killed | survivors |
|---|---|---|---|
| store | 23 | 20 (2 survivors are equivalent) | node order `ORDER BY rowid DESC` (needs a node-order test); `putMappings` same-id run with different content not rejected (needs a conformance case); explicit source-chunk check (equivalent, FK catches it); `kinds.length===0` early return (equivalent) |
| eventlog | 16 (1 skipped) | 9 | `sessions` tie order by `session_id`; `since` boundary (`>=` vs `>`); `eventsBySearch` ordering; blank note rejected; `lastEventAt`; `notes` order; negative `limit` or `afterSeq`; `parentId` stored |
| api | 19 | 14 | `getItems` no-build `precondition`; `reportUsage` returned-items check (invalid_input path for usage untested); `snapshotBuild` never calling `labelBuild` (label not verified); `snapshotBuild` no-build `precondition`; search delegation mutant is equivalent |

Suggested tests belong in testkit conformance: eventLogConformance (tie-break, `since` boundary, blank note, negative limit, parentId round-trip, `lastEventAt`), kgApiConformance (usage with foreign item, label persisted via `getLabel`, `precondition` without a build), corpusStoreConformance (node order, mapping run conflict).

## Change proposals (store)

| # | Proposal | Recommendation | Who |
|---|---|---|---|
| P1 | Summary items have no storage (no `run_id`) | Defer. Keep `not_implemented`, but state it in the `putItems` port doc. When summaries land, add a `summary_runs` table to `schema.sql` with the usual triggers, and store `summary_members` in the same transaction. | Lead (summaries are already outside v0 scope; no rule change) |
| P2 | Relation node order has no stored ordinal | Adopt. Add `position INTEGER NOT NULL` to `relation_nodes` (PK stays), read `ORDER BY position`, and add the missing conformance test. Node order is meaning (subject, object), so rowid is too fragile. | Lead (core schema, no concept change) |
