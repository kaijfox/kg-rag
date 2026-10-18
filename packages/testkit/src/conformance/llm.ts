import { expect } from 'vitest';
import { requestSha256, type Llm, type LlmRequest } from '@kg/core';
import { expectKgError, type Suite } from './harness';

export interface LlmHarness {
  llm: Llm;
  /** a request the implementation can answer */
  request: LlmRequest;
  /** a request a replaying/scripted implementation must refuse rather than improvise (omit for live models) */
  unknownRequest?: LlmRequest;
  /** true for replaying/scripted implementations: identical requests give identical text */
  deterministic: boolean;
}

export function llmConformance(make: () => LlmHarness | Promise<LlmHarness>): Suite {
  return {
    name: 'llmConformance',
    cases: [
      {
        name: 'response has text, the model name and non-negative integer token counts',
        async run() {
          const h = await make();
          const r = await h.llm.complete(h.request);
          expect(typeof r.text).toBe('string');
          expect(r.model.length).toBeGreaterThan(0);
          for (const n of [r.inputTokens, r.outputTokens]) expect(Number.isInteger(n) && n >= 0).toBe(true);
        },
      },
      {
        name: 'deterministic implementations answer identical requests identically',
        async run() {
          const h = await make();
          if (!h.deterministic) return;
          const a = await h.llm.complete(h.request);
          const b = await h.llm.complete(structuredClone(h.request));
          expect(b.text).toBe(a.text);
        },
      },
      {
        name: 'an unknown request is refused with a KgError, never improvised',
        async run() {
          const h = await make();
          if (!h.unknownRequest) return;
          await expectKgError(() => h.llm.complete(h.unknownRequest!));
        },
      },
      {
        name: 'requestSha256 is stable, ignores key order, and changes with content',
        async run() {
          const h = await make();
          const r = h.request;
          const reordered = JSON.parse(JSON.stringify({ maxTokens: r.maxTokens, messages: r.messages, temperature: r.temperature, system: r.system, model: r.model, purpose: r.purpose })) as LlmRequest;
          expect(requestSha256(reordered)).toBe(requestSha256(r));
          expect(requestSha256({ ...r, temperature: r.temperature + 0.5 })).not.toBe(requestSha256(r));
          expect(requestSha256(r)).toMatch(/^[0-9a-f]{64}$/);
        },
      },
    ],
  };
}
