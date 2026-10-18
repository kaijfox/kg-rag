/**
 * SKELETON Ollama clients (replaced by the Phase 2 `embed` package and the eval LLM adapter).
 * Embeddings: POST /api/embed {model, input[]} returns L2-normalized vectors.
 */
import { KgError, l2normalize, type Embedder, type Llm, type LlmRequest, type LlmResponse } from '@kg/core';

export interface OllamaOptions {
  baseUrl?: string;
  batchSize?: number;
}

export function ollamaEmbedder(model: string, dims: number, o: OllamaOptions = {}): Embedder {
  const base = o.baseUrl ?? 'http://localhost:11434';
  const batch = o.batchSize ?? 32;
  return {
    model,
    dims,
    async embed(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batch) {
        const input = texts.slice(i, i + batch);
        let res: Response;
        try {
          res = await fetch(`${base}/api/embed`, { method: 'POST', body: JSON.stringify({ model, input }) });
        } catch (e) {
          throw new KgError('upstream', `ollama unreachable at ${base}: ${(e as Error).message}`);
        }
        if (!res.ok) throw new KgError('upstream', `ollama /api/embed ${res.status}: ${await res.text()}`);
        const body = (await res.json()) as { embeddings: number[][] };
        for (const v of body.embeddings) {
          if (v.length !== dims) throw new KgError('upstream', `ollama returned ${v.length} dims, expected ${dims}`);
          out.push(l2normalize(Float32Array.from(v)));
        }
      }
      return out;
    },
  };
}

export async function ollamaAvailable(model: string, baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return false;
    const tags = (await res.json()) as { models: { name: string }[] };
    return tags.models.some((m) => m.name === model);
  } catch {
    return false;
  }
}

/** Chat completion via /api/chat (non-streaming). */
export function ollamaLlm(o: OllamaOptions = {}): Llm {
  const base = o.baseUrl ?? 'http://localhost:11434';
  return {
    async complete(r: LlmRequest): Promise<LlmResponse> {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({
          model: r.model,
          stream: false,
          think: false,
          ...(r.json ? { format: 'json' } : {}),
          options: { temperature: r.temperature, num_predict: r.maxTokens },
          messages: [{ role: 'system', content: r.system }, ...r.messages],
        }),
      });
      if (!res.ok) throw new KgError('upstream', `ollama /api/chat ${res.status}: ${await res.text()}`);
      const b = (await res.json()) as { message: { content: string }; model: string; prompt_eval_count?: number; eval_count?: number };
      return { text: b.message.content, model: b.model, inputTokens: b.prompt_eval_count ?? 0, outputTokens: b.eval_count ?? 0 };
    },
  };
}
