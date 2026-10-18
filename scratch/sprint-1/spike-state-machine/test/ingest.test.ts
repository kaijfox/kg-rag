import { describe, expect, it } from 'vitest';
import { TOOLS, runTool, KgError, type EventEnvelope, type IngestRequest } from '@kg/core';
import { FixedClock, FixtureParser, HashEmbedder, InMemoryCorpusStore, InMemoryEventLog, SeqIds, miniArtifactPath, miniConfig, miniParserEntries, miniSourcePath, MINI_DOCS } from '@kg/testkit';
import { ingestScenarios, registerSuite } from '@kg/testkit/conformance';
import { createIngest } from '../../../../packages/app/src/skeleton/ingest';
import { sectionPack } from '../../../../packages/app/src/skeleton/chunker';
import { Interrupted, VectorCheckpoint, createMachineIngest, memoryPersistence } from '../src/ingest-machine';

// ---- acceptance: the shipped ingest scenarios (I-1..I-10) against the machine, with persistence ON
describe('machine ingest, persistence on', () => {
  registerSuite(ingestScenarios((d) => createMachineIngest(d, { persist: memoryPersistence() }), sectionPack));
});

class CountingEmbedder extends HashEmbedder { calls: string[][] = []; override async embed(t: readonly string[]) { this.calls.push([...t]); return super.embed(t); } }
function env(make: (d: never, o: never) => ReturnType<typeof createMachineIngest>, o: object = {}) {
  const clock = new FixedClock(); const ids = new SeqIds();
  const store = new InMemoryCorpusStore(clock);
  const embedder = new CountingEmbedder(4096);
  const parser = new FixtureParser(miniParserEntries());
  const d = { store, parser, chunker: sectionPack, embedder, config: miniConfig() };
  const log = new InMemoryEventLog(clock, ids);
  const session = log.openSession({ kind: 'test', label: 'ingest', meta: {} });
  const rt = { log, clock, ids, currentBuild: () => store.currentBuild() };
  const service = make(d as never, o as never);
  const run = (req: IngestRequest) => runTool(rt, TOOLS.ingest, session, req, (ctx, r) => service.ingest(ctx, r));
  const domain = () => (log.events(session) as EventEnvelope[]).filter((e) => e.type.startsWith('ingest.') || e.type === 'build.created').map((e) => [e.type, (e.payload as { docKey?: string }).docKey ?? (e.type === 'build.created' ? `revert=${(e.payload as { revert?: boolean }).revert}` : '')] as const);
  return { run, store, embedder, log, session, domain, parser, d, rt, service };
}
const req = (v: 1 | 2): IngestRequest => ({ sources: MINI_DOCS.map((p) => ({ path: miniSourcePath(v, p) })) });

describe('5. ingest as machines', () => {
  it('event log is identical to the skeleton (same clock, same ids), 0.4.0 pointer fields included', async () => {
    const a = env((d) => createIngest(d as never) as never);
    const b = env((d) => createMachineIngest(d as never));
    await a.run(req(1)); await b.run(req(1));
    await a.run(req(2)); await b.run(req(2));
    await a.run(req(1)); await b.run(req(1)); // revert
    expect(b.log.events(b.session)).toEqual(a.log.events(a.session));
    expect(b.store.currentBuild()).toBe(a.store.currentBuild());
  });

  it('every persisted snapshot is plain JSON that round-trips, and stays small (no vectors, no chunk text)', async () => {
    const p = memoryPersistence(); const sizes: number[] = []; const states: string[] = [];
    const save = p.save;
    p.save = (k, v) => { expect(JSON.parse(v)).toBeTruthy(); sizes.push(v.length); states.push(JSON.stringify(JSON.parse(v).value)); save(k, v); };
    const e = env((d, o) => createMachineIngest(d, o), { persist: p });
    await e.run(req(1));
    console.log('snapshots saved:', sizes.length, 'max bytes', Math.max(...sizes), 'last states', states.slice(-3));
    expect(Math.max(...sizes)).toBeLessThan(20000);
    expect(p.map.size).toBe(0); // dropped on completion
  });

  const sweep = async (mode: 'snapshot' | 'event') => {
    const count = (xs: ReadonlyArray<readonly [string, string]>) => { const m = new Map<string, number>(); for (const x of xs) m.set(x.join(':'), (m.get(x.join(':')) ?? 0) + 1); return m; };
    const p0 = memoryPersistence(); let n = 0; const sv = p0.save; p0.save = (k, v) => { n++; sv(k, v); };
    let ne = 0;
    const ref = env((d, o) => createMachineIngest(d, o), { persist: p0, crashAfterEvent: () => (ne++, false) });
    const refReport = await ref.run(req(1));
    const N = mode === 'snapshot' ? n : ne; const refEvents = count(ref.domain());
    const refTexts = ref.embedder.calls.flat(); const refDup = refTexts.length - new Set(refTexts).size;
    const rows: string[] = []; const dupKinds = new Set<string>();
    let extraTexts = 0; let maxExtra = 0; let missingEvents = 0; let dupEvents = 0;
    for (let i = 1; i <= N; i++) {
      const p = memoryPersistence(); const cp = new VectorCheckpoint();
      const e = env((d, o) => createMachineIngest(d, o), { persist: p, checkpoint: cp, ...(mode === 'snapshot' ? { crashAfter: (s: { n: number }) => s.n === i } : { crashAfterEvent: (k: number) => k === i }) });
      await expect(e.run(req(1))).rejects.toBeInstanceOf(Interrupted);
      const committed = e.store.currentBuild() !== null;
      const svc = createMachineIngest(e.d as never, { persist: p, checkpoint: cp });         // a fresh process: new service, same store/parser/embedder/log
      const rep = await runTool({ ...e.rt, clock: new FixedClock('2026-10-17T13:00:00.000Z') } as never, TOOLS.ingest, e.session, req(1), (ctx, r) => svc.ingest(ctx, r));
      expect(rep.buildId).toBe(refReport.buildId);
      expect(e.store.currentBuild()).toBe(ref.store.currentBuild());
      expect(e.store.currentDocVersions().map((v) => [v.id, v.chunkIds])).toEqual(ref.store.currentDocVersions().map((v) => [v.id, v.chunkIds]));
      const got = count(e.domain());
      let miss = 0; let dup = 0;
      for (const [k, v] of refEvents) { const g = got.get(k) ?? 0; if (g < v) miss += v - g; if (g > v) { dup += g - v; dupKinds.add(k.split(':')[0]!); } }
      const texts = e.embedder.calls.flat(); const extra = texts.length - refTexts.length;
      const ex = Math.max(0, texts.length - new Set(texts).size - refDup); extraTexts += ex; maxExtra = Math.max(maxExtra, ex);
      missingEvents += miss; dupEvents += dup;
      rows.push(`${String(i).padStart(2)}/${N} ${committed ? 'committed' : 'pending  '} embed calls ${e.embedder.calls.length} texts ${texts.length} (ref ${refTexts.length}, extra ${extra}) events missing ${miss} dup ${dup}`);
    }
    return { N, rows, missingEvents, dupEvents, extraTexts, dupKinds: [...dupKinds], maxExtra };
  };
  it('crash sweep A: kill the process after EVERY persisted snapshot, restart, resume', async () => {
    const r = await sweep('snapshot');
    console.log(r.rows.join('\n'));
    console.log('sweep A (snapshots)', r.N, 'crash points; missing events', r.missingEvents, 'duplicated events', r.dupEvents, r.dupKinds, 'redone embeddings total', r.extraTexts, 'worst single crash', r.maxExtra);
    expect(r.missingEvents).toBe(0);
    expect(r.maxExtra).toBeLessThan(17); // only the in-flight embed batch of one document is ever redone
  });
  it('crash sweep B: kill the process right after EVERY emitted event (before the stage is persisted), restart, resume', async () => {
    const r = await sweep('event');
    console.log(r.rows.join('\n'));
    console.log('sweep B (events)', r.N, 'crash points; missing events', r.missingEvents, 'duplicated events', r.dupEvents, r.dupKinds, 'extra duplicate embeddings', r.extraTexts);
    expect(r.missingEvents).toBe(0);
  });

  it('R-24 as a machine guard: a run that skips the S2 extras cannot reach commit', async () => {
    // after a space switch, a one-document ingest must embed the OTHER current docs too; guard + store check agree
    const e = env((d, o) => createMachineIngest(d, o));
    await e.run(req(1));
    const cfg2 = { ...miniConfig(), space: { ...miniConfig().space, documentTemplate: miniConfig().space.documentTemplate + ' ' } };
    const svc = createMachineIngest({ store: e.store, parser: e.parser, chunker: sectionPack, embedder: e.embedder, config: cfg2 });
    const rt = { log: e.log, clock: new FixedClock(), ids: new SeqIds(), currentBuild: () => e.store.currentBuild() };
    const r = await runTool(rt as never, TOOLS.ingest, e.session, { sources: [{ path: miniSourcePath(1, 'gas') }] }, (ctx, q) => svc.ingest(ctx, q));
    const b = e.store.getBuild(r.buildId)!;
    expect(e.store.missingEmbeddings(b.manifest.embeddingSpaces[0]!, b.itemIds)).toEqual([]);
  });

  it('R-24 guard: with the extras stage disabled the machine stops itself at the gate (precondition), before any write', async () => {
    const e = env((d, o) => createMachineIngest(d, o));
    await e.run(req(1));
    const cfg2 = { ...miniConfig(), space: { ...miniConfig().space, documentTemplate: miniConfig().space.documentTemplate + ' ' } };
    const svc = createMachineIngest({ ...(e.d as object), config: cfg2 } as never, { unsafeSkipExtras: true });
    const before = e.store.currentBuild();
    const rt = { log: e.log, clock: new FixedClock(), ids: new SeqIds(), currentBuild: () => e.store.currentBuild() };
    await expect(runTool(rt as never, TOOLS.ingest, e.session, { sources: [{ path: miniSourcePath(1, 'gas') }] }, (ctx, q) => svc.ingest(ctx, q))).rejects.toMatchObject({ code: 'precondition', message: expect.stringContaining('R-24') });
    expect(e.store.currentBuild()).toBe(before);
  });

  it('a failing embedder: nothing in the store, last event tool.failed, and a retry re-uses checkpointed vectors', async () => {
    const cp = new VectorCheckpoint();
    const e = env((d, o) => createMachineIngest(d, o), { checkpoint: cp });
    (e.embedder as unknown as { failAfter: number }).failAfter = 0;
    const orig = e.embedder.embed.bind(e.embedder);
    let calls = 0;
    e.embedder.embed = async (t) => { if (++calls === 2) throw new KgError('upstream', 'embedder died on doc 2'); return orig(t); };
    await expect(e.run(req(1))).rejects.toMatchObject({ code: 'upstream' });
    expect(e.store.currentBuild()).toBeNull();
    expect(e.store.currentDocVersions()).toEqual([]);
    expect((e.log.events(e.session).at(-1) as EventEnvelope).type).toBe('tool.failed');
    const before = cp.m.size; expect(before).toBeGreaterThan(0);
    const r = await e.run(req(1));
    expect(r.buildChanged).toBe(true);
    expect(e.embedder.calls.flat().length).toBe(17); // doc 1 embedded once, doc 2 once (the failed attempt never completed)
  });

  it('duplicate docKey in one request is invalid_input (I-11)', async () => {
    const e = env((d) => createMachineIngest(d as never));
    await expect(e.run({ sources: [{ path: miniSourcePath(1, 'gas') }, { path: miniSourcePath(1, 'gas') }] })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
void MINI_DOCS; void miniArtifactPath;
