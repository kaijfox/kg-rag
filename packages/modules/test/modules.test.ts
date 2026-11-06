import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Kg, KgError } from '@kg/kernel';
import { MACHINES, checkFact, createRegistry, findReplacements, ingest, parseFacts, readArtifactFile, rebuild, sectionPack } from '../src';
import { fakeEmbedder, makeKg, scriptedLlm, tempDir } from './helpers';

const ROOT = resolve(__dirname, '../../..');
const FIXTURE = join(__dirname, 'fixtures/log.md');
const CHUNK_RECIPE = { kind: 'chunk', version: '1', spec: { algorithm: 'section-pack/1', targetChars: 1000, maxChars: 1500, minChars: 200 } };

describe('the chunker and chunk IDs (the pinned evaluation sets depend on them)', () => {
  const have = existsSync(join(ROOT, 'test/corpa/stat-mech/artifacts/ThermoKardar.kgparse.json.gz')) && existsSync(join(ROOT, 'scratch/sprint-2/eval-set-kardar.json'));
  it.skipIf(!have)('reproduces every gold chunk ID of the 63 reviewed questions from the kept parsed documents', async () => {
    const ids = new Set<string>();
    for (const doc of ['FoundationsKardar', 'ThermoKardar', 'FoundationsPlischke', 'ThermoPlischke']) {
      const a = await readArtifactFile(join(ROOT, `test/corpa/stat-mech/artifacts/${doc}.kgparse.json.gz`));
      for (const c of sectionPack(a, doc, CHUNK_RECIPE as never)) ids.add(c.id);
    }
    let total = 0;
    let found = 0;
    for (const f of ['eval-set-kardar.json', 'eval-set-plischke.json']) {
      for (const q of JSON.parse(readFileSync(join(ROOT, 'scratch/sprint-2', f), 'utf8')).questions as { goldChunkIds: string[] }[])
        for (const g of q.goldChunkIds) (total++, ids.has(g) && found++);
    }
    expect(total).toBe(102);
    expect(found).toBe(total);
  });
});

describe('ingest of a real PDF through a kept parsed document', () => {
  const pdf = join(ROOT, 'test/corpa/stat-mech/ThermoPlischke.pdf');
  it.skipIf(!existsSync(pdf))('ingests, answers a search, and a second ingest changes nothing', async () => {
    const dir = tempDir();
    const kg = makeKg({ sources: [{ path: pdf, docKey: 'ThermoPlischke' }] }, { embedder: fakeEmbedder() }, dir);
    const first = await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
    expect(first.documents).toEqual([{ docKey: 'ThermoPlischke', chunks: 39, unchanged: false }]);
    expect(first.stats).toMatchObject({ currentChunks: 39, embeddings: 39, staleItems: 0 });
    const s = kg.openSession('test');
    const r = await kg.search({ query: 'entropy and the second law of thermodynamics', k: 3, sessionId: s });
    expect(r.items).toHaveLength(3);
    expect(r.items[0]!.score).toBeGreaterThanOrEqual(r.items[1]!.score);
    const again = await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
    expect(again.documents).toEqual([{ docKey: 'ThermoPlischke', chunks: 0, unchanged: true }]);
    expect(again.embedded).toBe(0);
    // the log alone says what each step received and returned
    const types = kg.history.eventsOfSearch(r.searchId).map((e) => e.type);
    expect(types).toEqual(['search.started', 'pipeline.started', 'step', 'step', 'step', 'pipeline.finished', 'search.result']);
    const nearest = kg.history.eventsOfSearch(r.searchId).find((e) => (e.payload as { state?: string }).state === 'nearest')!.payload as { returned: { candidates: { n: number; top: unknown[] } } };
    expect(nearest.returned.candidates.n).toBeGreaterThanOrEqual(3);
    kg.close();
  }, 60_000);
});

describe('project history', () => {
  const sources = [{ path: FIXTURE, docKey: 'decisions', adapter: 'decision-log' }];

  it('finds replacements from the entries’ own wording, in both directions, and skips an ambiguous reference', () => {
    const entries = readFileSync(FIXTURE, 'utf8').split(/^(?=## )/m).slice(1).map((t, i) => {
      const title = t.split('\n')[0]!.replace('## ', '');
      const date = title.slice(0, 10);
      return { id: `c${i}`, key: `${date}#${i}`, date, title, text: t };
    });
    const { found, skipped } = findReplacements(entries);
    expect(found.map((f) => [f.newer.title, f.older.title])).toEqual([
      ['2026-04-02: Store is SQLite', '2026-03-01: Store is JSON files'],
      ['2026-04-02: Embeddings come from a local model', '2026-03-15: Search uses keyword matching'],
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/2 entries are dated 2026-05-01/);
  });

  it('answers “what is the store?” with the current decision only, using no model', async () => {
    const kg = makeKg({ sources, searchMachine: 'current-state' }, { embedder: fakeEmbedder() });
    const rep = await ingest(kg);
    expect(rep.documents[0]).toMatchObject({ chunks: 7 });
    expect(rep.stats.links).toBe(2);
    const s = kg.openSession('test');
    const plain = await kg.search({ query: 'what is the project store', k: 5, machine: 'chunk-search', sessionId: s });
    expect(plain.items.map((i) => i.text.split('\n')[0])).toContain('## 2026-03-01: Store is JSON files');
    const current = await kg.search({ query: 'what is the project store', k: 5, sessionId: s });
    const heads = current.items.map((i) => i.text.split('\n')[0]);
    expect(heads).toContain('## 2026-04-02: Store is SQLite');
    expect(heads).not.toContain('## 2026-03-01: Store is JSON files');
    expect(heads).not.toContain('## 2026-03-15: Search uses keyword matching');
    kg.close();
  });

  it('runs on the repository’s own decision log without any change to the kernel', async () => {
    const log = join(ROOT, 'scratch/decision-log.md');
    if (!existsSync(log)) return;
    const kg = makeKg({ sources: [{ path: log, docKey: 'decision-log', adapter: 'decision-log' }] }, { embedder: fakeEmbedder() });
    const rep = await ingest(kg);
    expect(rep.documents[0]!.chunks).toBeGreaterThan(20);
    expect(kg.index.audit()).toEqual([]);
    kg.close();
  });
});

describe('fact extraction', () => {
  const log = [{ path: FIXTURE, docKey: 'decisions', adapter: 'decision-log' }];
  const table = {
    'Store is SQLite': [
      { text: 'The project store is SQLite, replacing JSON files on disk.', names: ['project store', 'SQLite', 'JSON files'] },
      { text: 'It is fast.', names: ['SQLite'] }, // too short
      { text: 'This supersedes the decision of 2026-03-01 about the store.', names: ['store'] }, // pronoun start
    ],
    'Store is JSON files': [{ text: 'The project store was JSON files on disk because they are the simplest thing that works.', names: ['project store', 'JSON files'] }],
    'Viewer shows sessions': [{ text: 'The viewer lists sessions and their events for the project.', names: ['viewer', 'sessions', 'not in the sentence'] }],
  };

  it('keeps standalone facts that cite their chunk, rejects the rest with a reason, and never writes a fact with no source', async () => {
    const llm = scriptedLlm(table);
    const kg = makeKg({ sources: log, extract: { enabled: true, secondPass: false, maxFactsPerChunk: 12 } }, { embedder: fakeEmbedder(), llm });
    const rep = await ingest(kg);
    expect(rep.facts).toBe(3);
    expect(rep.stats).toMatchObject({ facts: 3, embeddings: 7 + 3, staleItems: 0 });
    expect(kg.index.audit()).toEqual([]);
    const step = kg.history.eventsOfType('step').find((e) => (e.payload as { module?: string }).module === 'extract-facts@1')!.payload as { notes: { text: string; data?: { rejected: { reason: string }[] } }[] };
    expect(step.notes[0]!.data!.rejected.map((r) => r.reason).sort()).toEqual(['starts with a pronoun', 'too short to stand alone']);
    const viewer = kg.index.itemsMentioning(['viewer']);
    expect(viewer).toHaveLength(1);
    expect(kg.index.getItems([viewer[0]!.itemId])[0]!.mentions.map((m) => m.name)).toEqual(['sessions', 'viewer']); // the name absent from the sentence was dropped
    kg.close();
  });

  it('facts-and-neighbours finds a fact that shares a name with the best match, and returns the chunks it cites', async () => {
    const kg = makeKg({ sources: log, extract: { enabled: true, secondPass: false, maxFactsPerChunk: 12 } }, { embedder: fakeEmbedder(), llm: scriptedLlm(table) });
    await ingest(kg);
    const s = kg.openSession('test');
    const r = await kg.search({ query: 'SQLite store replacing JSON files', k: 4, machine: 'facts-and-neighbours', sessionId: s });
    expect(r.items.every((i) => i.kind === 'chunk')).toBe(true);
    const heads = r.items.map((i) => i.text.split('\n')[0]);
    expect(heads).toContain('## 2026-04-02: Store is SQLite');
    expect(heads).toContain('## 2026-03-01: Store is JSON files'); // reached through the shared names "project store" and "JSON files"
    const expand = r.steps.find((st) => st.state === 'expand')!;
    expect(expand.notes[0]!.text).toMatch(/neighbours added/);
    kg.close();
  });

  it('parses model replies strictly', () => {
    expect(parseFacts('{"facts":[{"text":"A is B.","names":["A"]}]}')).toHaveLength(1);
    expect(() => parseFacts('not json')).toThrow(KgError);
    expect(() => parseFacts('{"facts":[{"text":"A","names":"A"}]}')).toThrow(/names/);
    expect(checkFact({ text: 'Entropy of the ideal gas increases with volume at fixed temperature.', names: ['Entropy', 'ideal gas', 'pressure'] }, 'x')).toEqual({ ok: [{ surface: 'Entropy' }, { surface: 'ideal gas' }] });
    expect(checkFact({ text: 'The equation (2.100) gives the result for the system.', names: ['system'] }, 'x')).toEqual({ reject: 'refers to the document instead of naming the thing' });
  });
});

describe('rebuild', () => {
  const log = [{ path: FIXTURE, docKey: 'decisions', adapter: 'decision-log' }];
  const table = { 'Store is SQLite': [{ text: 'The project store is SQLite, replacing JSON files on disk.', names: ['project store', 'SQLite'] }] };

  it('builds a new index from the sources, reuses cached model calls, replays confirmed corrections, keeps chunk IDs, and leaves the history alone', async () => {
    const llm = scriptedLlm(table);
    const embedder = fakeEmbedder();
    const dir = tempDir();
    const kg = makeKg({ sources: log, extract: { enabled: true, secondPass: false, maxFactsPerChunk: 12 } }, { embedder, llm }, dir);
    await ingest(kg);
    const oldId = kg.index.indexId;
    const chunkIds = kg.index.currentChunks().map((c) => c.id);
    const callsBefore = llm.calls;
    kg.history.addCorrection({ kind: 'alias-of', subject: 'name', fromKey: 'sqlite db', toKey: 'sqlite', note: 'confirmed by a person' });
    const eventsBefore = kg.history.eventsOfType('step').length;
    const res = await rebuild(kg);
    expect(res.previousIndexId).toBe(oldId);
    expect(llm.calls).toBe(callsBefore); // every extraction call came from the cache
    kg.close();

    const reopened = Kg.open(dir, { registry: createRegistry(), services: { embedder, llm } });
    expect(reopened.index.indexId).not.toBe(oldId);
    expect(reopened.index.indexId).toBe(res.report.indexId);
    expect(reopened.index.currentChunks().map((c) => c.id)).toEqual(chunkIds);
    expect(reopened.index.stats()).toMatchObject({ facts: 1, links: 3, staleItems: 0 }); // 2 replacements + 1 replayed alias
    expect(reopened.index.canonicalName('SQLite DB')).toBe('sqlite');
    expect(reopened.index.audit()).toEqual([]);
    expect(reopened.history.eventsOfType('step').length).toBeGreaterThan(eventsBefore); // history kept and extended
    expect(reopened.history.eventsOfType('rebuild.finished')[0]!.payload).toMatchObject({ from: oldId, to: reopened.index.indexId });
    expect(existsSync(join(dir, `index.${oldId}.sqlite`))).toBe(false);
    reopened.close();
  });

  it('with redo, deletes one module’s records and makes them again, and a bad index is refused before the swap', async () => {
    const llm = scriptedLlm(table);
    const dir = tempDir();
    const kg = makeKg({ sources: log, extract: { enabled: true, secondPass: false, maxFactsPerChunk: 12 } }, { embedder: fakeEmbedder(), llm }, dir);
    await ingest(kg);
    const old = kg.index.indexId;
    const res = await rebuild(kg, { redo: ['extract-facts'], keepOld: true });
    expect(res.keptOld).toBe(join(dir, `index.${old}.sqlite`));
    expect(existsSync(res.keptOld!)).toBe(true);
    expect(kg.history.eventsOfType('rebuild.redo')[0]!.payload).toMatchObject({ module: 'extract-facts', items: 1 });
    kg.close();
    const noSource = makeKg({ sources: [{ path: join(dir, 'missing.md'), adapter: 'markdown' }] }, { embedder: fakeEmbedder() }, dir);
    const before = noSource.index.indexId;
    await expect(rebuild(noSource)).rejects.toThrow(/cannot read/);
    expect(existsSync(join(dir, 'index.sqlite'))).toBe(true);
    expect(noSource.index.indexId).toBe(before);
    noSource.close();
  });
});

describe('machines', () => {
  it('every shipped machine passes the load-time wiring check, and a build machine cannot run as a search', () => {
    expect(MACHINES.map((m) => m.name)).toEqual(['chunk-search', 'chunk-search-adjacent', 'facts-and-neighbours', 'current-state', 'build']);
    expect(() => createRegistry()).not.toThrow();
    const reg = createRegistry();
    expect(() => reg.addMachine({ name: 'broken', version: '1', provides: ['query', 'k'], start: 'cut', states: { cut: { module: 'keep-top-k', next: null } } })).toThrow(/needs "candidates"/);
  });
});
