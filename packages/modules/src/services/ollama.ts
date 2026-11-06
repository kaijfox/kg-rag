/** Local Ollama clients: embeddings (POST /api/embed) and chat completion (POST /api/chat), as kernel interfaces. */
import { KgError, l2normalize, type Embedder, type Llm, type LlmRequest, type LlmResponse } from '@kg/kernel';

const BASE = 'http://localhost:11434';
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface OllamaEmbedderOptions {
  baseUrl?: string;
  batchSize?: number;
  /** expected model digest (hex); checked once before the first request */
  digest?: string;
}

export function ollamaEmbedder(model: string, dims: number, o: OllamaEmbedderOptions = {}): Embedder {
  const base = (o.baseUrl ?? BASE).replace(/\/+$/, '');
  const batch = o.batchSize ?? 32;
  let checked: Promise<void> | undefined;
  const verify = () => {
    if (!o.digest) return Promise.resolve();
    checked ??= (async () => {
      const res = await fetch(`${base}/api/tags`).catch((e) => { throw new KgError('upstream', `Ollama unreachable at ${base}: ${text(e)}`); });
      const tags = (await res.json()) as { models?: { name?: string; digest?: string }[] };
      const entry = tags.models?.find((m) => m.name === model);
      if (!entry) throw new KgError('precondition', `model ${model} is not installed in Ollama`);
      if ((entry.digest ?? '').toLowerCase() !== o.digest!.toLowerCase()) throw new KgError('precondition', `model ${model} has digest ${entry.digest}, expected ${o.digest}`);
    })().catch((e) => { checked = undefined; throw e; });
    return checked;
  };
  return {
    model,
    dims,
    async embed(texts) {
      if (texts.length === 0) return [];
      await verify();
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batch) {
        const part = texts.slice(i, i + batch);
        const res = await fetch(`${base}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: part, truncate: false }) }).catch((e) => {
          throw new KgError('upstream', `Ollama request failed: ${text(e)}`);
        });
        if (!res.ok) throw new KgError('upstream', `Ollama /api/embed responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as { embeddings?: number[][] };
        if (!Array.isArray(body.embeddings) || body.embeddings.length !== part.length) throw new KgError('upstream', 'Ollama returned the wrong number of embeddings');
        for (const v of body.embeddings) {
          if (v.length !== dims) throw new KgError('upstream', `Ollama vector has ${v.length} dims, expected ${dims}`);
          out.push(l2normalize(Float32Array.from(v)));
        }
      }
      return out;
    },
  };
}

export function ollamaLlm(o: { baseUrl?: string; timeoutMs?: number } = {}): Llm {
  const base = (o.baseUrl ?? BASE).replace(/\/+$/, '');
  const timeout = o.timeoutMs ?? 300_000;
  return {
    async complete(r: LlmRequest): Promise<LlmResponse> {
      const send = () =>
        fetch(`${base}/api/chat`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeout),
          body: JSON.stringify({
            model: r.model,
            stream: false,
            think: false,
            ...(r.json ? { format: 'json' } : {}),
            options: { temperature: r.temperature, num_predict: r.maxTokens },
            messages: [{ role: 'system', content: r.system }, ...r.messages],
          }),
        });
      // one retry: a long run on a laptop sometimes loses a call to a stall or sleep
      const res = await send().catch(() => send()).catch((e) => { throw new KgError('upstream', `Ollama chat unreachable or timed out at ${base}: ${text(e)}`); });
      if (!res.ok) throw new KgError('upstream', `Ollama /api/chat ${res.status}: ${await res.text()}`);
      const b = (await res.json()) as { message: { content: string }; model: string; prompt_eval_count?: number; eval_count?: number };
      return { text: b.message.content, model: b.model, inputTokens: b.prompt_eval_count ?? 0, outputTokens: b.eval_count ?? 0 };
    },
  };
}
