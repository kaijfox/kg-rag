import type { LlmRequest } from '@kg/core';

/**
 * Appended after each malformed reply when a request is asked again. The first request is never changed, so a retry
 * differs from it (and from the earlier retries) and a temperature-0 replay cache cannot return the same bad reply.
 * Not part of a prompt digest: the digest covers the prompt files only.
 */
export const RETRY_INSTRUCTION = 'That reply was not valid. Reply again with the JSON object only, in exactly the requested shape, with no other text.';

/** The request for the next attempt: the original messages, then every earlier malformed reply followed by the instruction. */
export function retryRequest(request: LlmRequest, malformed: readonly string[]): LlmRequest {
  if (malformed.length === 0) return request;
  return {
    ...request,
    messages: [
      ...(request.messages ?? []),
      ...malformed.flatMap((reply) => [
        { role: 'assistant' as const, content: reply },
        { role: 'user' as const, content: RETRY_INSTRUCTION },
      ]),
    ],
  };
}
