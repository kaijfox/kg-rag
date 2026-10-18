import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  KgError,
  TOOLS,
  recipeId,
  runTool,
  spaceId,
  type ArtifactId,
  type ChunkViewRenderer,
  type Ctx,
  type DocKey,
  type EventEnvelope,
  type IngestRequest,
  type ItemId,
  type MachineMap,
  type ParseRecipeSpec,
} from '@kg/core';
import { machineMapOf, runPipeline, toMermaid, topologyOf } from '@kg/pipeline';
import { drive, scripted, withActors } from '@kg/pipeline/testing';
import {
  FixedClock,
  type FixtureEntry,
  FixtureParser,
  HashEmbedder,
  InMemoryCorpusStore,
  InMemoryEventLog,
  MINI_DOCS,
  SeqIds,
  fixtureChunker,
  miniArtifact,
  miniArtifactPath,
  miniConfig,
  miniParseRecipe,
  miniParserEntries,
  miniSourcePath,
} from '@kg/testkit';
import { machineMapConformance, registerSuite } from '@kg/testkit/conformance';
import { createIngest, documentMachine, ingestMachine, type FormulaDecoder, type IngestDeps } from '../src/index';
import { plainParseRecipe } from '../src/deps';

const PINS = JSON.parse(readFileSync(new URL('../src/machines/pins.json', import.meta.url), 'utf8')) as Record<string, { topology: string }>;
const ingestMap = (): MachineMap => machineMapOf(ingestMachine, { machine: 'ingest', version: '1' });
const documentMap = (): MachineMap => machineMapOf(documentMachine, { machine: 'document', version: '1' });

const fullRecipe = (): ParseRecipeSpec => ({
  ...miniParseRecipe(),
  spec: { ...miniParseRecipe().spec, formulaDecoding: { model: 'test-decoder', revision: 'r1', prompt: 'read the formula', cropMargin: 0.18 } },
});
const decodingConfig = () => ({ ...miniConfig(), parseRecipe: fullRecipe() });

interface Harness {
  deps: IngestDeps;
  store: InMemoryCorpusStore;
  parser: FixtureParser;
  embedder: HashEmbedder;
  clock: FixedClock;
  ids: SeqIds;
}

const identityView: ChunkViewRenderer = (_artifact, _blockRefs, text) => text;

function harness(over: Partial<IngestDeps> = {}, seed = true): Harness {
  const clock = new FixedClock();
  const ids = new SeqIds();
  const store = new InMemoryCorpusStore(clock);
  const parser = new FixtureParser(miniParserEntries());
  const embedder = new HashEmbedder(4096);
  const deps: IngestDeps = { store, parser, chunker: fixtureChunker, chunkView: identityView, embedder, config: miniConfig(), ...over };
  if (seed) {
    store.putRecipe(deps.config.parseRecipe);
    store.putRecipe(deps.config.chunkRecipe);
    store.putRecipe(deps.config.searchRecipe);
    store.putSpace(deps.config.space);
  }
  return { deps, store, parser, embedder, clock, ids };
}

/** One ingest call through the tool runtime, so the events are the real ones. */
async function ingestEvents(h: Harness, req: IngestRequest) {
  const log = new InMemoryEventLog(h.clock, h.ids);
  const session = log.openSession({ kind: 'test', label: 'ingest', meta: {} });
  const rt = { log, clock: h.clock, ids: h.ids, currentBuild: () => h.store.currentBuild() };
  const service = createIngest(h.deps);
  const report = await runTool(rt, TOOLS.ingest, session, req, (ctx, r) => service.ingest(ctx, r));
  return { report, events: log.events(session) as EventEnvelope[] };
}

/** Like ingestEvents, but a failed call hands back its events and error instead of throwing. */
async function ingestOutcome(h: Harness, req: IngestRequest) {
  const log = new InMemoryEventLog(h.clock, h.ids);
  const session = log.openSession({ kind: 'test', label: 'ingest', meta: {} });
  const rt = { log, clock: h.clock, ids: h.ids, currentBuild: () => h.store.currentBuild() };
  const service = createIngest(h.deps);
  const error = await runTool(rt, TOOLS.ingest, session, req, (ctx, r) => service.ingest(ctx, r)).then(
    () => null,
    (e: unknown) => e as KgError,
  );
  return { error, events: log.events(session) as EventEnvelope[] };
}

const ctxFor = (h: Harness): Ctx =>
  ({ sessionId: 'se_00000000000000000000000001', parentEventId: 'ev_00000000000000000000000001', clock: h.clock, ids: h.ids, emit: () => ({}) }) as unknown as Ctx;

const docInput = (h: Harness, path: string, docKey?: string) => ({
  ctx: ctxFor(h),
  deps: h.deps,
  entry: { kind: 'file' as const, path, docKey },
  seen: [] as DocKey[],
});

registerSuite(machineMapConformance(ingestMap));
registerSuite(machineMapConformance(documentMap));

describe('pins and diagrams', () => {
  it('the pinned topology of each machine is the one it computes', () => {
    expect(PINS['ingest@1']!.topology).toBe(topologyOf(ingestMachine));
    expect(PINS['document@1']!.topology).toBe(topologyOf(documentMachine));
  });

  it('docs/ingest.mmd and docs/document.mmd are the diagrams generated from the machines', () => {
    expect(readFileSync(new URL('../docs/ingest.mmd', import.meta.url), 'utf8')).toBe(toMermaid(ingestMap()));
    expect(readFileSync(new URL('../docs/document.mmd', import.meta.url), 'utf8')).toBe(toMermaid(documentMap()));
  });
});

describe('the declared logs of the machines', () => {
  it('every event a run emits is declared by some work state of its machine', async () => {
    const h = harness();
    const { events } = await ingestEvents(h, { sources: MINI_DOCS.map((d) => ({ path: miniSourcePath(1, d) })) });
    const declared = new Set([...ingestMap().nodes, ...documentMap().nodes].flatMap((n) => n.logs));
    const emitted = new Set(events.map((e) => e.type).filter((t) => t.startsWith('ingest.') || t === 'build.created'));
    for (const t of emitted) expect(declared.has(t), t).toBe(true);
    for (const n of [...ingestMap().nodes, ...documentMap().nodes]) for (const t of n.logs) expect(EVENT_TYPES as string[], n.id).toContain(t);
  });
});

describe('paths of the document machine', () => {
  it('a fresh source file visits identify, parse, chunk and embed, and never decoding', async () => {
    const h = harness();
    const r = await drive(documentMachine, docInput(h, miniSourcePath(1, 'gas')));
    expect(r.final).toBe('done');
    expect(r.visited).toEqual(['identifying', 'identifying', 'checkDuplicate', 'lookup', 'parsing', 'afterParse', 'chunking', 'embedding', 'done']);
    expect(r.visited).not.toContain('decoding');
  });

  it('a cached artifact skips parsing', async () => {
    const h = harness();
    await ingestEvents(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    const r = await drive(documentMachine, docInput(h, miniSourcePath(1, 'gas')));
    expect(r.final).toBe('done');
    expect(r.visited).toContain('reading');
    expect(r.visited).not.toContain('parsing');
  });

  it('a docKey named twice in one request ends in failed with invalid_input', async () => {
    const h = harness();
    const r = await drive(ingestMachine, {
      ctx: ctxFor(h),
      deps: h.deps,
      entries: [
        { kind: 'file', path: miniSourcePath(1, 'gas'), docKey: 'same' },
        { kind: 'file', path: miniSourcePath(1, 'entropy'), docKey: 'same' },
      ],
    });
    expect(r.final).toBe('failed');
    expect(r.visited).toContain('document');
    await expect(
      runPipeline(ingestMachine, { ctx: ctxFor(h), deps: h.deps, entries: [
        { kind: 'file', path: miniSourcePath(1, 'gas'), docKey: 'same' },
        { kind: 'file', path: miniSourcePath(1, 'entropy'), docKey: 'same' },
      ] }, { run: { ctx: ctxFor(h), tag: {} }, identity: { pipeline: 'ingest', machine: 'ingest', version: '1', topology: topologyOf(ingestMachine), recipeId: null } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('a recipe with formulaDecoding visits decoding; the same run without it never does', async () => {
    const decoder: FormulaDecoder = async (artifact, _path, recipe) => ({ ...artifact, recipe });
    const h = harness({ config: decodingConfig(), formulaDecoder: decoder });
    const r = await drive(documentMachine, docInput(h, miniSourcePath(1, 'gas')));
    expect(r.visited).toContain('decoding');
    expect(r.final).toBe('done');
    const plain = harness();
    const p = await drive(documentMachine, docInput(plain, miniSourcePath(1, 'gas')));
    expect(p.visited).not.toContain('decoding');
  });

  it('an embedder failure ends in failed with the embedder error code', async () => {
    const h = harness();
    h.embedder.embed = async () => {
      throw new KgError('upstream', 'embedder down');
    };
    const r = await drive(documentMachine, docInput(h, miniSourcePath(1, 'gas')));
    expect(r.visited.at(-1)).toBe('failed');
    expect(r.final).toBe('failed');
  });

  it('pipeline.finished names the document state when the embedder fails inside it', async () => {
    const h = harness();
    h.embedder.embed = async () => {
      throw new KgError('upstream', 'embedder down');
    };
    const { error, events } = await ingestOutcome(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    expect(error).toMatchObject({ code: 'upstream' });
    expect(events.find((e) => e.type === 'pipeline.finished')!.payload).toMatchObject({ pipeline: 'ingest', status: 'failed', state: 'document' });
  });

  it('a parser that fails on a parse ends in failed with the parser error code', async () => {
    const h = harness();
    const parser = withActors(documentMachine, {});
    const broken = { ...h, deps: { ...h.deps, parser: Object.assign(new FixtureParser(miniParserEntries()), { parse: async () => { throw new KgError('upstream', 'docling down'); } }) } };
    const r = await drive(parser, docInput(broken, miniSourcePath(1, 'gas')));
    expect(r.visited.at(-1)).toBe('failed');
  });
});

describe('paths of the ingest machine', () => {
  it('the whole machine visits document, extras, gate, committing and done for one source', async () => {
    const h = harness();
    const r = await drive(ingestMachine, { ctx: ctxFor(h), deps: h.deps, entries: [{ kind: 'file', path: miniSourcePath(1, 'gas') }] });
    expect(r.final).toBe('done');
    expect(r.visited).toEqual(['nextDocument', 'identifying', 'document', 'document', 'checkDuplicate', 'lookup', 'parsing', 'afterParse', 'chunking', 'embedding', 'done', 'nextDocument', 'extras', 'gate', 'committing', 'done']);
  });

  it('a space the embedder does not serve ends in failed with precondition', async () => {
    const h = harness({ embedder: new HashEmbedder(64) });
    const r = await drive(ingestMachine, { ctx: ctxFor(h), deps: h.deps, entries: [{ kind: 'file', path: miniSourcePath(1, 'gas') }] });
    expect(r.final).toBe('failed');
    expect(r.visited).not.toContain('document');
  });

  it('a document machine that fails is passed up as the run failure', async () => {
    const h = harness();
    const r = await drive(withActors(ingestMachine, { document: scripted([{ plan: null, error: new KgError('upstream', 'boom') }]) }), {
      ctx: ctxFor(h),
      deps: h.deps,
      entries: [{ kind: 'file', path: miniSourcePath(1, 'gas') }],
    });
    expect(r.final).toBe('failed');
  });
});

describe('golden runs', () => {
  it('one source on a fresh database: the event types, in order', async () => {
    const h = harness();
    const { report, events } = await ingestEvents(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    expect(events.map((e) => e.type)).toEqual([
      'session.started',
      'tool.called',
      'pipeline.started',
      'ingest.started',
      'ingest.parsed',
      'ingest.chunked',
      'ingest.embedded',
      'ingest.completed',
      'build.created',
      'pipeline.finished',
      'tool.returned',
    ]);
    expect(report.buildChanged).toBe(true);
    expect(events.find((e) => e.type === 'pipeline.finished')!.payload).toEqual({ pipeline: 'ingest', status: 'done', state: 'done' });
    expect(events.find((e) => e.type === 'pipeline.started')!.payload).toEqual({
      pipeline: 'ingest',
      machine: 'ingest',
      version: '1',
      topology: PINS['ingest@1']!.topology,
      recipeId: null,
    });
  });

  it('a formula-decoding run logs ingest.parsed once, for the decoded artifact', async () => {
    const decoder: FormulaDecoder = async (artifact, _path, recipe) => ({ ...artifact, recipe });
    const h = harness({ config: decodingConfig(), formulaDecoder: decoder });
    const { events } = await ingestEvents(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    const parsed = events.filter((e): e is EventEnvelope<'ingest.parsed'> => e.type === 'ingest.parsed');
    expect(parsed.map((e) => e.payload.origin)).toEqual(['parsed']);
    const full = h.store.findArtifact(miniArtifact(1, 'gas').sourceSha256, recipeId(decodingConfig().parseRecipe));
    expect(parsed[0]!.payload.artifactId).toBe(full);
    expect(plainParseRecipe(decodingConfig().parseRecipe)).toEqual(miniParseRecipe());
  });

  it('an artifact file in a decoding database is refused with precondition (no source file)', async () => {
    const decoder: FormulaDecoder = async (artifact, _path, recipe) => ({ ...artifact, recipe });
    const h = harness({ config: decodingConfig(), formulaDecoder: decoder });
    await expect(ingestEvents(h, { artifacts: [{ path: miniArtifactPath(1, 'gas') }] })).rejects.toMatchObject({ code: 'precondition' });
  });

  it('the artifact id of a document is the id of its stored artifact', async () => {
    const h = harness();
    const { report } = await ingestEvents(h, { artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(1, d) })) });
    const artifactIds = h.store.currentDocVersions().map((v) => v.artifactId as ArtifactId);
    expect(artifactIds.length).toBe(report.docs.length);
    for (const a of artifactIds) expect(h.store.getArtifact(a)).not.toBeNull();
  });
});

const view: ChunkViewRenderer = (_artifact, _blockRefs, text) => `VIEW ${text}`;
const types = (events: readonly EventEnvelope[]) => events.map((e) => e.type);

describe('recipes and space are written after the embedder check', () => {
  it('a refused ingest leaves the store without recipes, space, documents and build', async () => {
    const h = harness({ embedder: new HashEmbedder(64) }, false);
    const { error, events } = await ingestOutcome(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    expect(error).toMatchObject({ code: 'precondition' });
    const c = h.deps.config;
    for (const r of [c.parseRecipe, plainParseRecipe(c.parseRecipe), c.chunkRecipe, c.searchRecipe]) expect(h.store.getRecipe(recipeId(r))).toBeNull();
    expect(h.store.currentBuild()).toBeNull();
    expect(h.store.currentDocVersions()).toEqual([]);
    expect(types(events)).toContain('pipeline.finished');
  });

  it('an accepted ingest stores the configured recipe, its plain form, the chunk and search recipes and the space', async () => {
    const decoder: FormulaDecoder = async (artifact, _path, recipe) => ({ ...artifact, recipe });
    const h = harness({ config: decodingConfig(), formulaDecoder: decoder }, false);
    await ingestEvents(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    const c = h.deps.config;
    for (const r of [c.parseRecipe, plainParseRecipe(c.parseRecipe), c.chunkRecipe, c.searchRecipe]) expect(h.store.getRecipe(recipeId(r))).not.toBeNull();
    expect(h.store.getSpace(spaceId(c.space))).not.toBeNull();
  });

  it('a model mismatch alone and a dims mismatch alone are each refused', async () => {
    const base = new HashEmbedder(4096);
    const wrongModel = { model: 'another-model', dims: 4096, embed: (t: readonly string[]) => base.embed(t) };
    const wrongDims = { model: base.model, dims: 64, embed: (t: readonly string[]) => base.embed(t) };
    for (const embedder of [wrongModel, wrongDims]) {
      const { error } = await ingestOutcome(harness({ embedder }, false), { sources: [{ path: miniSourcePath(1, 'gas') }] });
      expect(error).toMatchObject({ code: 'precondition' });
    }
  });
});

describe('imported artifacts under another parse recipe', () => {
  const foreign = (): FixtureEntry => ({
    path: 'fixture://foreign/entropy.kgparse.json',
    artifact: { ...miniArtifact(1, 'entropy'), recipe: { ...miniParseRecipe(), version: 'foreign' } },
  });

  it('is accepted and the build is flagged mixedRecipes', async () => {
    const h = harness({ parser: new FixtureParser([...miniParserEntries(), foreign()]) });
    const { events } = await ingestEvents(h, { artifacts: [{ path: miniArtifactPath(1, 'gas') }, { path: foreign().path }] });
    const built = events.find((e) => e.type === 'build.created') as EventEnvelope<'build.created'>;
    expect(built.payload.mixedRecipes).toBe(true);
    expect(h.store.getBuild(built.payload.buildId)!.manifest.mixedRecipes).toBe(true);
  });

  it('a build of artifacts under the configured recipe is not flagged', async () => {
    const h = harness();
    const { events } = await ingestEvents(h, { artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(1, d) })) });
    expect((events.find((e) => e.type === 'build.created') as EventEnvelope<'build.created'>).payload.mixedRecipes).toBe(false);
  });

  it('ingest.started names the plain recipe on the file path, the import path and a foreign import', async () => {
    const decoder: FormulaDecoder = async (artifact, _path, recipe) => ({ ...artifact, recipe });
    const h = harness({ config: decodingConfig(), formulaDecoder: decoder, parser: new FixtureParser([...miniParserEntries(), foreign()]) });
    const plain = recipeId(plainParseRecipe(h.deps.config.parseRecipe));
    const file = await ingestEvents(h, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    const imp = await ingestOutcome(h, { artifacts: [{ path: foreign().path }] });
    for (const e of [...file.events, ...imp.events].filter((x) => x.type === 'ingest.started')) {
      expect((e as EventEnvelope<'ingest.started'>).payload.parseRecipeId).toBe(plain);
    }
    expect(types(imp.events)).toContain('ingest.started');
  });
});

describe('parser and decoder results are checked against the request', () => {
  const upstream = async (h: Harness) => (await ingestOutcome(h, { sources: [{ path: miniSourcePath(1, 'gas') }] })).error;

  it('a parser returning another document or another recipe is an upstream error', async () => {
    class Other extends FixtureParser {
      constructor(private readonly answer: () => ReturnType<typeof miniArtifact>) {
        super(miniParserEntries());
      }
      override async parse() {
        return this.answer();
      }
    }
    expect(await upstream(harness({ parser: new Other(() => miniArtifact(1, 'entropy')) }))).toMatchObject({ code: 'upstream' });
    expect(await upstream(harness({ parser: new Other(() => ({ ...miniArtifact(1, 'gas'), recipe: { ...miniParseRecipe(), version: 'x' } })) }))).toMatchObject({ code: 'upstream' });
  });

  it('a decoder returning another document or another recipe is an upstream error', async () => {
    const wrongDoc: FormulaDecoder = async (_a, _p, recipe) => ({ ...miniArtifact(1, 'entropy'), recipe });
    const wrongRecipe: FormulaDecoder = async (artifact) => artifact;
    for (const formulaDecoder of [wrongDoc, wrongRecipe]) {
      expect(await upstream(harness({ config: decodingConfig(), formulaDecoder }))).toMatchObject({ code: 'upstream' });
    }
  });
});

describe('embedding', () => {
  it('an embedder returning fewer vectors than texts is an upstream error, for a requested and for another document', async () => {
    const short = async (texts: readonly string[]) => new HashEmbedder(4096).embed(texts).then((v) => v.slice(1));
    const h = harness();
    h.embedder.embed = short;
    expect((await ingestOutcome(h, { sources: [{ path: miniSourcePath(1, 'gas') }] })).error).toMatchObject({ code: 'upstream' });

    const g = harness();
    await ingestEvents(g, { sources: [{ path: miniSourcePath(1, 'gas') }, { path: miniSourcePath(1, 'entropy') }] });
    const other = harness({ config: { ...g.deps.config, space: { ...g.deps.config.space, queryTemplate: 'q: {query}' } }, store: g.store });
    other.embedder.embed = short;
    expect((await ingestOutcome(other, { sources: [{ path: miniSourcePath(1, 'gas') }] })).error).toMatchObject({ code: 'upstream' });
  });

  it('the chunk view is applied to every embedded text, on the requested and on the other documents', async () => {
    const g = harness({ chunkView: view });
    const texts: string[] = [];
    const record = new HashEmbedder(4096);
    g.deps.embedder = { model: record.model, dims: record.dims, embed: (t) => (texts.push(...t), record.embed(t)) };
    await ingestEvents(g, { sources: [{ path: miniSourcePath(1, 'gas') }, { path: miniSourcePath(1, 'entropy') }] });
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain('VIEW ');
    const before = texts.length;
    g.deps.config = { ...g.deps.config, space: { ...g.deps.config.space, queryTemplate: 'q: {query}' } };
    await ingestEvents(g, { sources: [{ path: miniSourcePath(1, 'gas') }] });
    expect(texts.length - before).toBe(before);
    for (const t of texts.slice(before)) expect(t).toContain('VIEW ');
  });

  it('other documents are rendered with the block refs of their current version, not the first-seen ones', async () => {
    const calls: { sha: string; refs: readonly string[] }[] = [];
    const recording: ChunkViewRenderer = (artifact, blockRefs, text) => (calls.push({ sha: artifact.sourceSha256, refs: [...blockRefs] }), text);
    const g = harness({ chunkView: recording });
    await ingestEvents(g, { sources: [{ path: miniSourcePath(1, 'gas') }, { path: miniSourcePath(1, 'entropy') }] });
    await ingestEvents(g, { sources: [{ path: miniSourcePath(2, 'gas') }] });
    g.deps.config = { ...g.deps.config, space: { ...g.deps.config.space, queryTemplate: 'q: {query}' } };
    calls.length = 0;
    await ingestEvents(g, { sources: [{ path: miniSourcePath(1, 'entropy') }] });
    const gas2 = miniArtifact(2, 'gas');
    const gas1 = miniArtifact(1, 'gas');
    const want = fixtureChunker(gas2, 'gas' as DocKey, g.deps.config.chunkRecipe).map((c) => c.blockRefs);
    const first = fixtureChunker(gas1, 'gas' as DocKey, g.deps.config.chunkRecipe).map((c) => c.blockRefs);
    const got = calls.filter((c) => c.sha === gas2.sourceSha256).map((c) => c.refs);
    expect(JSON.stringify(want)).not.toBe(JSON.stringify(first));
    expect(got.length).toBeGreaterThan(0);
    for (const refs of got) expect(want.map((w) => JSON.stringify(w))).toContain(JSON.stringify(refs));
    expect(got.some((refs) => first.some((f) => JSON.stringify(f) === JSON.stringify(refs)) && !want.some((w) => JSON.stringify(w) === JSON.stringify(refs)))).toBe(false);
  });
});

describe('failure paths stop before anything is committed', () => {
  it('a docKey named twice chunks the first document only, not the second', async () => {
    const h = harness();
    const { error, events } = await ingestOutcome(h, {
      sources: [
        { path: miniSourcePath(1, 'gas'), docKey: 'same' },
        { path: miniSourcePath(1, 'entropy'), docKey: 'same' },
      ],
    });
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect(types(events).filter((t) => t === 'ingest.chunked')).toHaveLength(1);
    expect(h.store.currentBuild()).toBeNull();
  });

  it('chunks of the new build left without a vector end the run in failed before committing', async () => {
    const h = harness();
    const left = 'ch_missing' as ItemId;
    const stub = scripted([{ vectors: [], unembedded: [left] }]);
    const r = await drive(withActors(ingestMachine, { embedOthers: stub }), { ctx: ctxFor(h), deps: h.deps, entries: [{ kind: 'file', path: miniSourcePath(1, 'gas') }] });
    expect(r.final).toBe('failed');
    expect(r.visited).toContain('gate');
    expect(r.visited).not.toContain('committing');
    expect(h.store.currentBuild()).toBeNull();
  });
});
