# @kg/sqlite

The SQLite layer shared by `@kg/store` and `@kg/eventlog`. It exists so that opening, configuring and migrating a
database file is written once.

- `openDatabase(path)`: opens a file (WAL, foreign keys on, 5 s busy timeout, sqlite-vec loaded) and migrates it.
  Use `':memory:'` in tests.
- `prepare(db)`: the same configuration and migration for a handle opened elsewhere. Both store and eventlog call it
  on construction, so either can be the first to touch a file.
- `migrate(db)`: applies `MIGRATIONS` from the file's `PRAGMA user_version` to `SCHEMA_VERSION`, in one immediate
  transaction. A file already at the current version is only read, so opening it for reading takes no write lock. A
  file at a newer version is refused with `precondition`.
- `guard(fn)`: maps SQLite errors to `KgError` codes (busy to `upstream`, insert-only triggers to
  `immutable_violation`, constraints to `not_found`, `conflict` or `invalid_input`).
- `Sql`: a prepared-statement cache with typed row helpers and `transaction` (BEGIN IMMEDIATE).

## Schema versions

The schema text is `packages/core/src/schema.sql`. Migration 1 is that text. The version lives only in
`PRAGMA user_version`; there is no version row in `db_meta`. To change the schema, append a migration to
`MIGRATIONS` and never edit an earlier one. Files written before this list existed have version 0 and run migration 1,
which is idempotent, so they upgrade in place.

## Tests

`pnpm --filter @kg/sqlite test`: a new file reaches the current version; a version-0 file with rows upgrades and keeps
them; a newer file is refused and left as it was; migrating a current file changes nothing.
