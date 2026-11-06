/** The model interface, provider-neutral, with a response cache and a call observer as wrappers. */
import { canonicalJson, sha256hex, type Json } from './ids';
import type { CacheStore } from './cacheStore';

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

/** Answers from the cache when it can; otherwise calls through and stores the response. */
export function cachedLlm(inner: Llm, cache: CacheStore): Llm {
  return {
    async complete(r) {
      const key = requestSha256(r);
      const hit = cache.get(key);
      if (hit !== null) return { ...(JSON.parse(hit) as LlmResponse), cached: true };
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
