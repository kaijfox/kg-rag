/** The model interface, provider-neutral, with a response cache and a call observer as wrappers. */
import { canonicalJson, sha256hex, type Json } from './ids';
import type { CacheStore } from './cacheStore';
import { KgError } from './errors';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface LlmRequest {
  /** what the call is for, such as "extract-facts", "eval-judge" */
  purpose: string;
  model: string;
  system: string;
  messages: LlmMessage[];
  temperature: number;
  maxTokens: number;
  /** ask for a JSON object reply */
  json?: boolean;
}
export interface LlmResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** true when the cache answered */
  cached?: boolean;
}
export interface Llm {
  complete(r: LlmRequest): Promise<LlmResponse>;
}

/** Stable request hash: sha256 of the canonical JSON of the request. Keys the cache and identifies calls in the log. */
export function requestSha256(r: LlmRequest): string {
  const j: Json = {
    purpose: r.purpose,
    model: r.model,
    system: r.system,
    messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: r.temperature,
    maxTokens: r.maxTokens,
    json: r.json ?? false,
  };
  return sha256hex(canonicalJson(j));
}

/**
 * Answers from the cache when it can; otherwise calls through and stores the response. With `cacheOnly`, a request the
 * cache does not hold is an error instead of a model call, so a machine without a fast model cannot fall back to slow
 * extraction without anyone noticing.
 */
export function cachedLlm(inner: Llm, cache: CacheStore, o: { cacheOnly?: boolean } = {}): Llm {
  return {
    async complete(r) {
      const key = requestSha256(r);
      const hit = cache.get(key);
      if (hit !== null) return { ...(JSON.parse(hit) as LlmResponse), cached: true };
      if (o.cacheOnly) {
        throw new KgError(
          'precondition',
          `the cache has no response for this ${r.purpose} request (${key.slice(0, 12)}, model ${r.model}). The machine that ran the extraction must use the same model, prompt and kg version; or run without --cache-only to call the model here`,
        );
      }
      const res = await inner.complete(r);
      cache.put(key, r.purpose, JSON.stringify({ text: res.text, model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens }));
      return { ...res, cached: false };
    },
  };
}

export interface LlmCallInfo {
  purpose: string;
  model: string;
  requestSha256: string;
  responseSha256: string;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

/** Reports every call (hashes only, never the text) to `onCall`. */
export function observedLlm(inner: Llm, onCall: (info: LlmCallInfo) => void, clock: () => number = () => performance.now()): Llm {
  return {
    async complete(r) {
      const t0 = clock();
      const res = await inner.complete(r);
      onCall({
        purpose: r.purpose,
        model: res.model,
        requestSha256: requestSha256(r),
        responseSha256: sha256hex(res.text),
        cached: res.cached ?? false,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: Math.round(clock() - t0),
      });
      return res;
    },
  };
}
