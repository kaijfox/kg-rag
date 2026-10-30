/**
 * The SQLite layer shared by the corpus store, the eval repo and the event log: opening a file (WAL, foreign keys,
 * busy timeout, sqlite-vec), the migrations that create the schema, mapping SQLite errors to KgError codes, and a
 * small prepared-statement cache.
 *
 * Schema versioning uses PRAGMA user_version: MIGRATIONS[i] brings a file from version i to i + 1, and the list is
 * append-only. A file written before the list existed has user_version 0 and runs migration 1, which is idempotent
 * (every statement in schema.sql is IF NOT EXISTS), so it upgrades in place.
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KgError, schemaSql } from '@kg/core';

export type Db = Database.Database;
export type SqlValue = string | number | bigint | Buffer | null;
export type Row = Record<string, unknown>;
export type Statement = Database.Statement;

/** How long a connection waits for another writer's lock before the call fails with an `upstream` error. */
export const BUSY_TIMEOUT_MS = 5000;

type Migration = (db: Db) => void;

const MIGRATIONS: readonly Migration[] = [
  (db) => db.exec(schemaSql()), // 1: the v0 schema (schema.sql)
];

/** The schema version this build writes. Stored only in PRAGMA user_version. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Opens one database file, configured and migrated. Use ':memory:' for tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  prepare(db);
  return db;
}

/** Sets the connection pragmas, loads sqlite-vec and brings the file to SCHEMA_VERSION. Idempotent. */
export function prepare(db: Db): void {
  guard(() => {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    loadVec(db);
    migrate(db);
  });
}

/** Brings the file to SCHEMA_VERSION in one immediate transaction. A file already current is only read. */
export function migrate(db: Db): void {
  const from = db.pragma('user_version', { simple: true }) as number;
  if (from === SCHEMA_VERSION) return;
  if (from > SCHEMA_VERSION) {
    throw new KgError('precondition', `database schema version ${from} is newer than this build (${SCHEMA_VERSION})`);
  }
  db.transaction(() => {
    for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v]!(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }).immediate();
}

/** Loads sqlite-vec unless this connection already has it. */
export function loadVec(db: Db): void {
  try {
    db.prepare('SELECT vec_version()').get();
  } catch {
    sqliteVec.load(db);
  }
}

/** Runs fn and converts SQLite errors into KgError codes; other errors pass through unchanged. */
export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw mapSqlError(e);
  }
}

function mapSqlError(e: unknown): unknown {
  if (!(e instanceof Database.SqliteError)) return e;
  // another connection holds the write lock past busy_timeout; the caller may retry
  if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED' || e.code.startsWith('SQLITE_BUSY_') || e.code.startsWith('SQLITE_LOCKED_')) {
    return new KgError('upstream', `database is busy: ${e.message}`);
  }
  // triggers raise these messages for UPDATE and DELETE on insert-only tables
  if (/insert-only|append-only|never deleted/.test(e.message)) return new KgError('immutable_violation', e.message);
  switch (e.code) {
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
      return new KgError('not_found', e.message);
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
    case 'SQLITE_CONSTRAINT_UNIQUE':
      return new KgError('conflict', e.message);
    case 'SQLITE_CONSTRAINT_CHECK':
    case 'SQLITE_CONSTRAINT_NOTNULL':
    case 'SQLITE_CONSTRAINT_DATATYPE':
      return new KgError('invalid_input', e.message);
    default:
      return e;
  }
}

/** Prepared-statement cache plus typed row helpers. */
export class Sql {
  private readonly cache = new Map<string, Database.Statement>();
  constructor(readonly db: Db) {}

  private stmt(sql: string): Database.Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  get<T extends Row = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }
  all<T extends Row = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SqlValue[]): void {
    this.stmt(sql).run(...params);
  }
  /**
   * Takes the write lock up front (BEGIN IMMEDIATE), so a read-then-write sequence cannot lose a race with another
   * process. Nested calls become savepoints, so an inner throw undoes only the inner work.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}
