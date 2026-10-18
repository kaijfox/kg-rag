# @kg/store (WP5, Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.

## Implements
- `class SqliteCorpusStore implements CorpusStore` (core `ports/store.ts`), constructor
  `(db: Database /* better-sqlite3, opened by app */, clock: Clock)`. Runs `schemaSql()` on construction
  (idempotent) and loads sqlite-vec.
- `class SqliteEvalRepo implements EvalRepo` over the same handle.
- `openDatabase(path: string): Database` helper (WAL mode, `foreign_keys=ON`, sqlite-vec loaded). `app`
  opens one file per database and passes the same handle to `store` and `eventlog`.

## package.json to create
dependencies: `@kg/core: workspace:*`, `better-sqlite3`, `sqlite-vec` (pin exact versions; Phase 0 verified
SQLite 3.53.x + vec 0.1.9 on Node 22 arm64); devDependencies: `@kg/testkit: workspace:*`,
`@types/better-sqlite3`. Add `better-sqlite3` to the root `pnpm-workspace.yaml` `onlyBuiltDependencies` (already there).

## Tests you must pass
`test/conformance.test.ts`, exactly:
```ts
import { corpusStoreConformance, evalRepoConformance, registerSuite } from '@kg/testkit/conformance';
import { openDatabase, SqliteCorpusStore, SqliteEvalRepo } from '../src/index';
import { FixedClock } from '@kg/testkit';
registerSuite(corpusStoreConformance(() => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock())));
registerSuite(evalRepoConformance(() => new SqliteEvalRepo(openDatabase(':memory:'))));
```
and the mini-corpus knn fixture on SQLite:
```ts
import { knnFixtureSuite } from '@kg/testkit/conformance';
registerSuite(knnFixtureSuite(() => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock())));
```
plus your own trigger tests (an UPDATE on `items` raises). A latency measurement (20,000 x 384 vectors) goes
in your README as a number, not an assertion. Command: `pnpm --filter @kg/store test`.

## Fixtures you may read
none required; `loadMiniCorpus(new SqliteCorpusStore(...))` from testkit is a good extra smoke test.

## Forbidden imports
Any `@kg/*` other than `@kg/core` (and `@kg/testkit` in tests). You own the S tables of `schema.sql`; never
write `sessions`, `events`, `session_notes` (eventlog owns them).

## Decisions already made
- One SQLite file per database; embeddings in a plain table, brute-force `vec_distance_cosine` (no vec0
  virtual tables). Score = `1 - vec_distance_cosine` (core `scoring.ts`); order `score DESC, item_id ASC`.
- Vectors stored as little-endian float32 BLOBs (`Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)`).
- knn restricted by `JOIN build_items ON build_id = ?` and `items.kind IN (...)`.
- `putBuild`: id = `buildId(manifest, itemIds)` (R-23); refuse with `precondition` if any item lacks a vector in
  any manifest space (S2, R-24).
- Insert-only everywhere except `documents.current_version` and `db_meta.current_build`; triggers enforce
  it. Map trigger aborts and constraint errors to `KgError` with the codes in the port doc
  (`immutable_violation`, `not_found`, `invalid_input`, `conflict`).
- `putItems` compares content as canonical JSON (core `canonicalJson`) before deciding no-op vs violation.
- A reused chunk keeps its first-seen text and provenance in `chunks`; per-version pages and block refs go
  to `doc_version_chunks` (contract-revisions R-03).
- Build names are insert-only rows in `build_labels` (R-04). `putBuild` is idempotent on the manifest hash.
- Parse artifacts stored gzipped (`zlib.gzipSync` of the envelope JSON) in `parse_artifacts.body`.
- `transaction(fn)`: `db.transaction(fn)()`; nested calls join (better-sqlite3 uses savepoints; fine).

## Open questions (note, do not decide)
- Float32 storage vs the in-memory fake's float64 arithmetic: scores differ in the 7th digit, so near-ties
  can order differently than the fake. The conformance suite only relies on exact ties.
- Rule 5 for summaries (member staleness) is a later extension of `staleCheck`.
- A remote store would need async ports (accepted signature change, decision D9).
