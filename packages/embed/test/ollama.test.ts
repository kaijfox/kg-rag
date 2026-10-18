import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@kg/testkit';
import { ollamaEmbedder } from '../src/index';

const DIMS = 16;
const hash = new HashEmbedder(DIMS);

type Call = { url: string; method?: string; body?: string };

/** A fake Ollama: /api/embed answers from HashEmbedder, /api/tags answers from `tags`. */
function fakeOllama(o: { tags?: unknown; tagsStatus?: number; embedStatus?: number; embedBody?: unknown; dims?: number } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method, body: init?.body });
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify(o.tags ?? { models: [] }), { status: o.tagsStatus ?? 200 });
    }
    if (o.embedStatus && o.embedStatus !== 200) return new Response('boom', { status: o.embedStatus });
    if (o.embedBody !== undefined) return new Response(JSON.stringify(o.embedBody), { status: 200 });
    const { input } = JSON.parse(init!.body!) as { input: string[] };
    const vs = await hash.embed(input);
    const embeddings = vs.map((v) => Array.from(v, (x) => x * 2).slice(0, o.dims ?? DIMS));
    return new Response(JSON.stringify({ embeddings }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

const embedCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/api/embed'));

describe('ollamaEmbedder request shape', () => {
  it('posts model and input to /api/embed under baseUrl, trailing slash removed', async () => {
    const f = fakeOllama();
    const e = ollamaEmbedder('m:1', DIMS, { baseUrl: 'http://ollama.test:11434/', fetch: f.fetch });
    await e.embed(['a', 'b']);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('http://ollama.test:11434/api/embed');
    expect(f.calls[0]!.method).toBe('POST');
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ model: 'm:1', input: ['a', 'b'], truncate: false });
  });

  it('a 3-text batch with batchSize 2 makes two requests and keeps order', async () => {
    const f = fakeOllama();
    const e = ollamaEmbedder('m:1', DIMS, { batchSize: 2, fetch: f.fetch });
    const out = await e.embed(['x', 'y', 'z']);
    const reqs = embedCalls(f.calls);
    expect(reqs).toHaveLength(2);
    expect(JSON.parse(reqs[0]!.body!).input).toEqual(['x', 'y']);
    expect(JSON.parse(reqs[1]!.body!).input).toEqual(['z']);
    const expected = await hash.embed(['x', 'y', 'z']);
    out.forEach((v, i) => {
      for (let k = 0; k < DIMS; k++) expect(Math.abs(v[k]! - expected[i]![k]!)).toBeLessThan(1e-5);
    });
  });

  it('default batch size is 32', async () => {
    const f = fakeOllama();
    const e = ollamaEmbedder('m:1', DIMS, { fetch: f.fetch });
    await e.embed(Array.from({ length: 33 }, (_, i) => `t${i}`));
    expect(embedCalls(f.calls)).toHaveLength(2);
  });

  it('embed([]) makes no request', async () => {
    const f = fakeOllama();
    expect(await ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed([])).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
});

describe('ollamaEmbedder failures', () => {
  it('a 500 response rejects with upstream', async () => {
    const f = fakeOllama({ embedStatus: 500 });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a'])).rejects.toMatchObject({ code: 'upstream' });
  });

  it('a context-length refusal (truncate:false) rejects with upstream and carries Ollama text', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: 'the input length exceeds the context length' }), { status: 400 })) as unknown as typeof fetch;
    const err = await ollamaEmbedder('m:1', DIMS, { fetch: fetchFn }).embed(['a']).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'upstream', details: { status: 400, contextLength: true } });
    expect((err as Error).message).toContain('exceeds the context length');
  });

  it('a non-2xx message keeps the response text', async () => {
    const f = fakeOllama({ embedStatus: 500 });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a'])).rejects.toThrow(/responded 500: boom/);
  });

  it('a network error rejects with upstream', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: fetchFn }).embed(['a'])).rejects.toMatchObject({ code: 'upstream' });
  });

  it('a wrong dimension rejects with upstream', async () => {
    const f = fakeOllama({ dims: DIMS - 1 });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a'])).rejects.toMatchObject({ code: 'upstream' });
  });

  it('a response with the wrong number of vectors rejects with upstream', async () => {
    const f = fakeOllama({ embedBody: { embeddings: [Array(DIMS).fill(1)] } });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a', 'b'])).rejects.toMatchObject({ code: 'upstream' });
  });

  it('non-numeric vector entries reject with upstream', async () => {
    const f = fakeOllama({ embedBody: { embeddings: [Array(DIMS).fill('x')] } });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a'])).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('ollamaEmbedder digest check', () => {
  const DIGEST = 'abcdef0123';
  const tags = (name: string, digest: string) => ({ models: [{ name, digest }] });

  it('embeds when the installed digest matches', async () => {
    const f = fakeOllama({ tags: tags('m:1', DIGEST) });
    const e = ollamaEmbedder('m:1', DIMS, { fetch: f.fetch, digest: DIGEST });
    await e.embed(['a']);
    await e.embed(['b']);
    expect(f.calls.filter((c) => c.url.endsWith('/api/tags'))).toHaveLength(1);
    expect(embedCalls(f.calls)).toHaveLength(2);
  });

  it('refuses to embed on a digest mismatch, before any embedding request', async () => {
    const f = fakeOllama({ tags: tags('m:1', '999999') });
    const e = ollamaEmbedder('m:1', DIMS, { fetch: f.fetch, digest: DIGEST });
    await expect(e.embed(['a'])).rejects.toMatchObject({ code: 'precondition' });
    expect(embedCalls(f.calls)).toHaveLength(0);
  });

  it('refuses when the model is not installed', async () => {
    const f = fakeOllama({ tags: tags('other:1', DIGEST) });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch, digest: DIGEST }).embed(['a'])).rejects.toMatchObject({
      code: 'precondition',
    });
  });

  it('a failing /api/tags request is upstream', async () => {
    const f = fakeOllama({ tagsStatus: 503 });
    await expect(ollamaEmbedder('m:1', DIMS, { fetch: f.fetch, digest: DIGEST }).embed(['a'])).rejects.toMatchObject({
      code: 'upstream',
    });
  });

  it('without digest there is no /api/tags request', async () => {
    const f = fakeOllama();
    await ollamaEmbedder('m:1', DIMS, { fetch: f.fetch }).embed(['a']);
    expect(f.calls.some((c) => c.url.endsWith('/api/tags'))).toBe(false);
  });
});
