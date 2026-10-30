# @kg/eventlog

SQLite implementation of the core event log ports: `SqliteEventLog` implements `EventLog` (writes) and
`LogReader` (reads). It owns the `sessions`, `events` and `session_notes` tables. Its constructor calls `@kg/sqlite`'s
`prepare` (pragmas, sqlite-vec, migrations), so it can share one database file with `@kg/store`.

Usage: `new SqliteEventLog(db, clock, ids)` with a handle from `@kg/sqlite`'s `openDatabase`.

## Behaviour

- `openSession` writes the `sessions` row and a `session.started` event (seq 1, all envelope ids null) in one transaction.
- `append` validates the draft with core's `validateEventDraft`, then in one transaction checks the session exists
  (`not_found` otherwise), reads `MAX(seq)`, and inserts with seq + 1, a fresh `ev_` id, the clock timestamp and
  schema version 1. It returns the envelope re-read from the table, so the return value is what is stored.
- `events` and `eventsBySearch` return fresh objects; payloads are parsed from JSON on every read.
- `sessions` orders by `started_at` descending, then `session_id` descending; default limit 100.
- `addNote` writes `session_notes` only and never an event.
- Append-only rules come from the triggers in core's `schema.sql` (UPDATE or DELETE on `events` raises).

## Assumptions and known gaps

- The constructor calls `@kg/sqlite`'s `prepare`: WAL, `foreign_keys = ON`, `busy_timeout` (5 s), and migrations up to
  the current `user_version`. A file already at the current version is only read, so opening it takes no write lock.
- `openSession` and `append` use `BEGIN IMMEDIATE`: processes sharing one file queue on the write lock instead of
  failing with a stale snapshot, so no append is lost and seqs stay unique and contiguous. A lock held past the
  timeout raises `KgError('upstream')` (no `unavailable` code exists), never a raw SQLite error.
- `eventsBySearch` orders by `seq`, then `session_id`. The port says "in seq order" but a search can, in principle,
  span sessions, so the cross-session order is a tie-break and not a meaningful timeline.
- `addNote` rejects blank text with `invalid_input`; the port does not state this case.
- `events` and `notes` on an unknown session return an empty list rather than `not_found`; only `append` and
  `addNote` require the session to exist.
- Negative or non-integer `limit` and `afterSeq` values raise `invalid_input`.
- No cross-session ordering for a live "all sessions" view beyond `sessions()`; this is an open question in the card.
- Stored payloads are not re-validated on read (only on append).

## Tests

- `test/conformance.test.ts`: core's `eventLogConformance` suite on an in-memory database.
- `test/concurrency.test.ts`: four child processes appending to one session (all appends kept, seqs contiguous), open
  while another connection holds a write transaction, busy mapping, pragmas.
- `test/reader.test.ts`: session ordering and `since`, `lastEventAt`, paging bounds, `parentId`, search order, notes.
- `test/log.test.ts`: UPDATE and DELETE on `events` raise; each `testkit/fixtures/log/*.jsonl` file, re-appended
  without its `session.started` line, reproduces the same event types in order.
