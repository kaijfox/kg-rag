import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_RECIPE } from '@kg/core';
import { FixedClock } from '@kg/testkit';
import { openDatabase, SqliteCorpusStore, SqliteEvalRepo } from '../src/index';
import { codeOf, populate } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'kg-store-lock-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('two connections to one file', () => {
  it('a second store opens and reads while another connection holds a write transaction', () => {
    const path = join(dir, 'read.sqlite');
    const db1 = openDatabase(path);
    const p = populate(new SqliteCorpusStore(db1, new FixedClock()), 3, 4, 1);
    db1.exec('BEGIN IMMEDIATE');
    try {
      const db2 = openDatabase(path);
      db2.pragma('busy_timeout = 50');
      const s2 = new SqliteCorpusStore(db2, new FixedClock());
      new SqliteEvalRepo(db2);
      expect(s2.currentBuild()).toBe(p.id);
      expect(db2.pragma('foreign_keys', { simple: true })).toBe(1);
      db2.close();
    } finally {
      db1.exec('ROLLBACK');
      db1.close();
    }
  });

  it('a write that waits past busy_timeout fails with upstream, and works once the lock is released', () => {
    const path = join(dir, 'write.sqlite');
    const db1 = openDatabase(path);
    new SqliteCorpusStore(db1, new FixedClock());
    const db2 = openDatabase(path);
    const s2 = new SqliteCorpusStore(db2, new FixedClock());
    db2.pragma('busy_timeout = 50');
    db1.exec('BEGIN IMMEDIATE');
    expect(codeOf(() => s2.putRecipe(DEFAULT_CHUNK_RECIPE))).toBe('upstream');
    db1.exec('ROLLBACK');
    expect(codeOf(() => s2.putRecipe(DEFAULT_CHUNK_RECIPE))).toBe('none');
    db1.close();
    db2.close();
  });

  it('a transaction that reads first and then writes is not upgraded late (write lock taken up front)', () => {
    const path = join(dir, 'upgrade.sqlite');
    const db1 = openDatabase(path);
    const s1 = new SqliteCorpusStore(db1, new FixedClock());
    const db2 = openDatabase(path);
    const s2 = new SqliteCorpusStore(db2, new FixedClock());
    // s1 reads, s2 commits in the middle, s1 then writes: with a deferred transaction this fails at once with a stale snapshot
    s1.transaction(() => {
      s1.currentBuild();
      db2.pragma('busy_timeout = 0');
      expect(codeOf(() => s2.putRecipe(DEFAULT_CHUNK_RECIPE))).toBe('upstream');
      s1.putRecipe(DEFAULT_CHUNK_RECIPE);
    });
    expect(s2.getRecipe(s1.putRecipe(DEFAULT_CHUNK_RECIPE))).not.toBeNull();
    db1.close();
    db2.close();
  });
});
