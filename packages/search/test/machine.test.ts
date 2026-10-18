import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_RECIPE,
  KgError,
  TOOLS,
  recipeId,
  runTool,
  type BuildId,
  type Ctx,
  type EventEnvelope,
  type MachineMap,
  type RecipeSpec,
  type SearchId,
  type SearchRequest,
  type SearchState,
  type StepEnv,
} from '@kg/core';
import { machineMapOf, runPipeline, toMermaid, topologyOf } from '@kg/pipeline';
import { drive, scripted, withActors } from '@kg/pipeline/testing';
import { BUILD_A, FixedClock, InMemoryEventLog, SeqIds, loadMiniCorpus, type MiniCorpus } from '@kg/testkit';
import { machineLogConformance, registerSuite } from '@kg/testkit/conformance';
import { createSearch, searchMachines, similarity, similarityRecipe, similaritySettingsSchema, type SimilarityInput } from '../src/index';
import type { SearchRun } from '../src/machines/kit';

const PINS = JSON.parse(readFileSync(new URL('../src/machines/pins.json', import.meta.url), 'utf8')) as Record<string, { topology: string }>;
const DIAGRAM = new URL('../docs/similarity.mmd', import.meta.url);
const QUERY = 'entropy of an isolated system';

const map = (): MachineMap => machineMapOf(similarity, { machine: 'similarity', version: '1' });

const state: SearchState = {
  query: 'q',
  k: 3,
  buildId: BUILD_A,
  queries: [{ id: 'q0', text: 'q', origin: 'original', parentId: null }],
  candidates: [],
  seeds: [],
  pools: {},
  notes: {},
};

const input = (): SimilarityInput => ({
  run: { env: {} as StepEnv, ctx: {} as Ctx, tag: { searchId: 'sr_00000000000000000000000001' as SearchId, buildId: BUILD_A }, nextIndex: 0 } as SearchRun,
  state,
  settings: { pool: 3, kinds: ['chunk'] },
});

/** Runs one search through the tool runtime, so the events are the real ones; the request may name a recipe. */
async function searchEvents(mc: MiniCorpus, req: SearchRequest) {
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const s = log.openSession({ kind: 'test', label: null, meta: {} });
  const rt = { log, clock, ids, currentBuild: () => mc.store.currentBuild() };
  const service = createSearch({ store: mc.store, embedder: mc.embedder });
  const resp = await runTool(rt, TOOLS.search, s, { query: req.query, k: req.k }, (ctx) => service.search(ctx, req));
  return { resp, events: log.events(s) };
}

describe('pins and diagram', () => {
  it('the pinned topology of similarity@1 is the topology the machine computes', () => {
    expect(PINS['similarity@1']!.topology).toBe(topologyOf(similarity));
    expect(searchMachines['similarity@1']!.topology).toBe(topologyOf(similarity));
  });

  it('the core default search recipe pins the same topology, and similarityRecipe() is that recipe', () => {
    expect(DEFAULT_SEARCH_RECIPE.spec.topology).toBe(topologyOf(similarity));
    expect(similarityRecipe()).toEqual(DEFAULT_SEARCH_RECIPE);
  });

  it('docs/similarity.mmd is the diagram generated from the machine', () => {
    expect(readFileSync(DIAGRAM, 'utf8')).toBe(toMermaid(map()));
  });
});

describe('paths of the machine', () => {
  it('the normal path visits retrieve, cut and done, and returns the state', async () => {
    const m = withActors(similarity, { retrieve: scripted([state]), cut: scripted([state]) });
    const r = await drive(m, input());
    expect(r.visited).toEqual(['retrieve', 'cut', 'done']);
    expect(r.final).toBe('done');
    expect(r.output).toEqual(state);
  });

  it('a retrieve that throws an upstream error ends in failed', async () => {
    const m = withActors(similarity, { retrieve: scripted([new KgError('upstream', 'embedder down')]), cut: scripted([state]) });
    const r = await drive(m, input());
    expect(r.visited).toEqual(['retrieve', 'failed']);
    expect(r.final).toBe('failed');
  });

  it('a cut that throws ends in failed too', async () => {
    const m = withActors(similarity, { retrieve: scripted([state]), cut: scripted([new KgError('internal', 'boom')]) });
    const r = await drive(m, input());
    expect(r.visited).toEqual(['retrieve', 'cut', 'failed']);
  });

  it('runPipeline rethrows the kept error after pipeline.finished with status failed', async () => {
    const emitted: { type: string; payload: unknown }[] = [];
    const ctx = {
      emit: (type: string, payload: unknown) => {
        emitted.push({ type, payload });
        return {};
      },
      clock: new FixedClock(),
      ids: new SeqIds(),
    } as unknown as Ctx;
    const m = withActors(similarity, { retrieve: scripted([new KgError('upstream', 'embedder down')]), cut: scripted([state]) });
    await expect(
      runPipeline(m, input(), {
        run: { ctx, tag: { searchId: 'sr_00000000000000000000000001' as SearchId, buildId: BUILD_A } },
        identity: { pipeline: 'search', machine: 'similarity', version: '1', topology: topologyOf(similarity), recipeId: null },
      }),
    ).rejects.toMatchObject({ code: 'upstream', message: 'embedder down' });
    expect(emitted.map((e) => e.type)).toEqual(['pipeline.started', 'pipeline.finished']);
    expect(emitted[1]!.payload).toMatchObject({ status: 'failed', state: 'retrieve', error: { code: 'upstream', message: 'embedder down' } });
  });

  it('pipeline.finished names cut when the cut state is the one that fails', async () => {
    const emitted: { type: string; payload: unknown }[] = [];
    const ctx = { emit: (type: string, payload: unknown) => (emitted.push({ type, payload }), {}), clock: new FixedClock(), ids: new SeqIds() } as unknown as Ctx;
    const m = withActors(similarity, { retrieve: scripted([state]), cut: scripted([new KgError('internal', 'boom')]) });
    await expect(
      runPipeline(m, input(), {
        run: { ctx, tag: { searchId: 'sr_00000000000000000000000001' as SearchId, buildId: BUILD_A } },
        identity: { pipeline: 'search', machine: 'similarity', version: '1', topology: topologyOf(similarity), recipeId: null },
      }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(emitted[1]!.payload).toMatchObject({ status: 'failed', state: 'cut' });
  });
});

describe('the service refuses what it cannot run with invalid_input', () => {
  let mc: MiniCorpus;
  const correct = topologyOf(similarity);
  beforeAll(async () => {
    mc = await loadMiniCorpus();
  });
  const attempt = async (spec: RecipeSpec['spec'], version = '1') => {
    const searchRecipeId = mc.store.putRecipe({ kind: 'search', version, spec });
    return searchEvents(mc, { query: QUERY, k: 3, searchRecipeId });
  };

  it('an unknown machine name or version', async () => {
    await expect(attempt({ machine: 'similarity', settings: { pool: 3, kinds: ['chunk'] }, topology: correct }, '9')).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'unknown search machine similarity@9',
    });
    await expect(attempt({ machine: 'decomposition', settings: { pool: 3, kinds: ['chunk'] }, topology: correct })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('a topology that is not the registered one', async () => {
    await expect(attempt({ machine: 'similarity', settings: { pool: 3, kinds: ['chunk'] }, topology: '0000000000000000' })).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'machine similarity@1 no longer has the topology this recipe was made for',
    });
  });

  it('settings that fail the strict schema', async () => {
    await expect(attempt({ machine: 'similarity', settings: { pool: 3, kinds: ['chunk'], extra: true }, topology: correct })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(attempt({ machine: 'similarity', settings: { pool: 0, kinds: ['chunk'] }, topology: correct })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('the settings schema rejects bad values with a message', () => {
    expect(() => similaritySettingsSchema.parse({ pool: 3, kinds: [] })).toThrow(KgError);
    expect(() => similaritySettingsSchema.parse({ pool: 3, kinds: ['chunk', 'chunk'] })).toThrow('repeated');
    expect(() => similaritySettingsSchema.parse({ pool: 3, kinds: ['paragraph'] })).toThrow('not an item kind');
    expect(similaritySettingsSchema.parse({ pool: 3, kinds: ['chunk'] })).toEqual({ pool: 3, kinds: ['chunk'] });
  });
});

describe('a real search through the mini corpus', () => {
  let events: EventEnvelope[] = [];
  beforeAll(async () => {
    const mc = await loadMiniCorpus();
    events = (await searchEvents(mc, { query: QUERY, k: 3 })).events;
  });
  registerSuite(machineLogConformance(() => map(), () => events));
});

describe('golden run of one scripted search', () => {
  it('has these event types, states and step types', async () => {
    const mc = await loadMiniCorpus();
    const { resp, events } = await searchEvents(mc, { query: QUERY, k: 3 });
    expect(events.map((e) => e.type)).toEqual([
      'session.started',
      'tool.called',
      'query',
      'pipeline.started',
      'search.step',
      'search.step',
      'pipeline.finished',
      'search.result',
      'tool.returned',
    ]);
    const steps = events.filter((e): e is EventEnvelope<'search.step'> => e.type === 'search.step').map((e) => e.payload.trace);
    expect(steps.map((t) => [t.stepIndex, t.state, t.stepType])).toEqual([
      [0, 'retrieve', 'vector-knn'],
      [1, 'cut', 'truncate'],
    ]);
    const started = events.find((e) => e.type === 'pipeline.started')!;
    expect(started.payload).toEqual({
      pipeline: 'search',
      machine: 'similarity',
      version: '1',
      topology: 'ab74647e68ade0b3',
      recipeId: recipeId(DEFAULT_SEARCH_RECIPE),
    });
    const finished = events.find((e) => e.type === 'pipeline.finished')!;
    expect(finished.payload).toEqual({ pipeline: 'search', status: 'done', state: 'done' });
    expect(resp.items.length).toBe(3);
  });
});
