import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KG_VERSION, l2normalize, type Embedder } from '@kg/kernel';
import { ingest } from '@kg/modules';
import { INSTRUCTIONS, buildReport, callTool, createMcpServer, exportDatabase, formatDoctor, formatReport, main, openKg, runDoctor, watchSources, type AppOptions } from '../src';

const dirs: string[] = [];
const tmp = () => (dirs[dirs.push(mkdtempSync(join(tmpdir(), 'kg-beta-'))) - 1]!);
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const FIXTURE = resolve(__dirname, '../../modules/test/fixtures/log.md');

const embedder: Embedder = {
  model: 'fake', dims: 64,
  async embed(texts) {
    return texts.map((t) => {
      const v = new Float32Array(64);
      for (const w of t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
        let h = 7;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % 64]! += 1;
      }
      return l2normalize(v);
    });
  },
};
const open = (o: AppOptions) => openKg({ ...o, embedder });
const spaceCfg = { space: { model: 'fake', digest: 'fake', dims: 64, documentTemplate: '{text}', queryTemplate: '{query}' } };

function cli(db: string) {
  const lines: string[] = [];
  const errs: string[] = [];
  return async (...args: string[]) => ({ code: await main([...args, '--db', db], { out: (s) => lines.push(s), err: (s) => errs.push(s) }, { open }), out: lines.splice(0).join('\n'), err: errs.splice(0).join('\n') });
}

async function project(machine = 'current-state') {
  const db = join(tmp(), 'db');
  const run = cli(db);
  await run('init');
  writeFileSync(join(db, 'kg.json'), JSON.stringify({ ...spaceCfg, searchMachine: machine }));
  await run('add', FIXTURE, '--adapter', 'decision-log', '--doc-key', 'decisions');
  await run('ingest');
  return { db, run };
}

describe('seeing how the system was used', () => {
  it('an agent session shows up in the report, with the comparison against the baseline', async () => {
    const { db } = await project();
    const kg = open({ db });
    const session = kg.history.openSession({ kind: 'agent', label: 'tester' });
    const r = (await callTool(kg, session, 'search', { query: 'what is the project store', k: 3 })) as { searchId: string; items: { id: string }[] };
    await callTool(kg, session, 'report_usage', { searchId: r.searchId, usedItemIds: [r.items[0]!.id] });
    await callTool(kg, session, 'feedback', { searchId: r.searchId, relevance: 0.9 });
    await callTool(kg, session, 'report_outcome', { searchId: r.searchId, worked: true });
    const bad = (await callTool(kg, session, 'search', { query: 'how is the viewer drawn', k: 2 })) as { searchId: string };
    await callTool(kg, session, 'feedback', { searchId: bad.searchId, relevance: 0.1, note: 'nothing about drawing' });

    const report = buildReport(kg);
    expect(report).toMatchObject({ agentSessions: 1, searches: 2, rated: 2, outcomes: { worked: 1, failed: 0 } });
    expect(report.shadow.searches).toBe(2);
    expect(report.shadow.machine).toBe('chunk-search');
    expect(report.shadow.used).toBeGreaterThan(0);
    expect(report.failed.map((f) => f.query)).toEqual(['how is the viewer drawn']);
    const text = formatReport(report);
    expect(text).toMatch(/compared with chunk-search on 2 searches/);
    expect(text).toMatch(/nothing about drawing/);
    kg.close();
  });

  it('exports the history and the index, or only the history when no text may leave', async () => {
    const { db } = await project();
    const kg = open({ db });
    const s = kg.history.openSession({ kind: 'agent' });
    await callTool(kg, s, 'search', { query: 'what is the project store' });
    const full = exportDatabase(kg, join(tmp(), 'full'));
    expect(full.files.sort()).toEqual(['export.json', 'history.sqlite', 'index.sqlite', 'kg.json']);
    const manifest = JSON.parse(readFileSync(join(full.dir, 'export.json'), 'utf8'));
    expect(manifest).toMatchObject({ format: 'kg-export/1', kg: KG_VERSION, textIncluded: true, searches: 1 });

    const bare = exportDatabase(kg, join(tmp(), 'bare'), { noText: true });
    expect(existsSync(join(bare.dir, 'index.sqlite'))).toBe(false);
    expect(JSON.parse(readFileSync(join(bare.dir, 'kg.json'), 'utf8')).sources[0].path).toBe('log.md');
    expect(() => exportDatabase(kg, bare.dir)).toThrow(/already exists/);

    // the exported folder is itself a database that the viewer and report can open
    const copy = open({ db: full.dir });
    expect(buildReport(copy).searches).toBe(1);
    copy.close();
    kg.close();
  });
});

describe('questions from real use', () => {
  it('turns used results into gold, lists bad searches for labelling, and measures retrieval without a model', async () => {
    const { db, run } = await project();
    const kg = open({ db });
    const session = kg.history.openSession({ kind: 'agent' });
    const good = (await callTool(kg, session, 'search', { query: 'what is the project store', k: 3 })) as { searchId: string; items: { id: string; sourceChunkIds: string[] }[] };
    await callTool(kg, session, 'report_usage', { searchId: good.searchId, usedItemIds: [good.items[0]!.id] });
    const poor = (await callTool(kg, session, 'search', { query: 'how are diagrams drawn', k: 3 })) as { searchId: string };
    await callTool(kg, session, 'feedback', { searchId: poor.searchId, relevance: 0.1, note: 'wrong entries' });
    kg.close();

    const out = join(tmp(), 'logged.json');
    const made = await run('eval', 'from-log', out);
    expect(made.out).toMatch(/1 questions from searches whose results an agent used/);
    expect(made.out).toMatch(/1 searches went badly/);
    const set = JSON.parse(readFileSync(out, 'utf8'));
    expect(set.questions[0]).toMatchObject({ type: 'logged', question: 'what is the project store', goldChunkIds: good.items[0]!.sourceChunkIds });

    const unlabelled = JSON.parse(readFileSync(`${out}.unlabelled.json`, 'utf8'));
    expect(unlabelled[0]).toMatchObject({ question: 'how are diagrams drawn', note: 'wrong entries', goldChunkIds: [] });
    expect(unlabelled[0].retrieved.length).toBeGreaterThan(0);
    unlabelled[0].goldChunkIds = [unlabelled[0].retrieved[0].chunkId];
    writeFileSync(`${out}.unlabelled.json`, JSON.stringify(unlabelled));
    expect((await run('eval', 'label', out, `${out}.unlabelled.json`)).out).toMatch(/added 1 questions/);
    expect(JSON.parse(readFileSync(out, 'utf8')).questions).toHaveLength(2);

    // no model is configured to answer, and none is needed
    const e = await run('eval', 'run', out, '--retrieval-only', '--conditions', 'chunk-search,current-state', '--ks', '1,3');
    expect(e.code).toBe(0);
    expect(e.out).toMatch(/chunk-search\s+judge —.*recall @1 \d\.\d\d @3 \d\.\d\d/);
    const bad = await run('eval', 'run', out, '--retrieval-only', '--conditions', 'gold');
    expect(bad.err).toMatch(/does not retrieve/);
  });
});

describe('moving extraction between machines, from the command line', () => {
  it('exports a cache and imports it into another database', async () => {
    const a = await project();
    const file = join(tmp(), 'cache-copy.sqlite');
    const ka = open({ db: a.db });
    ka.cache.put('k1', 'extract-facts', '{"text":"x"}');
    ka.close();
    expect((await a.run('cache', 'export', file)).out).toMatch(/wrote .* \(1 responses\)/);
    expect((await a.run('cache', 'export', file)).code).toBe(1);
    const b = await project();
    expect((await b.run('cache', 'import', file)).out).toBe('added 1 responses, 0 were already here');
    expect((await b.run('cache', 'import', file)).out).toBe('added 0 responses, 1 were already here');
    expect((await b.run('cache', 'stats')).out).toMatch(/^1 responses/);
  });
});

describe('starting a database', () => {
  it('turns extraction on and compares against the baseline, unless asked for plain search', async () => {
    const run = cli(join(tmp(), 'a'));
    const made = await run('init');
    expect(made.out).toMatch(/extraction on \(needs qwen3\.5:latest.*searches use facts-and-neighbours, with chunk-search logged beside them/);
    const again = await run('init');
    expect(again.out).toMatch(/already existed/);
    const plain = cli(join(tmp(), 'b'));
    expect((await plain('init', '--baseline')).out).toMatch(/extraction off; searches use chunk-search/);
    const ledger = cli(join(tmp(), 'c'));
    expect((await ledger('init', '--machine', 'current-state')).out).toMatch(/searches use current-state/);
    expect((await cli(join(tmp(), 'd'))('init', '--machine', 'nope')).err).toMatch(/no machine nope/);
  });

  it('reads only the files of a folder whose names match the pattern', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/a'), { recursive: true });
    writeFileSync(join(dir, 'src/a/CODEMAP.md'), '# a\n\nThe a directory holds the parser.\n');
    writeFileSync(join(dir, 'src/a/NOTES.md'), '# notes\n\nNot a code map.\n');
    const db = join(dir, 'db');
    const run = cli(db);
    await run('init', '--baseline');
    writeFileSync(join(db, 'kg.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(db, 'kg.json'), 'utf8')), ...spaceCfg }));
    await run('add', join(dir, 'src'), '--adapter', 'markdown', '--pattern', '^CODEMAP\\.md$');
    const r = await run('ingest');
    expect(r.out).toContain('a › CODEMAP: ');
    expect(r.out).not.toContain('NOTES');
  });
});

describe('keeping the source list', () => {
  it('removes a source, and the next ingest retires its documents', async () => {
    const { run, db } = await project();
    expect((await run('remove', FIXTURE)).out).toMatch(/removed 1 source/);
    expect((await run('remove', FIXTURE)).code).toBe(1);
    const r = await run('ingest');
    expect(r.out).toMatch(/retired 1: decisions/);
    const kg = open({ db });
    expect(kg.index.stats()).toMatchObject({ currentChunks: 0, retiredDocuments: 1 });
    kg.close();
  });

  it('refuses to ingest a named file that does not exist', async () => {
    const { run } = await project();
    expect((await run('ingest', join(tmp(), 'nope.md'))).err).toMatch(/not_found: no file/);
  });

  it('reads a folder of HTML pages added with an exclude pattern', async () => {
    const dir = tmp();
    const site = join(dir, 'site');
    mkdirSync(site);
    writeFileSync(join(site, 'guide.html'), '<body><main><h1>Guide</h1><p>Connections time out after thirty seconds unless a longer timeout is set.</p></main></body>');
    writeFileSync(join(site, 'genindex.html'), '<body><h1>Index</h1><p>a b c</p></body>');
    const db = join(dir, 'db');
    const run = cli(db);
    await run('init', '--baseline');
    writeFileSync(join(db, 'kg.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(db, 'kg.json'), 'utf8')), ...spaceCfg }));
    await run('add', site, '--exclude', 'genindex');
    expect((await run('ingest')).out).toContain('guide: 1 chunks');
    expect((await run('search', 'how long until a connection times out', '-k', '1')).out).toContain('Guide');
    expect((await run('version')).out).toBe(`kg ${KG_VERSION} (database format 1)`);
  });
});

describe('what an agent client sees', () => {
  it('receives instructions on reporting, and the date and title of a log entry with its result', async () => {
    const { db } = await project();
    const kg = open({ db });
    const server = createMcpServer(kg);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'agent', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/report_usage/);
    const res = (await client.callTool({ name: 'search', arguments: { query: 'what is the project store', k: 1 } })) as unknown as { structuredContent: { items: { meta?: { date: string; title: string; embedText?: string } }[] } };
    expect(res.structuredContent.items[0]!.meta).toMatchObject({ date: '2026-04-02', title: expect.stringContaining('Store is SQLite') });
    expect(res.structuredContent.items[0]!.meta).not.toHaveProperty('entryKey');
    await client.close();
    kg.close();
  });
});

describe('checking an installation', () => {
  const tags = (models: object[]) => async () => ({ ok: true, json: async () => ({ models }) });

  it('passes when the models are present and says what to do when they are not', async () => {
    const { db } = await project();
    const kg = open({ db });
    const space = kg.config.space;
    kg.close();
    const good = await runDoctor({ db, fetch: tags([{ name: space.model, digest: space.digest }]) });
    expect(good.checks.find((c) => c.name === 'database')!.status).toBe('ok');
    expect(good.checks.find((c) => c.name === 'embedding model')!.status).toBe('ok');
    expect(good.checks.find((c) => c.name === 'sqlite-vec')!.status).toBe('ok');
    expect(formatDoctor(good)).toMatch(/claude mcp add kg -- .*kg serve mcp --db /);

    const wrong = await runDoctor({ db, fetch: tags([{ name: space.model, digest: 'deadbeef' }]) });
    expect(wrong.checks.find((c) => c.name === 'embedding model')).toMatchObject({ status: 'fail' });
    const none = await runDoctor({ db, fetch: tags([]) });
    expect(none.checks.find((c) => c.name === 'embedding model')!.detail).toMatch(/ollama pull/);
    const down = await runDoctor({ db: join(tmp(), 'nothing'), fetch: async () => { throw new Error('refused'); } });
    expect(down.checks.find((c) => c.name === 'ollama')!.status).toBe('fail');
    expect(down.checks.find((c) => c.name === 'database')!.detail).toMatch(/kg init/);
  });
});

describe('keeping an index current while a server runs', () => {
  it('reads the sources at once, then again after a change, once per burst', async () => {
    const dir = tmp();
    const notes = join(dir, 'notes');
    mkdirSync(notes);
    writeFileSync(join(notes, 'a.md'), '# A\n\nApples grow on trees.\n');
    const db = join(dir, 'db');
    await cli(db)('init');
    writeFileSync(join(db, 'kg.json'), JSON.stringify({ ...spaceCfg, sources: [{ path: notes, adapter: 'markdown' }] }));
    const kg = open({ db });
    let runs = 0;
    const watcher = watchSources(kg, async () => { runs++; await ingest(kg); }, { debounceMs: 60 });
    await watcher.idle();
    expect(runs).toBe(1);
    expect(kg.index.currentChunks()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(notes, 'b.md'), '# B\n\nBananas grow in bunches.\n');
    writeFileSync(join(notes, 'c.md'), '# C\n\nCherries have stones.\n');
    await new Promise((r) => setTimeout(r, 300));
    await watcher.idle();
    expect(runs).toBe(2);
    expect(kg.index.currentChunks()).toHaveLength(3);
    watcher.close();
    kg.close();
  });
});
