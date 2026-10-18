import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { isKgError, systemClock, ulidGen } from '@kg/core';
import { SqliteEventLog } from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'kg-eventlog-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const child = fileURLToPath(new URL('./support/append-child.ts', import.meta.url));

function runChild(path: string, session: string, count: number): Promise<{ ok: number; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(tsx, [child, path, session, String(count)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as { ok: number; errors: string[] }) : reject(new Error(`child exited ${code}`))));
  });
}

describe('several processes appending to one session', () => {
  it('loses no event and keeps seqs unique and contiguous', async () => {
    const path = join(dir, 'multi.sqlite');
    const log = new SqliteEventLog(new Database(path), systemClock, ulidGen());
    const s = log.openSession({ kind: 'test', label: null, meta: {} });
    const procs = 4;
    const each = 100;
    const results = await Promise.all(Array.from({ length: procs }, () => runChild(path, s, each)));
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.reduce((n, r) => n + r.ok, 0)).toBe(procs * each);
    const seqs = log.events(s, 0, 10_000).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: procs * each + 1 }, (_, i) => i + 1));
  }, 120_000);
});

describe('locking', () => {
  it('opening a log on a file that has the schema does not need the write lock', () => {
    const path = join(dir, 'readers.sqlite');
    const first = new SqliteEventLog(new Database(path), systemClock, ulidGen());
    const s = first.openSession({ kind: 'test', label: null, meta: {} });
    const writer = new Database(path);
    writer.exec('BEGIN IMMEDIATE');
    try {
      const reader = new Database(path, { timeout: 100 });
      const log = new SqliteEventLog(reader, systemClock, ulidGen());
      expect(log.events(s).length).toBe(1);
      expect(log.sessions().length).toBe(1);
      reader.close();
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
  });

  it('a lock held past the timeout surfaces as a KgError, not a raw SQLite error', () => {
    const path = join(dir, 'busy.sqlite');
    const first = new SqliteEventLog(new Database(path), systemClock, ulidGen());
    const s = first.openSession({ kind: 'test', label: null, meta: {} });
    const writer = new Database(path);
    writer.exec('BEGIN IMMEDIATE');
    try {
      const db = new Database(path);
      const log = new SqliteEventLog(db, systemClock, ulidGen());
      db.pragma('busy_timeout = 50');
      const draft = { sessionId: s, type: 'tool.called', buildId: null, searchId: null, parentId: null, payload: { tool: 'search', input: 1 } } as const;
      let caught: unknown;
      try {
        log.append(draft);
      } catch (e) {
        caught = e;
      }
      expect(isKgError(caught) && caught.code).toBe('upstream');
      expect(() => log.openSession({ kind: 'test', label: null, meta: {} })).toThrow(/busy/);
      db.close();
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
  });

  it('a file log runs in WAL with foreign keys on', () => {
    const db = new Database(join(dir, 'pragmas.sqlite'));
    new SqliteEventLog(db, systemClock, ulidGen());
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThan(0);
  });
});
