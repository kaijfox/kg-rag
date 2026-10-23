/** Chat completion against a local Ollama server (POST /api/chat, not streamed), as a core `Llm`. */
import { KgError, type Llm, type LlmRequest, type LlmResponse } from '@kg/core';

export interface OllamaLlmOptions {
  baseUrl?: string;
  /** per call, milliseconds; default 5 minutes */
  timeoutMs?: number;
}

export function ollamaLlm(o: OllamaLlmOptions = {}): Llm {
  const base = (o.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
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
      let res: Response;
      try {
        // one retry: a long run on a laptop sometimes loses one call to a stall or sleep
        res = await send().catch(() => send());
      } catch (e) {
        throw new KgError('upstream', `ollama chat unreachable or timed out at ${base}: ${(e as Error).message}`);
      }
      if (!res.ok) throw new KgError('upstream', `ollama /api/chat ${res.status}: ${await res.text()}`);
      const b = (await res.json()) as { message: { content: string }; model: string; prompt_eval_count?: number; eval_count?: number };
      return { text: b.message.content, model: b.model, inputTokens: b.prompt_eval_count ?? 0, outputTokens: b.eval_count ?? 0 };
    },
  };
}
