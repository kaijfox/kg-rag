/**
 * Opening SQLite files: WAL, foreign keys, a busy timeout, sqlite-vec for vector distance, and an append-only list of
 * migrations keyed by PRAGMA user_version. Used by the three stores (index, history, cache).
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KgError } from './errors';

export type Db = Database.Database;
export type SqlValue = string | number | bigint | Buffer | null;
export type Row = Record<string, unknown>;

export const BUSY_TIMEOUT_MS = 5000;

/** A migration brings a file from version i to i + 1. The list for each store is append-only. */
export type Migration = string | ((db: Db) => void);

export function openDb(path: string, migrations: readonly Migration[], o: { vec?: boolean } = {}): Db {
  const db = new Database(path);
  guard(() => {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (o.vec) loadVec(db);
    migrate(db, migrations);
  });
  return db;
}

export function loadVec(db: Db): void {
  try {
    db.prepare('SELECT vec_version()').get();
  } catch {
    sqliteVec.load(db);
  }
}

export function migrate(db: Db, migrations: readonly Migration[]): void {
  const from = db.pragma('user_version', { simple: true }) as number;
  if (from === migrations.length) return;
  if (from > migrations.length) throw new KgError('precondition', `database schema version ${from} is newer than this build (${migrations.length})`);
  db.transaction(() => {
    for (let v = from; v < migrations.length; v++) {
      const m = migrations[v]!;
      if (typeof m === 'string') db.exec(m);
      else m(db);
    }
    db.pragma(`user_version = ${migrations.length}`);
  }).immediate();
}

/** Runs fn and converts SQLite errors into KgError codes; other errors pass through. */
export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof Database.SqliteError)) throw e;
    if (e.code.startsWith('SQLITE_BUSY') || e.code.startsWith('SQLITE_LOCKED')) throw new KgError('upstream', `database is busy: ${e.message}`);
    if (/insert-only/.test(e.message)) throw new KgError('immutable_violation', e.message);
    switch (e.code) {
      case 'SQLITE_CONSTRAINT_FOREIGNKEY':
        throw new KgError('not_found', e.message);
      case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      case 'SQLITE_CONSTRAINT_UNIQUE':
        throw new KgError('conflict', e.message);
      case 'SQLITE_CONSTRAINT_CHECK':
      case 'SQLITE_CONSTRAINT_NOTNULL':
        throw new KgError('invalid_input', e.message);
      default:
        throw e;
    }
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
  get<T extends Row = Row>(sql: string, ...p: SqlValue[]): T | undefined {
    return guard(() => this.stmt(sql).get(...p) as T | undefined);
  }
  all<T extends Row = Row>(sql: string, ...p: SqlValue[]): T[] {
    return guard(() => this.stmt(sql).all(...p) as T[]);
  }
  run(sql: string, ...p: SqlValue[]): void {
    guard(() => this.stmt(sql).run(...p));
  }
  /** Takes the write lock up front. Nested calls become savepoints, so an inner throw undoes only the inner work. */
  transaction<T>(fn: () => T): T {
    return guard(() => this.db.transaction(fn).immediate());
  }
  close(): void {
    this.db.close();
  }
}
