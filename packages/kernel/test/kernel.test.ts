import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CacheStore,
  HistoryStore,
  IndexStore,
  KgError,
  Registry,
  assignChunkIds,
  cachedLlm,
  checkMachine,
  chunkId,
  itemId,
  normName,
  requestSha256,
  runMachine,
  type ChunkRow,
  type Llm,
  type MachineDef,
  type ModuleDef,
} from '../src';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'kg-kernel-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const SPACE = { model: 'fake', digest: 'x', dims: 3, documentTemplate: '{text}', queryTemplate: '{query}' };
const T0 = '2026-01-01T00:00:00.000Z';

function chunks(docKey: string, texts: string[]): ChunkRow[] {
  return assignChunkIds(docKey, texts.map((text) => ({ sectionPath: ['S'], text, pages: [1], blockRefs: [] }))).map((c, i) => ({
    id: c.id, docKey, ordinal: i, sectionPath: c.sectionPath as string[], occurrence: c.occurrence, text: c.text, pages: c.pages, blockRefs: c.blockRefs, meta: {},
  }));
}
const doc = (docKey: string) => ({ docKey, sourceSha256: 'a'.repeat(64), sourceName: `${docKey}.md`, parseRecipe: { v: 1 }, chunkRecipe: { v: 1 }, meta: {} });

describe('IDs', () => {
  it('chunk IDs depend on text, path and document, not on whitespace', () => {
    const a = chunkId('D', ['S'], 'hello  world', 0);
    expect(chunkId('D', ['S'], 'hello world', 0)).toBe(a);
    expect(chunkId('E', ['S'], 'hello world', 0)).not.toBe(a);
    expect(chunkId('D', ['T'], 'hello world', 0)).not.toBe(a);
    expect(a).toMatch(/^ch_[a-z2-7]{20}$/);
  });
  it('item IDs include the text and the maker, so a new sentence or a new module version is a new record', () => {
    const a = itemId('fact', 'm@1', ['ch_a', 'ch_b'], 'X is Y.');
    expect(itemId('fact', 'm@1', ['ch_b', 'ch_a'], 'X  is Y.')).toBe(a);
    expect(itemId('fact', 'm@2', ['ch_a', 'ch_b'], 'X is Y.')).not.toBe(a);
    expect(itemId('fact', 'm@1', ['ch_a', 'ch_b'], 'X is Z.')).not.toBe(a);
  });
  it('names normalise', () => expect(normName('Dorsolateral Striatum (DLS).')).toBe('dorsolateral striatum (dls)'));
});

describe('IndexStore', () => {
  it('keeps unchanged chunks, drops removed ones from the current set and flags items that lose their support', () => {
    const ix = IndexStore.open(join(tmp(), 'i.sqlite'));
    const v1 = chunks('D', ['one', 'two', 'three']);
    expect(ix.commitDocument(doc('D'), v1, T0)).toMatchObject({ ingestNo: 1, inserted: 3, reused: 0, dropped: 0 });
    const space = ix.putSpace(SPACE);
    const item = ix.commitDerived('m@1', [{ kind: 'fact', text: 'Two is a number.', sourceChunkIds: [v1[1]!.id], mentions: [{ surface: 'Two' }] }], [], T0);
    expect(ix.stats().staleItems).toBe(0);
    const v2 = chunks('D', ['one', 'three', 'four']); // "two" removed
    expect(ix.commitDocument(doc('D'), v2, T0)).toMatchObject({ ingestNo: 2, inserted: 1, reused: 2, dropped: 1 });
    expect(ix.currentChunks().map((c) => c.text)).toEqual(['one', 'three', 'four']);
    expect(ix.staleItems()).toEqual(item.itemIds);
    expect(space.dims).toBe(3);
  });

  it('refuses a derived item that cites no chunk, or a chunk that does not exist, and writes nothing', () => {
    const ix = IndexStore.open(join(tmp(), 'i.sqlite'));
    const c = chunks('D', ['one']);
    ix.commitDocument(doc('D'), c, T0);
    const good = { kind: 'fact' as const, text: 'Good.', sourceChunkIds: [c[0]!.id], mentions: [{ surface: 'Good' }] };
    expect(() => ix.commitDerived('m@1', [good, { ...good, text: 'Bad.', sourceChunkIds: [] }], [], T0)).toThrow(KgError);
    expect(() => ix.commitDerived('m@1', [{ ...good, sourceChunkIds: ['ch_aaaaaaaaaaaaaaaaaaaa'] }], [], T0)).toThrow(/source chunk/);
    expect(ix.stats().facts).toBe(0);
    expect(ix.audit()).toEqual([]);
  });

  it('stores items append-only and re-committing the same item changes nothing', () => {
    const ix = IndexStore.open(join(tmp(), 'i.sqlite'));
    const c = chunks('D', ['one']);
    ix.commitDocument(doc('D'), c, T0);
    const d = { kind: 'fact' as const, text: 'One is first.', sourceChunkIds: [c[0]!.id], mentions: [{ surface: 'One' }, { surface: 'first' }] };
    const a = ix.commitDerived('m@1', [d], [], T0);
    const b = ix.commitDerived('m@1', [d], [], T0);
    expect(b.newItems).toBe(0);
    expect(b.itemIds).toEqual(a.itemIds);
    expect(ix.getItems(a.itemIds)[0]).toMatchObject({ madeBy: 'm@1', sourceChunkIds: [c[0]!.id], mentions: [{ name: 'first' }, { name: 'one' }] });
  });

  it('links never edit the records they join; aliases widen a name lookup and deleting a maker removes only its records', () => {
    const ix = IndexStore.open(join(tmp(), 'i.sqlite'));
    const c = chunks('D', ['a', 'b']);
    ix.commitDocument(doc('D'), c, T0);
    const f1 = ix.commitDerived('m@1', [{ kind: 'fact', text: 'DLS does X.', sourceChunkIds: [c[0]!.id], mentions: [{ surface: 'DLS' }] }], [], T0).itemIds[0]!;
    const f2 = ix.commitDerived('m@1', [{ kind: 'fact', text: 'Dorsolateral striatum does Y.', sourceChunkIds: [c[1]!.id], mentions: [{ surface: 'Dorsolateral striatum' }] }], [], T0).itemIds[0]!;
    ix.commitDerived('r@1', [], [{ kind: 'alias-of', subject: 'name', fromId: 'DLS', toId: 'Dorsolateral striatum' }, { kind: 'replaces', subject: 'item', fromId: f2, toId: f1 }], T0);
    expect(ix.canonicalName('DLS')).toBe('dorsolateral striatum');
    expect(ix.itemsMentioning(['dls']).map((x) => x.itemId).sort()).toEqual([f1, f2].sort());
    expect(ix.linksOf([f1], 'to', 'replaces')[0]).toMatchObject({ fromId: f2, toId: f1 });
    expect(ix.getItems([f1])[0]!.text).toBe('DLS does X.');
    expect(() => ix.commitDerived('r@1', [], [{ kind: 'alias-of', subject: 'item', fromId: f1, toId: f2 }], T0)).toThrow(/alias-of/);
    expect(ix.deleteMadeBy('m@1')).toMatchObject({ items: 2 });
    expect(ix.stats()).toMatchObject({ facts: 0, links: 1 });
  });

  it('ranks by cosine similarity over current chunks and items only', () => {
    const ix = IndexStore.open(join(tmp(), 'i.sqlite'));
    const c = chunks('D', ['x', 'y', 'z']);
    ix.commitDocument(doc('D'), c, T0);
    const space = ix.putSpace(SPACE);
    ix.putEmbeddings(space.id, [
      { recordId: c[0]!.id, vector: Float32Array.of(1, 0, 0) },
      { recordId: c[1]!.id, vector: Float32Array.of(0, 1, 0) },
      { recordId: c[2]!.id, vector: Float32Array.of(0.9, 0.1, 0) },
    ]);
    const hits = ix.knn(space.id, Float32Array.of(1, 0, 0), 2, ['chunk']);
    expect(hits.map((h) => h.id)).toEqual([c[0]!.id, c[2]!.id]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    expect(ix.recordsMissingEmbedding(space.id)).toEqual([]);
  });
});

describe('machines', () => {
  const mod = (name: string, needs: string[], adds: string[], run?: ModuleDef['run']): ModuleDef => ({
    name, version: '1', needs, adds, scope: 'request', run: run ?? (() => ({ patch: Object.fromEntries(adds.map((a) => [a, name])) })),
  });
  const reg = () => new Registry().addModule(mod('a', ['q'], ['x'])).addModule(mod('b', ['x'], ['y'])).addModule(mod('c', ['y'], ['z'])).addGuard('ok', (s) => s.x === 'a');
  const line: MachineDef = { name: 'line', version: '1', provides: ['q'], start: 's1', states: { s1: { module: 'a', next: 's2' }, s2: { module: 'b', next: 's3' }, s3: { module: 'c', next: null } } };

  it('accepts a sound machine and runs it in order, stamping nothing and logging each step', async () => {
    const r = reg();
    expect(checkMachine(line, r)).toEqual([]);
    r.addMachine(line);
    const log: string[] = [];
    const { state, steps } = await runMachine(line, { q: 1 }, { index: IndexStore.open(join(tmp(), 'i.sqlite')), services: {}, config: {} as never, registry: r, now: () => T0, log: (t) => log.push(t) });
    expect(state.z).toBe('c');
    expect(steps.map((s) => s.module)).toEqual(['a@1', 'b@1', 'c@1']);
    expect(log).toEqual(['pipeline.started', 'step', 'step', 'step', 'pipeline.finished']);
  });

  it('refuses at load a state that needs a slot nothing provides on every path, an unknown module, and an unreachable state', () => {
    const r = reg();
    const skip: MachineDef = { ...line, name: 'skip', states: { s1: { module: 'a', next: 's3' }, s3: { module: 'c', next: null } } };
    expect(checkMachine(skip, r).join('\n')).toMatch(/needs "y"/);
    expect(checkMachine({ ...line, states: { ...line.states, s2: { module: 'nope', next: 's3' } } }, r).join('\n')).toMatch(/unknown module nope/);
    expect(checkMachine({ ...line, states: { ...line.states, extra: { module: 'a', next: null } } }, r).join('\n')).toMatch(/cannot be reached/);
    expect(() => r.addMachine(skip)).toThrow(KgError);
  });

  it('checks a loop: a slot added only inside the loop is not available at its entry', () => {
    const r = reg().addGuard('again', () => false);
    const looped: MachineDef = {
      name: 'loop', version: '1', provides: ['q'], start: 's1',
      states: { s1: { module: 'a', next: 's2' }, s2: { module: 'b', next: { guard: 'again', then: 's1', else: 's3' } }, s3: { module: 'c', next: null } },
    };
    expect(checkMachine(looped, r)).toEqual([]);
    const bad: MachineDef = { ...looped, name: 'bad', states: { ...looped.states, s1: { module: 'c', next: 's2' } } };
    expect(checkMachine(bad, r).join('\n')).toMatch(/needs "y"/);
  });

  it('rejects a module that sets a slot it did not declare, and a write during a read-only run', async () => {
    const r = new Registry().addModule(mod('liar', [], ['x'], () => ({ patch: { x: 1, secret: 2 } }))).addModule(mod('writer', [], ['w'], () => ({ patch: { w: 1 }, writes: { derived: { items: [] } } })));
    const run = (m: string, mayWrite?: boolean) =>
      runMachine({ name: m, version: '1', provides: [], start: 's', states: { s: { module: m, next: null } } }, {}, { index: IndexStore.open(join(tmp(), 'i.sqlite')), services: {}, config: {} as never, registry: r, now: () => T0, mayWrite });
    await expect(run('liar')).rejects.toThrow(/secret/);
    await expect(run('writer', false)).rejects.toThrow(/read-only/);
  });
});

describe('history and cache', () => {
  it('appends events that cannot be changed, and keeps corrections apart from the index', () => {
    const h = HistoryStore.open(join(tmp(), 'h.sqlite'), () => T0);
    const s = h.openSession({ kind: 'cli', label: 't' });
    h.append(s, 'search.started', { query: 'q' }, { indexId: 'ix_1', searchId: 'sr_1' });
    expect(h.events(s).map((e) => e.type)).toEqual(['session.opened', 'search.started']);
    expect(h.sessions()[0]).toMatchObject({ sessionId: s, events: 2 });
    h.addCorrection({ kind: 'alias-of', subject: 'name', fromKey: 'dls', toKey: 'dorsolateral striatum', note: null });
    h.addCorrection({ kind: 'alias-of', subject: 'name', fromKey: 'dls', toKey: 'dorsolateral striatum', note: null });
    expect(h.corrections()).toHaveLength(1);
  });

  it('caches model responses by request hash, and prunes the least recently used to a size cap', async () => {
    const c = CacheStore.open(join(tmp(), 'c.sqlite'));
    let calls = 0;
    const llm: Llm = { async complete(r) { calls++; return { text: `answer ${r.messages[0]!.content}`, model: r.model, inputTokens: 1, outputTokens: 1 }; } };
    const cached = cachedLlm(llm, c);
    const req = (q: string) => ({ purpose: 'p', model: 'm', system: 's', messages: [{ role: 'user' as const, content: q }], temperature: 0, maxTokens: 10 });
    expect((await cached.complete(req('a'))).cached).toBe(false);
    expect((await cached.complete(req('a'))).cached).toBe(true);
    expect(calls).toBe(1);
    expect(requestSha256(req('a'))).not.toBe(requestSha256(req('b')));
    for (let i = 0; i < 20; i++) await cached.complete(req(`question ${i}`));
    expect(c.prune(100)).toBeGreaterThan(0);
    expect(c.stats().bytes).toBeLessThanOrEqual(100);
  });
});
