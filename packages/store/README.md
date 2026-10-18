# @kg/store

SQLite implementation of the core `CorpusStore` and `EvalRepo` ports, plus `openDatabase`.

- `openDatabase(path)` opens one file (WAL, foreign keys on, sqlite-vec loaded). Use `':memory:'` in tests.
- `new SqliteCorpusStore(db, clock)` and `new SqliteEvalRepo(db)` apply the shared schema text on construction only
  when `db_meta` lacks the current `schema_version`, so opening a file that already has the schema (a viewer, a
  reader) takes no write lock.
- Every store transaction is `BEGIN IMMEDIATE` (nested calls are savepoints), so processes sharing the file queue on
  the write lock. A lock held past `busy_timeout` (5 s) raises `KgError('upstream')`.
- Vectors are float32 little-endian BLOBs, searched by brute force with `vec_distance_cosine`. Score is `1 - distance`;
  a zero-norm vector scores 0; ties go by item id ascending.

## Tests

`pnpm --filter @kg/store test`: conformance suites for both ports, the mini-corpus knn fixture, insert-only trigger
tests, build identity against core's `buildId`, a cross-check against the testkit in-memory fake (same operations,
same error codes, same rankings within float32 tolerance), file reopen, and a latency report.

## Latency (not asserted)

20,000 vectors x 384 dims, one build, knn limit 10, this machine (arm64, Node 22.17, SQLite 3.50.4 bundled with
better-sqlite3 12.4.1): median 35 to 38 ms, p95 39 to 42 ms over 30 random queries (three runs).
Populating the 20,000 chunks, their embeddings and the build took about 0.6 s.

## Assumptions

- The embedding BLOB is written with explicit little-endian `writeFloatLE`, so it does not depend on the host byte order.
- Relation node order is kept by `relation_nodes` rowid (read `ORDER BY rowid`), because the shared schema has no ordinal
  column. SQLite does not promise that VACUUM keeps rowids of such a table; the copy is made in rowid order, so the
  relative order survives in practice (a test vacuums and re-reads). An explicit `position` column is deferred.
- A relation that lists the same node with the same surface twice is `invalid_input` (the table's key would make it a `conflict`).
- Item IDs are ASCII (`ch_`, `rl_`, ...), so SQLite's byte order and JavaScript's code-unit order agree for tie-breaks.
- Insert-only triggers raise messages that the error mapper turns into `immutable_violation`; constraint errors map to
  `not_found` (foreign key), `conflict` (primary or unique key) and `invalid_input` (check, not-null).
- `putBuild` of an existing build returns its id before any other check, as the port and the fake both do.
- The eval repo's constructor also applies the shared schema, so it can be used on a fresh handle.

## Known gaps

- Summary items are rejected with `not_implemented`: the shared schema has no column for a summary's run id.
- Scores are float32 in SQLite and float64 in the fake; they agree within about 1e-6, and rankings can differ only inside
  groups of near-equal scores.
- Single connection per store; no async API (the port is synchronous by decision).
- `knn` reads the whole build's candidate set through a join; there is no ANN index (brute force by decision).
