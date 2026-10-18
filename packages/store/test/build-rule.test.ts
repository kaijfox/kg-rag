import { describe, expect, it } from 'vitest';
import { buildId, type BuildManifest, type ItemId } from '@kg/core';
import { FixedClock } from '@kg/testkit';
import { openDatabase, SqliteCorpusStore } from '../src/index';
import { codeOf, populate } from './helpers';

describe('build identity on SQLite (buildId from core)', () => {
  it('the stored build id equals buildId(manifest, itemIds), and the stored items are the sorted list', () => {
    const s = new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock());
    const p = populate(s, 5, 4, 3);
    const b = s.getBuild(p.id)!;
    expect(b.id).toBe(buildId(b.manifest, b.itemIds));
    expect(b.itemIds).toEqual([...b.itemIds].sort());
  });

  it('the manifest key order does not change the id; the item set does', () => {
    const s = new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock());
    const p = populate(s, 5, 4, 3);
    const reversedKeys = Object.fromEntries(Object.entries(p.b.manifest).reverse()) as BuildManifest;
    expect(s.putBuild({ parentId: null, manifest: reversedKeys, itemIds: p.b.itemIds })).toBe(p.id);
    const subset = p.b.itemIds.slice(1) as ItemId[];
    const sub = s.putBuild({ parentId: p.id, manifest: p.b.manifest, itemIds: subset });
    expect(sub).not.toBe(p.id);
    expect(s.getBuild(sub)!.parentId).toBe(p.id);
  });

  it('an unsorted item list for a new build is refused; for a stored build the stored id comes back', () => {
    const s = new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock());
    const p = populate(s, 3, 4, 3);
    const subset = p.b.itemIds.slice(0, 2) as ItemId[];
    expect(codeOf(() => s.putBuild({ parentId: null, manifest: p.b.manifest, itemIds: [...subset].reverse() }))).toBe('invalid_input');
    expect(s.putBuild({ parentId: null, manifest: p.b.manifest, itemIds: [...p.b.itemIds].reverse() })).toBe(p.id);
  });
});
