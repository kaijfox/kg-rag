import { KgError, l2normalize, type Embedder } from '@kg/core';

export interface OllamaEmbedderOptions {
  /** Ollama server root, without a trailing path. Default http://localhost:11434. */
  baseUrl?: string;
  /** Texts per /api/embed request. Default 32. */
  batchSize?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Expected model digest (hex, no prefix, as Ollama reports it in /api/tags). When given, the embedder checks
   * the installed model once, before its first embedding request, and refuses to embed on a mismatch.
   */
  digest?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_BATCH_SIZE = 32;

/**
 * Embedder backed by a local Ollama server (POST /api/embed). Texts must already be conditioned by core;
 * this function adds no prefixes. Vectors are L2-normalized and checked against `dims`.
 */
export function ollamaEmbedder(model: string, dims: number, o: OllamaEmbedderOptions = {}): Embedder {
  if (!Number.isInteger(dims) || dims <= 0) throw new KgError('invalid_input', `dims must be a positive integer, got ${dims}`);
  const batchSize = o.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new KgError('invalid_input', `batchSize must be a positive integer, got ${batchSize}`);
  }
  const baseUrl = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch: typeof fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const expectedDigest = o.digest?.toLowerCase();
  let digestOk: Promise<void> | undefined;

  const verifyDigest = (): Promise<void> => {
    if (expectedDigest === undefined) return Promise.resolve();
    // Only a successful check is cached; a failed one is retried on the next call.
    digestOk ??= checkDigest(doFetch, baseUrl, model, expectedDigest).catch((e: unknown) => {
      digestOk = undefined;
      throw e;
    });
    return digestOk;
  };

  const embedBatch = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const url = `${baseUrl}/api/embed`;
    const body = JSON.stringify({ model, input: texts, truncate: false });
    const res = await postJson(doFetch, url, body);
    const embeddings = (res as { embeddings?: unknown }).embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new KgError('upstream', `Ollama returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} embeddings for ${texts.length} texts`);
    }
    return embeddings.map((raw, i) => {
      if (!Array.isArray(raw) || raw.length !== dims || !raw.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new KgError('upstream', `Ollama vector ${i} is not ${dims} finite numbers`, { got: Array.isArray(raw) ? raw.length : -1 });
      }
      return l2normalize(Float32Array.from(raw as number[]));
    });
  };

  return {
    model,
    dims,
    async embed(texts: readonly string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      await verifyDigest();
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        out.push(...(await embedBatch(texts.slice(i, i + batchSize))));
      }
      return out;
    },
  };
}

async function postJson(doFetch: typeof fetch, url: string, body: string): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch (e) {
    throw new KgError('upstream', `Ollama request to ${url} failed: ${errText(e)}`);
  }
  if (!res.ok) {
    const detail = await errorDetail(res);
    // truncate:false makes Ollama refuse an input longer than the model context instead of embedding its head only
    const tooLong = /context length|too long|exceeds/i.test(detail);
    throw new KgError('upstream', `Ollama ${url} responded ${res.status}${tooLong ? ' (input exceeds the model context length)' : ''}${detail ? `: ${detail}` : ''}`, {
      status: res.status,
      ...(tooLong ? { contextLength: true } : {}),
    });
  }
  try {
    return await res.json();
  } catch (e) {
    throw new KgError('upstream', `Ollama ${url} returned a body that is not JSON: ${errText(e)}`);
  }
}

async function checkDigest(doFetch: typeof fetch, baseUrl: string, model: string, expected: string): Promise<void> {
  const url = `${baseUrl}/api/tags`;
  let res: Response;
  try {
    res = await doFetch(url);
  } catch (e) {
    throw new KgError('upstream', `Ollama request to ${url} failed: ${errText(e)}`);
  }
  if (!res.ok) throw new KgError('upstream', `Ollama ${url} responded ${res.status}`, { status: res.status });
  let tags: unknown;
  try {
    tags = await res.json();
  } catch (e) {
    throw new KgError('upstream', `Ollama ${url} returned a body that is not JSON: ${errText(e)}`);
  }
  const models = (tags as { models?: unknown }).models;
  const entry = Array.isArray(models)
    ? (models as Array<{ name?: unknown; digest?: unknown }>).find((m) => m.name === model)
    : undefined;
  if (!entry) throw new KgError('precondition', `model ${model} is not installed in Ollama`);
  const actual = typeof entry.digest === 'string' ? entry.digest.toLowerCase() : '';
  if (actual !== expected) {
    throw new KgError('precondition', `model ${model} has digest ${actual || '(none)'}, expected ${expected}`, {
      expected,
      actual,
    });
  }
}

/** The body of a failed response, as text (Ollama sends `{"error": "..."}`), cut to 300 characters. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    try {
      const err = (JSON.parse(raw) as { error?: unknown }).error;
      if (typeof err === 'string') return err.slice(0, 300);
    } catch {
      // not JSON: use the raw text
    }
    return raw.slice(0, 300);
  } catch {
    return '';
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
