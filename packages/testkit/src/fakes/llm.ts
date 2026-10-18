import { KgError, requestSha256, type Llm, type LlmRequest, type LlmResponse } from '@kg/core';

/**
 * ScriptedLlm: answers from a script keyed by requestSha256 (exact request) or, failing that, by purpose.
 * Throws not_found on an unscripted request, so a test never silently gets a made-up answer.
 */
export class ScriptedLlm implements Llm {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly script: { bySha?: Record<string, string>; byPurpose?: Record<string, string> }) {}
  async complete(r: LlmRequest): Promise<LlmResponse> {
    this.calls.push(structuredClone(r));
    const sha = requestSha256(r);
    const text = this.script.bySha?.[sha] ?? this.script.byPurpose?.[r.purpose];
    if (text === undefined) throw new KgError('not_found', `unscripted LLM request (purpose ${r.purpose}, sha ${sha.slice(0, 12)})`);
    return { text, model: r.model, inputTokens: tokens(r.system) + r.messages.reduce((n, m) => n + tokens(m.content), 0), outputTokens: tokens(text) };
  }
}
const tokens = (s: string) => s.split(/\s+/).filter(Boolean).length;

export interface ReplayRecord {
  requestSha256: string;
  response: LlmResponse;
}
/** ReplayLlm: reproduces recorded responses (e.g. a JSONL cache) by exact request hash. */
export class ReplayLlm implements Llm {
  private readonly bySha: Map<string, LlmResponse>;
  constructor(records: readonly ReplayRecord[]) {
    this.bySha = new Map(records.map((r) => [r.requestSha256, r.response]));
  }
  async complete(r: LlmRequest): Promise<LlmResponse> {
    const hit = this.bySha.get(requestSha256(r));
    if (!hit) throw new KgError('not_found', `no recorded response for request ${requestSha256(r).slice(0, 12)}`);
    return structuredClone(hit);
  }
}
