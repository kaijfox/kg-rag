import type { Json } from './ids';

/**
 * Error codes are part of the contract: tool.failed events carry them, and tests assert on them.
 * - invalid_input: a request or value violates a schema or precondition the caller controls
 * - invalid_event: an event draft fails the catalog (EventLog.append)
 * - not_found: a referenced session, search, build, item, artifact, recipe or space does not exist
 * - immutable_violation: an insert-only row would be overwritten with different content (Rules 2, 3)
 * - conflict: a pointer or label already points elsewhere
 * - precondition: the system state does not allow the operation (e.g. search with no build)
 * - upstream: an external dependency failed (docling sidecar, Ollama)
 * - not_implemented: reserved contract surface
 * - internal: anything else (a bug)
 */
export type ErrorCode =
  | 'invalid_input'
  | 'invalid_event'
  | 'not_found'
  | 'immutable_violation'
  | 'conflict'
  | 'precondition'
  | 'upstream'
  | 'not_implemented'
  | 'internal';

export class KgError extends Error {
  readonly code: ErrorCode;
  readonly details: Json | undefined;
  constructor(code: ErrorCode, message: string, details?: Json) {
    super(message);
    this.name = 'KgError';
    this.code = code;
    this.details = details;
  }
}

export const isKgError = (e: unknown): e is KgError => e instanceof KgError;

export function errorCodeOf(e: unknown): ErrorCode {
  return e instanceof KgError ? e.code : 'internal';
}
