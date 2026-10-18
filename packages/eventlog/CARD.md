# @kg/eventlog (WP6, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else.

## Implements
`class SqliteEventLog implements EventLog, LogReader` (core `ports/log.ts`), constructor
`(db: Database /* better-sqlite3 handle opened by app or store's openDatabase */, clock: Clock, ids: IdGen)`.
Runs `schemaSql()` on construction (idempotent). Owns the L tables: `sessions`, `events`, `session_notes`.

## package.json to create
dependencies `@kg/core: workspace:*`, `better-sqlite3`; devDependencies `@kg/testkit: workspace:*`,
`@types/better-sqlite3`.

## Tests you must pass
`test/conformance.test.ts`, exactly:
```ts
import Database from 'better-sqlite3';
import { eventLogConformance, registerSuite } from '@kg/testkit/conformance';
import { FixedClock, SeqIds } from '@kg/testkit';
import { SqliteEventLog } from '../src/index';
registerSuite(eventLogConformance(() => new SqliteEventLog(new Database(':memory:'), new FixedClock(), new SeqIds())));
```
plus: an UPDATE or DELETE on `events` raises (trigger), and loading `testkit/fixtures/log/*.jsonl` by
re-appending every non-session.started event into a fresh session reproduces the same types in order.
Command: `pnpm --filter @kg/eventlog test`.

## Rules
- `append`: `validateEventDraft(draft)` from core (it throws `invalid_event`, including for
  session.started), then in one transaction read `MAX(seq)` for the session (absent session -> `not_found`)
  and insert with `seq + 1`, `id = ids.ulid('ev_')`, `ts = clock.now()`, `schema_version = 1`, payload as
  JSON. Return the envelope exactly as stored.
- `openSession` inserts the `sessions` row and a `session.started` event (seq 1, all ids null except session).
- Readers return fresh objects; `sessions()` orders by `started_at DESC, session_id DESC`, default limit 100;
  `events()` default limit 1000.
- `addNote` writes `session_notes` only; never an event.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). Never touch store tables.

## Decisions already made
Append-only log enforced by triggers; one log per database file shared with the store; the viewer reads
through `LogReader` (WAL mode lets it read while MCP writes).

## Open questions (note, do not decide)
- Cross-session ordering for a live "all sessions" view (ULID event ids sort by time) is not in the port.
