import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FixedClock } from '@kg/testkit';
import { openDatabase, SqliteCorpusStore } from '../src/index';
import { populate } from './helpers';

describe('insert-only triggers on the store tables', () => {
  it('UPDATE on items raises', () => {
    const db = openDatabase(':memory:');
    const s = new SqliteCorpusStore(db, new FixedClock());
    populate(s, 2, 4, 1);
    expect(() => db.prepare("UPDATE items SET text = 'changed'").run()).toThrow(/items is insert-only/);
  });

  it('DELETE on items, chunks, embeddings, builds, labels and artifacts raises', () => {
    const db = openDatabase(':memory:');
    const s = new SqliteCorpusStore(db, new FixedClock());
    const p = populate(s, 2, 4, 1);
    s.labelBuild('base', p.id);
    for (const table of ['items', 'chunks', 'embeddings', 'builds', 'build_items', 'build_labels', 'parse_artifacts', 'doc_versions', 'doc_version_chunks', 'item_sources']) {
      expect(() => db.prepare(`DELETE FROM ${table}`).run(), table).toThrow(/insert-only|never deleted/);
    }
  });

  it('UPDATE on the other insert-only tables raises', () => {
    const db = openDatabase(':memory:');
    const s = new SqliteCorpusStore(db, new FixedClock());
    const p = populate(s, 2, 4, 1);
    s.labelBuild('base', p.id);
    for (const table of ['embeddings', 'embedding_spaces', 'builds', 'build_labels', 'recipes', 'parse_artifacts', 'doc_versions', 'chunks']) {
      expect(() => db.prepare(`UPDATE ${table} SET rowid = rowid`).run(), table).toThrow(/insert-only/);
    }
  });

  it('documents can be re-pointed (the only mutable document column) but never deleted', () => {
    const db = openDatabase(':memory:');
    const s = new SqliteCorpusStore(db, new FixedClock());
    const p = populate(s, 2, 4, 1);
    expect(() => s.setCurrentDocVersion(p.docKey, p.b.manifest.docVersions[p.docKey] as never)).not.toThrow();
    expect(() => db.prepare('DELETE FROM documents').run()).toThrow(/never deleted/);
  });

  it('the CHECK that chunks have no recipe and derived items do is enforced by SQLite', () => {
    const db = openDatabase(':memory:');
    new SqliteCorpusStore(db, new FixedClock());
    expect(() =>
      db.prepare("INSERT INTO items (item_id, kind, text, recipe_id, meta, created_at) VALUES ('ch_aaaaaaaaaaaaaaaaaaaa', 'chunk', 'x', 'rc_x', '{}', 't')").run(),
    ).toThrow(/CHECK/);
  });

  it('the schema is idempotent: a second store on the same handle keeps the data', () => {
    const db = openDatabase(':memory:');
    const s1 = new SqliteCorpusStore(db, new FixedClock());
    const p = populate(s1, 3, 4, 1);
    const s2 = new SqliteCorpusStore(db, new FixedClock());
    expect(s2.currentBuild()).toBe(p.id);
    expect(s2.getBuild(p.id)!.itemIds.length).toBe(3);
  });
});

describe('file database persists across reopen (WAL)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kg-store-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a build written to a file is read back after reopening the file', () => {
    const path = join(dir, 'corpus.sqlite');
    const db1 = openDatabase(path);
    const p = populate(new SqliteCorpusStore(db1, new FixedClock()), 4, 4, 2);
    db1.close();
    const db2 = openDatabase(path);
    const s2 = new SqliteCorpusStore(db2, new FixedClock());
    expect(s2.currentBuild()).toBe(p.id);
    expect(s2.knn({ space: p.space, vector: p.vecs[0]!, buildId: p.id, kinds: ['chunk'], limit: 1 })[0]!.itemId).toBe(p.chunkIds[0]);
    db2.close();
  });
});
