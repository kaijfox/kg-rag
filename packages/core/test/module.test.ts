import { describe, expect, it } from 'vitest';
import { assertWiring, checkWiring, defineSearchModule, modulesOf, type MachineMap, type SearchState } from '../src';

const cand = (id: string, score: number) => ({ itemId: id as never, kind: 'chunk' as const, score, sourceChunkIds: [id as never], via: 't', queryId: 'q0' });
const state = (candidates = [cand('ch_a', 0.9), cand('ch_b', 0.5)]): SearchState => ({
  query: 'q', k: 1, buildId: 'bd_x' as never, queries: [{ id: 'q0', text: 'q', origin: 'original', parentId: null }], candidates, seeds: [], pools: {}, notes: {},
});
const env = {} as never;

const cut = defineSearchModule<{ k: number }>({ name: 'cut', version: '1', reads: ['candidates'], writes: ['candidates'] }, async (s, _e, p) => ({
  patch: { candidates: [...s.candidates].sort((a, b) => b.score - a.score).slice(0, p.k) },
  trace: { params: { k: p.k } },
}));
const find = defineSearchModule<object>({ name: 'find', version: '1', reads: ['queries'], writes: ['candidates'] }, async () => ({ patch: { candidates: [cand('ch_c', 0.7)] } }));

describe('defineSearchModule', () => {
  it('copies the state, fills considered and output, and leaves the input untouched', async () => {
    const input = state();
    const out = await cut.make({ k: 1 }).run(input, env);
    expect(out.state.candidates.map((c) => c.itemId)).toEqual(['ch_a']);
    expect(out.trace.considered.map((r) => r.itemId)).toEqual(['ch_a', 'ch_b']);
    expect(out.trace.output.map((r) => r.itemId)).toEqual(['ch_a']);
    expect(out.trace.params).toEqual({ k: 1 });
    expect(input.candidates).toHaveLength(2);
  });
  it('refuses a write the module did not declare', async () => {
    const bad = defineSearchModule<object>({ name: 'bad', version: '1', reads: [], writes: ['candidates'] }, async () => ({ patch: { notes: { a: 1 } } }));
    await expect(bad.make({}).run(state(), env)).rejects.toThrow(/does not declare/);
  });
});

const map = (steps: [string, string | null][]): MachineMap => ({
  machine: 'm', version: '1', topology: '0'.repeat(16), initial: steps[0]![0],
  nodes: [...steps.map(([id, step]) => ({ id, parent: null, kind: 'work' as const, label: id, logs: [], step, loop: false })), { id: 'done', parent: null, kind: 'final' as const, label: 'done', logs: [], step: null, loop: false }],
  edges: [...steps.slice(1).map(([id], i) => ({ from: steps[i]![0], to: id, event: 'done' as const, guard: null })), { from: steps.at(-1)![0], to: 'done', event: 'done' as const, guard: null }],
});
const modules = { find: find.descriptor, cut: cut.descriptor };

describe('checkWiring', () => {
  it('accepts retrieve then cut', () => expect(checkWiring(map([['retrieve', 'find'], ['cut', 'cut']]), modules)).toEqual([]));
  it('rejects a cut before any retrieval', () => {
    expect(checkWiring(map([['cut', 'cut'], ['retrieve', 'find']]), modules)).toEqual(['state cut (cut) reads candidates, which nothing before it writes']);
    expect(() => assertWiring(map([['cut', 'cut']]), modules)).toThrow(/mis-wired/);
  });
  it('rejects an unregistered step', () => expect(checkWiring(map([['a', 'nope']]), modules)[0]).toMatch(/no registered module/));
  it('records module versions for the recipe', () => expect(modulesOf(map([['retrieve', 'find'], ['cut', 'cut']]), modules)).toEqual({ cut: 'cut@1', find: 'find@1' }));
});
