import { canonicalJson, sha256hex } from '../ids';
import type { Json } from '../model';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface LlmRequest {
  /** what the call is for, e.g. "eval-generate", "eval-judge", "eval-answer" */
  purpose: string;
  model: string;
  system: string;
  messages: LlmMessage[];
  temperature: number;
  maxTokens: number;
  /** ask for a JSON object response (Ollama format: "json") */
  json?: boolean;
}
export interface LlmResponse {
  text: string;
  /** model that actually answered (echoes request.model for local providers) */
  model: string;
  inputTokens: number;
  outputTokens: number;
}
/** Provider-neutral. v0 provider: local Ollama (decision log 2026-10-17, Q3). */
export interface Llm {
  complete(r: LlmRequest): Promise<LlmResponse>;
}

/** Stable request hash: sha256 of the canonical JSON of the request. Keys replay caches and llm.called events. */
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
