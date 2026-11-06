import { KgError, type Llm, type LlmRequest } from '@kg/kernel';

/** Appended after a malformed reply. The first request is never changed, so a retry differs from it (and from the earlier retries) and a cache cannot return the same bad reply. */
export const RETRY_INSTRUCTION = 'That reply was not valid. Reply again with the JSON object only, in exactly the requested shape, with no other text.';

/** The request for the next attempt: the original messages, then every earlier malformed reply followed by the instruction. */
export function retryRequest(request: LlmRequest, malformed: readonly string[]): LlmRequest {
  if (malformed.length === 0) return request;
  return { ...request, messages: [...request.messages, ...malformed.flatMap((reply) => [{ role: 'assistant' as const, content: reply }, { role: 'user' as const, content: RETRY_INSTRUCTION }])] };
}

/** Asks, parses strictly, and asks again (up to `retries` times) when the reply is malformed. The last parse error is thrown. */
export async function askParsed<T>(llm: Llm, request: LlmRequest, parse: (raw: string) => T, retries: number): Promise<{ value: T; raw: string }> {
  const bad: string[] = [];
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = (await llm.complete(retryRequest(request, bad))).text;
    try {
      return { value: parse(raw), raw };
    } catch (e) {
      if (!(e instanceof KgError) || e.code !== 'invalid_input') throw e;
      last = e;
      bad.push(raw);
    }
  }
  throw last;
}
