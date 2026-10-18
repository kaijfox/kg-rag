# @kg/eventlog: implementation notes (WP6)

## What was done
- `packages/eventlog/src/sqliteLog.ts`: `SqliteEventLog` implements `EventLog` and `LogReader` over the core
  `schema.sql` tables (`sessions`, `events`, `session_notes`). Constructor runs `schemaSql()`.
- `packages/eventlog/src/index.ts` re-exports the class.
- `packages/eventlog/test/conformance.test.ts`: exactly the text from the card.
- `packages/eventlog/test/log.test.ts`: trigger check and fixture replay (one test per fixture file).
- `packages/eventlog/README.md`: behaviour, assumptions, gaps.
- package.json and tsconfig.json were left as they were (they already matched the card).

## Results
- `pnpm --filter @kg/eventlog test`: 2 files, 14 tests, all passing (exit 0).
- `pnpm --filter @kg/eventlog typecheck`: exit 0.

## Assumptions
- Session `started_at` and the `session.started` event timestamp both come from one clock read (same as the
  in-memory fake in testkit).
- Append re-reads the stored row to build the return value, so the return value equals the stored envelope.
- Transactions use better-sqlite3's `db.transaction(...).immediate`; a KgError thrown inside rolls back the seq read and insert.

## Surprises and things to flag
- The card's `eventsBySearch` wording ("in seq order") does not say what to do across sessions. I order by seq then
  session id. Not a contract break, but the port could say "seq order within each session".
- The port's `EventLog.append` doc says nothing about blank notes; testkit's fake rejects them with
  `invalid_input`, so I did the same.
- The constructor sets WAL, foreign keys and busy_timeout itself and skips the schema DDL when `schema_version` is current,
  so a reader never needs the write lock. Lock timeouts become `KgError('upstream')` (no dedicated code exists).
- Fixture replay passes for all three files without any change to fixtures or core.

## Would flag
- Nothing in the contract looked wrong enough for a change proposal, so no file under
  `scratch/sprint-1/change-proposals/` was written.
