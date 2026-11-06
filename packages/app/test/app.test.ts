import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KgError, l2normalize, type Embedder, type Llm, type LlmRequest } from '@kg/kernel';
import { TOOLS, callTool, createMcpServer, createViewerServer, main, openKg, type AppOptions } from '../src';

const dirs: string[] = [];
const tmp = () => (dirs[dirs.push(mkdtempSync(join(tmpdir(), 'kg-app-'))) - 1]!);
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
let asked = 0;
const llm: Llm = {
  async complete(r: LlmRequest) {
    asked++;
    const text = r.purpose === 'eval-judge' ? '{"score":1,"rationale":"same facts"}' : r.purpose === 'eval-answer' ? 'SQLite.' : r.purpose === 'eval-generate' ? JSON.stringify({ questions: [{ question: `Which storage engine holds the records for the project, variant ${asked}?`, referenceAnswer: 'SQLite.', type: 'single-hop' }] }) : '{"facts":[]}';
    return { text, model: r.model, inputTokens: 1, outputTokens: 1 };
  },
};
const open = (o: AppOptions) => openKg({ ...o, embedder, llm });

function cli(db: string) {
  const lines: string[] = [];
  const errs: string[] = [];
  const run = async (...args: string[]) => ({ code: await main([...args, '--db', db], { out: (s) => lines.push(s), err: (s) => errs.push(s) }, { open }), out: lines.splice(0).join('\n'), err: errs.splice(0).join('\n') });
  return run;
}
const spaceCfg = { space: { model: 'fake', digest: 'fake', dims: 64, documentTemplate: '{text}', queryTemplate: '{query}' } };

async function project() {
  const db = join(tmp(), 'db');
  const run = cli(db);
  await run('init');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(db, 'kg.json'), JSON.stringify({ ...spaceCfg, searchMachine: 'current-state' }));
  await run('add', FIXTURE, '--adapter', 'decision-log', '--doc-key', 'decisions');
  await run('ingest');
  return { db, run };
}

describe('the command line', () => {
  it('creates a database, ingests a source, searches with a machine, and reports a clean audit', async () => {
    const { db, run } = await project();
    expect(JSON.parse(readFileSync(join(db, 'kg.json'), 'utf8')).sources).toHaveLength(1);
    const s = await run('search', 'what is the project store', '-k', '3');
    expect(s).toMatchObject({ code: 0 });
    expect(s.out).toMatch(/current-state/);
    expect(s.out).toContain('Store is SQLite');
    expect(s.out).not.toContain('Store is JSON files');
    const st = await run('status');
    expect(st.out).toMatch(/currentChunks\s+7/);
    expect(st.out).toMatch(/audit\s+clean/);
    expect((await run('machines')).out).toMatch(/facts-and-neighbours@1[\s\S]*expand: expand-by-names → cite/);
  });

  it('keeps a confirmed correction across a rebuild, and diff compares the new index with the kept old one', async () => {
    const { db, run } = await project();
    expect((await run('correct', 'alias', 'SQLite DB', 'SQLite', '--note', 'same thing')).code).toBe(0);
    expect((await run('corrections')).out).toMatch(/alias-of  sqlite db → sqlite/);
    const r = await run('rebuild', '--keep-old');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/rebuilt ix_\S+ → ix_\S+ \(old index kept at/);
    const old = /kept at (\S+)\)/.exec(r.out)![1]!;
    expect(existsSync(old)).toBe(true);
    const d = await run('diff', old);
    expect(d.out).toMatch(/chunks: 7 shared, 0 only in A, 0 only in B/);
    const { openKg: o } = await import('../src');
    const kg = o({ db, embedder, llm });
    expect(kg.index.canonicalName('sqlite db')).toBe('sqlite');
    expect(kg.history.eventsOfType('rebuild.finished')).toHaveLength(1);
    kg.close();
  });

  it('generates and runs an evaluation, and reports bad input with a code and exit status 1', async () => {
    const { run } = await project();
    const out = join(tmp(), 'set.json');
    const g = await run('eval', 'generate', out, '--single', '2', '--multi', '0', '--topic', '0', '--seed', '3', '--min-chars', '20');
    expect(g.out).toMatch(/\d questions written/);
    const e = await run('eval', 'run', out, '--conditions', 'no-context,gold,retrieved,current-state', '--ks', '1,3');
    expect(e.code).toBe(0);
    expect(e.out).toMatch(/gold\s+judge 1\.00/);
    expect(e.out).toMatch(/current-state\s+judge 1\.00.*recall @1 \d\.\d\d @3 \d\.\d\d/);
    const bad = await run('search');
    expect(bad).toMatchObject({ code: 1 });
    expect(bad.err).toMatch(/invalid_input: search needs a query/);
    expect((await main(['nonsense'], { out() {}, err() {} })).valueOf()).toBe(2);
  });
});

describe('the MCP tools', () => {
  it('search, then feedback keyed to chunk IDs, usage and outcome; a bad call fails with a code and is logged', async () => {
    const { db } = await project();
    const kg = open({ db });
    const session = kg.history.openSession({ kind: 'agent', label: 'test' });
    const r = (await callTool(kg, session, 'search', { query: 'what is the project store', k: 2 })) as { searchId: string; items: { id: string; sourceChunkIds: string[] }[] };
    expect(r.items).toHaveLength(2);
    await callTool(kg, session, 'feedback', { searchId: r.searchId, relevance: 0.9, itemId: r.items[0]!.id, note: 'exactly it' });
    const fb = kg.history.eventsOfType('feedback')[0]!.payload as { chunkIds: string[]; relevance: number };
    expect(fb).toMatchObject({ relevance: 0.9, chunkIds: r.items[0]!.sourceChunkIds });
    await callTool(kg, session, 'report_usage', { searchId: r.searchId, usedItemIds: [r.items[0]!.id] });
    await callTool(kg, session, 'report_outcome', { searchId: r.searchId, worked: true });
    await expect(callTool(kg, session, 'feedback', { searchId: 'sr_nope', relevance: 0.5 })).rejects.toThrow(/no search/);
    await expect(callTool(kg, session, 'feedback', { searchId: r.searchId, relevance: 2 })).rejects.toThrow(/between 0 and 1/);
    await expect(callTool(kg, session, 'search', { query: 5 })).rejects.toThrow(KgError);
    expect(kg.history.eventsOfType('tool.failed').map((e) => (e.payload as { code: string }).code)).toEqual(['invalid_input', 'invalid_input', 'not_found']);
    const status = (await callTool(kg, session, 'status', {})) as { currentChunks: number; machines: string[] };
    expect(status.currentChunks).toBe(7);
    const chunks = (await callTool(kg, session, 'get_chunks', { ids: [r.items[0]!.id] })) as { text: string }[];
    expect(chunks[0]!.text).toMatch(/^## /);
    kg.close();
  });

  it('serves the same tools over the protocol, one session per connection', async () => {
    const { db } = await project();
    const kg = open({ db });
    const server = createMcpServer(kg);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-agent', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    const res = (await client.callTool({ name: 'search', arguments: { query: 'what is the project store', k: 1 } })) as { isError?: boolean; structuredContent?: { items: unknown[] } };
    expect(res.structuredContent!.items).toHaveLength(1);
    const bad = (await client.callTool({ name: 'search', arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/invalid_input/);
    expect(kg.history.sessions().filter((s) => s.kind === 'agent')).toHaveLength(1);
    expect(kg.history.sessions().find((s) => s.kind === 'agent')!.label).toBe('test-agent');
    await client.close();
    kg.close();
  });
});

describe('the viewer', () => {
  it('lists sessions and their events, resolves result text, takes a note, and refuses another host', async () => {
    const { db } = await project();
    const kg = open({ db });
    const session = kg.history.openSession({ kind: 'agent', label: 'viewed' });
    const r = (await callTool(kg, session, 'search', { query: 'what is the project store', k: 2 })) as { items: { id: string }[] };
    const server = createViewerServer(kg);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = async (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers });
    const page = await get('/');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain('<title>kg sessions</title>');
    const sessions = (await (await get('/api/sessions')).json()) as { sessionId: string; label: string; events: number }[];
    expect(sessions.find((s) => s.sessionId === session)).toMatchObject({ label: 'viewed' });
    const events = (await (await get(`/api/sessions/${session}/events`)).json()) as { events: { type: string; seq: number }[] };
    expect(events.events.map((e) => e.type)).toContain('search.result');
    const after = (await (await get(`/api/sessions/${session}/events?after=${events.events.at(-1)!.seq}`)).json()) as { events: unknown[] };
    expect(after.events).toEqual([]);
    const recs = (await (await get(`/api/records?ids=${r.items.map((i) => i.id).join(',')},../../etc`)).json()) as { text: string }[];
    expect(recs).toHaveLength(2);
    const note = await fetch(`${base}/api/sessions/${session}/notes`, { method: 'POST', body: JSON.stringify({ text: 'looks right' }) });
    expect(note.status).toBe(200);
    expect(kg.history.notes(session)).toMatchObject([{ text: 'looks right' }]);
    expect((await fetch(`${base}/api/sessions/${session}/notes`, { method: 'POST', body: JSON.stringify({ text: '' }) })).status).toBe(400);
    const raw = await new Promise<number>((done) => {
      const r = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/api/sessions', headers: { host: 'evil.example' } }, (res) => (res.resume(), done(res.statusCode!)));
      r.end();
    });
    expect(raw).toBe(403);
    expect((await get('/nope')).status).toBe(404);
    expect(((await (await get('/api/machines')).json()) as { name: string }[]).map((m) => m.name)).toContain('current-state');
    await new Promise((done) => server.close(done));
    kg.close();
  });
});
