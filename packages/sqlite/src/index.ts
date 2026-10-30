/**
 * @kg/sqlite: the SQLite layer shared by store and eventlog. Opening and configuring a file, schema migrations
 * (PRAGMA user_version), SQLite error mapping and the statement helper. See README.md.
 */
export { BUSY_TIMEOUT_MS, SCHEMA_VERSION, Sql, guard, loadVec, migrate, openDatabase, prepare, type Db, type Row, type SqlValue, type Statement } from './db';
