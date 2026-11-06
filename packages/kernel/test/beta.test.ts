import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheStore, HistoryStore, IndexStore, KgError, cachedLlm, FORMAT_VERSION, type Llm, type LlmRequest } from '../src';

const dirs: string[] = [];
const tmp = () => (dirs[dirs.push(mkdtempSync(join(tmpdir(), 'kg-kernel-beta-'))) - 1]!);
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const req = (n: number): LlmRequest => ({ purpose: 'extract-facts', model: 'm', system: 's', messages: [{ role: 'user', content: `passage ${n}` }], temperature: 0, maxTokens: 10 });
const counting = (): Llm & { calls: number } => {
  const l = { calls: 0, async complete(r: LlmRequest) { l.calls++; return { text: `reply ${r.messages[0]!.content}`, model: r.model, inputTokens: 1, outputTokens: 1 }; } };
  return l;
};

describe('moving model responses between machines', () => {
  it('imports the responses another cache holds, once, and keeps what it already had', () => {
    const a = CacheStore.open(join(tmp(), 'a.sqlite'));
    const inner = counting();
    const llmA = cachedLlm(inner, a);
    return Promise.all([llmA.complete(req(1)), llmA.complete(req(2))]).then(() => {
      const file = join(tmp(), 'copy.sqlite');
      a.backupTo(file);
      const b = CacheStore.open(join(tmp(), 'b.sqlite'));
      expect(b.importFrom(file)).toEqual({ added: 2, alreadyHad: 0 });
      expect(b.importFrom(file)).toEqual({ added: 0, alreadyHad: 2 });
      expect(b.stats().entries).toBe(2);
      a.close();
      b.close();
    });
  });

  it('refuses a file that is not a cache', () => {
    const odd = join(tmp(), 'odd.sqlite');
    const db = new Database(odd);
    db.exec('CREATE TABLE other (x)');
    db.close();
    const c = CacheStore.open(join(tmp(), 'c.sqlite'));
    expect(() => c.importFrom(odd)).toThrow(/not a kg cache file/);
    c.close();
  });

  it('with cacheOnly a request the cache lacks is an error and no model is called', async () => {
    const cache = CacheStore.open(join(tmp(), 'd.sqlite'));
    const inner = counting();
    await cachedLlm(inner, cache).complete(req(1));
    const offline = counting();
    const llm = cachedLlm(offline, cache, { cacheOnly: true });
    expect((await llm.complete(req(1))).cached).toBe(true);
    await expect(llm.complete(req(2))).rejects.toThrow(/cache has no response/);
    expect(offline.calls).toBe(0);
    cache.close();
  });
});

describe('the history', () => {
  it('counts the model calls of a session and how many the cache answered', () => {
    const h = HistoryStore.open(join(tmp(), 'h.sqlite'));
    const s = h.openSession({ kind: 'ingest' });
    h.append(s, 'llm.called', { cached: false });
    h.append(s, 'llm.called', { cached: true });
    h.append(s, 'llm.called', { cached: true });
    expect(h.llmCalls(s)).toEqual({ made: 1, cached: 2 });
    h.close();
  });
});

describe('the database format', () => {
  it('stamps a new index and refuses one written by a newer program', () => {
    const path = join(tmp(), 'index.sqlite');
    const ix = IndexStore.open(path);
    expect(ix.getMeta('format')).toBe(String(FORMAT_VERSION));
    ix.close();
    const db = new Database(path);
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'format'`).run(String(FORMAT_VERSION + 1));
    db.close();
    expect(() => IndexStore.open(path)).toThrow(KgError);
    expect(() => IndexStore.open(path)).toThrow(/newer than this program reads/);
  });
});
