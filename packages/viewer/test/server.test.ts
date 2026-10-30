import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMachineMap, type EventEnvelope, type ItemId, type LogReader, type MachineMap } from '@kg/core';
import {
  InMemoryEventLog,
  loadMiniCorpus,
  logFixture,
  machineMapFixture,
  type LogFixture,
} from '@kg/testkit';
import { createViewerServer, type ViewerOptions } from '../src/index';
import { renderTimeline, textOf } from '../web/render.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

async function start(reader: LogReader, o: ViewerOptions = {}): Promise<string> {
  const server = createViewerServer(reader, { ...o, port: 0 });
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function get(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(base + path);
  const text = await r.text();
  return { status: r.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const FIXTURES: LogFixture[] = ['session-agent', 'session-eval', 'session-live-partial'];

describe('read endpoints equal the reader', () => {
  for (const name of FIXTURES) {
    it(`serves ${name} exactly as the reader returns it`, async () => {
      const envs = logFixture(name);
      const log = InMemoryEventLog.fromEnvelopes(envs);
      const base = await start(log);
      const sid = envs[0]!.sessionId;

      const sessions = await get(base, '/api/sessions');
      expect(sessions.status).toBe(200);
      expect(sessions.body).toEqual(plain(log.sessions()));

      const agentOnly = await get(base, '/api/sessions?kind=agent&limit=2');
      expect(agentOnly.body).toEqual(plain(log.sessions({ kind: 'agent', limit: 2 })));

      const all = await get(base, `/api/events?session=${sid}`);
      expect(all.body).toEqual(plain(log.events(sid)));
      expect((all.body as unknown[]).length).toBe(envs.length);

      const tail = await get(base, `/api/events?session=${sid}&after=5&limit=3`);
      expect(tail.body).toEqual(plain(log.events(sid, 5, 3)));

      const searchIds = [...new Set(envs.map((e) => e.searchId).filter((s): s is NonNullable<typeof s> => s !== null))];
      for (const id of searchIds) {
        const r = await get(base, `/api/search/${id}`);
        expect(r.body).toEqual(plain(log.eventsBySearch(id)));
      }

      const notes = await get(base, `/api/notes?session=${sid}`);
      expect(notes.body).toEqual(plain(log.notes(sid)));
    });
  }

  it('answers bad requests with error codes', async () => {
    const base = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')));
    expect((await get(base, '/api/events')).status).toBe(400);
    expect((await get(base, '/api/sessions?kind=bogus')).status).toBe(400);
    expect((await get(base, '/api/sessions?limit=0')).status).toBe(400);
    expect((await get(base, '/api/nope')).status).toBe(404);
    expect((await get(base, '/no-such-page')).status).toBe(404);
    const put = await fetch(`${base}/api/events?session=x`, { method: 'PUT' });
    expect(put.status).toBe(405);
  });

  it('serves the page and the vendored Mermaid bundle from its own origin', async () => {
    const base = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')));
    const page = await fetch(`${base}/`);
    const html = await page.text();
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('src="/vendor/mermaid.min.js"');
    expect(html).not.toMatch(/https?:\/\//);
    const mermaid = await fetch(`${base}/vendor/mermaid.min.js`);
    expect(mermaid.status).toBe(200);
    expect((await mermaid.text()).length).toBeGreaterThan(1_000_000);
  });
});

describe('live view', () => {
  it('after=<last seq> returns exactly the events appended since, in order', async () => {
    const envs = logFixture('session-live-partial');
    const log = InMemoryEventLog.fromEnvelopes(envs);
    const base = await start(log);
    const sid = envs[0]!.sessionId;
    const last = envs[envs.length - 1]!;

    const before = await get(base, `/api/events?session=${sid}&after=${last.seq}`);
    expect(before.body).toEqual([]);

    // The live search (sr_...07) is cut after its first step. Its remaining events are the agent fixture's events 30 to 33
    // (cut step, pipeline.finished, search.result, tool.returned), re-keyed onto the live session and search.
    const agent = logFixture('session-agent');
    const tail = agent.filter((e) => e.seq >= 30 && e.seq <= 33);
    const toolCalled = last.type === 'tool.called' ? last : envs.find((e) => e.type === 'tool.called' && e.seq === 10)!;
    for (const e of tail) {
      const { id: _id, seq: _seq, ts: _ts, schemaVersion: _sv, ...draft } = e;
      log.append({
        ...draft,
        sessionId: sid,
        searchId: e.searchId === null ? null : 'sr_00000000000000000000000007',
        buildId: e.buildId,
        parentId: toolCalled.id,
      } as never);
    }

    const after = await get(base, `/api/events?session=${sid}&after=${last.seq}`);
    const body = after.body as EventEnvelope[];
    expect(body).toEqual(plain(log.events(sid, last.seq)));
    expect(body.map((e) => e.seq)).toEqual([14, 15, 16, 17]);
    expect(body.map((e) => e.type)).toEqual(['search.step', 'pipeline.finished', 'search.result', 'tool.returned']);
    expect(body.filter((e) => e.type !== 'tool.returned').every((e) => e.searchId === 'sr_00000000000000000000000007')).toBe(true);

    const again = await get(base, `/api/events?session=${sid}&after=${body[body.length - 1]!.seq}`);
    expect(again.body).toEqual([]);
  });
});

describe('items', () => {
  it('returns what the stub itemInfo returns, and 404 for null', async () => {
    const itemInfo = (id: string) => (id === 'ch_known' ? { label: 'ThermoKardar#12', text: 'chunk text' } : null);
    const base = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')), { itemInfo });
    expect(await get(base, '/api/items/ch_known')).toEqual({ status: 200, body: { label: 'ThermoKardar#12', text: 'chunk text' } });
    expect((await get(base, '/api/items/ch_unknown')).status).toBe(404);
  });

  it('is 404 when no itemInfo was given', async () => {
    const base = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')));
    expect((await get(base, '/api/items/ch_known')).status).toBe(404);
  });

  it('the agent timeline shows mini-corpus labels, not raw item IDs', async () => {
    const mc = await loadMiniCorpus();
    const itemInfo = (id: string) => {
      const [item] = mc.store.getItems([id as ItemId]);
      return item ? { label: mc.labelOf(id), text: item.text } : null;
    };
    const envs = logFixture('session-agent');
    const visible = renderTimeline(envs, itemInfo).map((row) => textOf(row)).join(' ');
    const ids = new Set<string>();
    for (const e of envs) if (e.type === 'search.result') for (const i of (e.payload as { items: { itemId: string }[] }).items) ids.add(i.itemId);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      expect(visible).not.toContain(id);
      expect(visible).toContain(mc.labelOf(id));
    }
    expect(visible).toContain('entropy/2.1-d0');

    const base = await start(InMemoryEventLog.fromEnvelopes(envs), { itemInfo });
    const one = [...ids][0]!;
    expect(await get(base, `/api/items/${one}`)).toEqual({ status: 200, body: { label: mc.labelOf(one), text: mc.store.getItems([one as ItemId])[0]!.text } });
  });
});

describe('machines', () => {
  it('returns the map a stub returns, 404 for an unknown machine, 404 without a source', async () => {
    const fixture = machineMapFixture();
    expect(validateMachineMap(fixture)).toEqual([]);
    const machines = (m: string, v: string): MachineMap | null => (m === 'similarity' && v === '1' ? fixture : null);
    const base = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')), { machines });
    expect(await get(base, '/api/machines/similarity@1')).toEqual({ status: 200, body: fixture });
    expect((await get(base, '/api/machines/similarity@2')).status).toBe(404);
    expect((await get(base, '/api/machines/similarity')).status).toBe(400);

    const bare = await start(InMemoryEventLog.fromEnvelopes(logFixture('session-agent')));
    expect((await get(bare, '/api/machines/similarity@1')).status).toBe(404);
  });
});

describe('notes', () => {
  it('POST appends a note through the reader and GET returns it', async () => {
    const envs = logFixture('session-agent');
    const log = InMemoryEventLog.fromEnvelopes(envs);
    const base = await start(log);
    const sid = envs[0]!.sessionId;
    const posted = await fetch(`${base}/api/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, text: 'formula chunk ranks first' }),
    });
    expect(posted.status).toBe(201);
    const note = (await posted.json()) as { text: string };
    expect(note.text).toBe('formula chunk ranks first');
    const listed = await get(base, `/api/notes?session=${sid}`);
    expect(listed.body).toEqual(plain(log.notes(sid)));
    expect((listed.body as unknown[]).length).toBe(1);
    // the notes write appends no event
    expect(log.events(sid).length).toBe(envs.length);
  });

  it('rejects malformed bodies and empty text', async () => {
    const envs = logFixture('session-agent');
    const base = await start(InMemoryEventLog.fromEnvelopes(envs));
    const sid = envs[0]!.sessionId;
    const post = (body: string) => fetch(`${base}/api/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ sessionId: sid }))).status).toBe(400);
    expect((await post(JSON.stringify({ sessionId: sid, text: '  ' }))).status).toBe(400);
    expect((await post(JSON.stringify({ sessionId: 'se_missing', text: 'x' }))).status).toBe(404);
  });
});

/** A raw request, because fetch refuses to set Host and Origin. */
function raw(base: string, o: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method: o.method ?? 'GET', path: o.path, headers: o.headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}

describe('cross-site and rebinding protection', () => {
  const setup = async () => {
    const envs = logFixture('session-agent');
    const log = InMemoryEventLog.fromEnvelopes(envs);
    const base = await start(log);
    return { log, base, sid: envs[0]!.sessionId, n: envs.length };
  };

  it('a request whose Host is not loopback is refused, for the API and for the page', async () => {
    const { base, sid } = await setup();
    for (const path of ['/api/sessions', `/api/events?session=${sid}`, '/', '/app.js']) {
      expect((await raw(base, { path, headers: { host: 'attacker.test' } })).status, path).toBe(403);
      expect((await raw(base, { path, headers: { host: 'attacker.test:80' } })).status, path).toBe(403);
      expect((await raw(base, { path, headers: { host: '127.0.0.1.attacker.test' } })).status, path).toBe(403);
    }
    const port = new URL(base).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) expect((await raw(base, { path: '/api/sessions', headers: { host } })).status, host).toBe(200);
  });

  it('a POST with a foreign Origin is refused with 403 and writes nothing', async () => {
    const { base, sid, log } = await setup();
    const body = JSON.stringify({ sessionId: sid, text: 'x' });
    for (const origin of ['http://evil.example.com', 'null', 'http://127.0.0.1.evil.example.com']) {
      const r = await raw(base, { method: 'POST', path: '/api/notes', headers: { 'content-type': 'application/json', origin }, body });
      expect(r.status, origin).toBe(403);
    }
    expect(log.notes(sid)).toEqual([]);
    const ok = await raw(base, { method: 'POST', path: '/api/notes', headers: { 'content-type': 'application/json', origin: base }, body });
    expect(ok.status).toBe(201);
  });

  it('a POST that is not application/json is refused with 415 (the no-preflight text/plain form)', async () => {
    const { base, sid, log } = await setup();
    const body = JSON.stringify({ sessionId: sid, text: 'x' });
    for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }, {}] as Record<string, string>[]) {
      expect((await raw(base, { method: 'POST', path: '/api/notes', headers, body })).status, JSON.stringify(headers)).toBe(415);
    }
    expect(log.notes(sid)).toEqual([]);
    expect((await raw(base, { method: 'POST', path: '/api/notes', headers: { 'content-type': 'application/json; charset=utf-8' }, body })).status).toBe(201);
  });

  it('responses carry a content security policy and nosniff', async () => {
    const { base } = await setup();
    const r = await raw(base, { path: '/' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
