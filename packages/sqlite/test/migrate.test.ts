import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { KgError, schemaSql } from '@kg/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, migrate, openDatabase, prepare } from '../src/index';

const dirs: string[] = [];
const tempPath = () => {
  const d = mkdtempSync(join(tmpdir(), 'kg-sqlite-'));
  dirs.push(d);
  return join(d, 'kg.sqlite');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const version = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;
const tables = (db: Database.Database) =>
  (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);

describe('migrations', () => {
  it('a new file is migrated to SCHEMA_VERSION and carries the schema', () => {
    const db = openDatabase(':memory:');
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(tables(db)).toEqual(expect.arrayContaining(['events', 'sessions', 'documents', 'eval_runs']));
  });

  it('a file written before user_version was used (version 0, schema present) upgrades in place and keeps its rows', () => {
    const path = tempPath();
    const old = new Database(path);
    old.exec(schemaSql());
    old.prepare("INSERT INTO sessions (session_id, kind, label, meta, started_at) VALUES ('s1', 'agent', null, '{}', '2026-10-17T12:00:00Z')").run();
    expect(version(old)).toBe(0);
    old.close();

    const db = openDatabase(path);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT session_id FROM sessions').all()).toEqual([{ session_id: 's1' }]);
    db.close();
  });

  it('a file from a newer build is refused, not rewritten', () => {
    const path = tempPath();
    const newer = new Database(path);
    newer.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    newer.close();

    expect(() => openDatabase(path)).toThrow(KgError);
    const again = new Database(path);
    expect(version(again)).toBe(SCHEMA_VERSION + 1);
    again.close();
  });

  it('migrating a current file is a read and changes nothing', () => {
    const db = openDatabase(':memory:');
    const before = tables(db).length;
    migrate(db);
    prepare(db);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(tables(db).length).toBe(before);
  });
});
