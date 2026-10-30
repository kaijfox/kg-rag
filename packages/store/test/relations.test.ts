import { describe, expect, it } from 'vitest';
import { nodeId, recipeId, type DerivedItemId, type Node, type NodeRef, type Relation, type RunId } from '@kg/core';
import { FixedClock } from '@kg/testkit';
import { openDatabase } from '@kg/sqlite';
import { SqliteCorpusStore } from '../src/index';
import { codeOf, populate } from './helpers';

const NAMES = ['zebra', 'apple', 'mango', 'kiwi'];
const nodes: Node[] = NAMES.map((name) => ({ id: nodeId(name), name }));
const ref = (name: string, role: string | null = null): NodeRef => ({ nodeId: nodeId(name), surface: name, role });

function setup() {
  const db = openDatabase(':memory:');
  const s = new SqliteCorpusStore(db, new FixedClock());
  const p = populate(s, 2, 4, 3);
  const rel = (refs: NodeRef[], id = 'rl_aaaaaaaaaaaaaaaaaaaa'): Relation => ({
    id: id as DerivedItemId,
    kind: 'relation',
    text: 'zebras and apples',
    sourceChunkIds: [p.chunkIds[0]!],
    recipeId: recipeId({ kind: 'extract', version: 'test', spec: {} }),
    meta: {},
    nodes: refs,
  });
  s.putRecipe({ kind: 'extract', version: 'test', spec: {} });
  return { db, s, p, rel };
}

describe('relation nodes', () => {
  it('come back in the order they were given, not sorted by id, name or role', () => {
    const { s, rel } = setup();
    const refs = [ref('zebra', 'subject'), ref('kiwi', null), ref('apple', 'object'), ref('mango', 'object')];
    s.putItems([rel(refs)], nodes);
    const got = s.getItems(['rl_aaaaaaaaaaaaaaaaaaaa' as never])[0] as Relation;
    expect(got.nodes).toEqual(refs);
    // the same set in the opposite order is a different relation and keeps its own order
    const reversed = [...refs].reverse();
    s.putItems([rel(reversed, 'rl_bbbbbbbbbbbbbbbbbbbb')], nodes);
    expect((s.getItems(['rl_bbbbbbbbbbbbbbbbbbbb' as never])[0] as Relation).nodes).toEqual(reversed);
  });

  it('keep their order after VACUUM', () => {
    const { db, s, rel } = setup();
    const refs = [ref('zebra'), ref('kiwi'), ref('apple'), ref('mango')];
    s.putItems([rel(refs)], nodes);
    db.exec('VACUUM');
    expect((s.getItems(['rl_aaaaaaaaaaaaaaaaaaaa' as never])[0] as Relation).nodes).toEqual(refs);
  });

  it('a duplicate node reference is invalid_input, not conflict, and stores nothing', () => {
    const { s, rel } = setup();
    expect(codeOf(() => s.putItems([rel([ref('zebra', 'subject'), ref('zebra', 'object')])], nodes))).toBe('invalid_input');
    expect(s.getItems(['rl_aaaaaaaaaaaaaaaaaaaa' as never])).toEqual([]);
  });

  it('the same node under two different surfaces is allowed', () => {
    const { s, rel } = setup();
    const refs: NodeRef[] = [{ nodeId: nodeId('zebra'), surface: 'zebra', role: null }, { nodeId: nodeId('zebra'), surface: 'zebras', role: null }];
    s.putItems([rel(refs)], nodes);
    expect((s.getItems(['rl_aaaaaaaaaaaaaaaaaaaa' as never])[0] as Relation).nodes).toEqual(refs);
  });
});

describe('putMappings', () => {
  it('rejects a run that exists with different content', () => {
    const { s } = setup();
    const rid = s.putRecipe({ kind: 'equivalence', version: 'test', spec: {} });
    const run = { id: 'dr_00000000000000000000000001' as RunId, recipeId: rid, inputStateHash: 'x', baseBuildId: null, createdAt: '2026-10-17T12:00:00.000Z' };
    s.putMappings(run, []);
    s.putMappings(run, []);
    expect(codeOf(() => s.putMappings({ ...run, inputStateHash: 'y' }, []))).toBe('immutable_violation');
    expect(codeOf(() => s.putMappings({ ...run, createdAt: '2026-10-18T00:00:00.000Z' }, []))).toBe('immutable_violation');
    expect(codeOf(() => s.putMappings({ ...run, baseBuildId: s.currentBuild() }, []))).toBe('immutable_violation');
  });
});
