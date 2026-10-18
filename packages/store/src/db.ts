/**
 * SQLite connection helpers shared by the corpus store and the eval repo: opening a file, loading the vector
 * extension, applying the shared schema, mapping SQLite errors to KgError codes, and a small prepared-statement cache.
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KgError, SCHEMA_VERSION, schemaSql } from '@kg/core';

export type Db = Database.Database;
export type SqlValue = string | number | bigint | Buffer | null;
export type Row = Record<string, unknown>;

/** How long a connection waits for another writer's lock before the call fails with an `upstream` error. */
export const BUSY_TIMEOUT_MS = 5000;

/** Opens one database file with WAL, foreign keys on and sqlite-vec loaded. Use ':memory:' for tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  loadVec(db);
  return db;
}

/** Loads sqlite-vec unless this connection already has it. */
export function loadVec(db: Db): void {
  try {
    db.prepare('SELECT vec_version()').get();
  } catch {
    sqliteVec.load(db);
  }
}

/**
 * Loads the vector extension and applies the shared schema text (idempotent; the eventlog runs it too). When the
 * file already carries the current schema version nothing is written, so opening for reading never needs the write lock.
 */
export function prepareSchema(db: Db): void {
  loadVec(db);
  if (guard(() => schemaCurrent(db))) {
    db.pragma('foreign_keys = ON');
    return;
  }
  guard(() => db.exec(schemaSql()));
}

/** True when db_meta exists and holds this build's schema version. Reads only. */
export function schemaCurrent(db: Db): boolean {
  const meta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'db_meta'").get();
  if (!meta) return false;
  const row = db.prepare("SELECT value FROM db_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row?.value === String(SCHEMA_VERSION);
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

/** Float32 little-endian, the vector BLOB format (explicit byte order, independent of the host). */
export function encodeVector(v: Float32Array): Buffer {
  const out = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) out.writeFloatLE(v[i]!, i * 4);
  return out;
}

export const invalid = (msg: string): KgError => new KgError('invalid_input', msg);
export const notFound = (msg: string): KgError => new KgError('not_found', msg);
