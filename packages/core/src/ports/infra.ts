/** Infrastructure injected everywhere. Packages never call Date.now(), performance.now() or Math.random(). */
import { randomBytes } from 'node:crypto';
import type { EventId, SearchId, SessionId, UlidPrefix, BuildId } from '../ids';
import type { EventEnvelope, EventPayloads, EventType } from '../events';

export interface Clock {
  /** ISO-8601 UTC with milliseconds, e.g. "2026-10-17T12:00:00.000Z" */
  now(): string;
  /** monotonic milliseconds, for durations only */
  monotonicMs(): number;
}

export interface IdGen {
  /** prefix + 26-char ULID (Crockford base32, uppercase); strictly increasing per generator */
  ulid(prefix: UlidPrefix): string;
}

/**
 * Context given to every domain service call. Services never see EventLog: they emit through ctx,
 * and runTool tags each event with the session, the tool.called event as parent, and a build.
 */
export interface Ctx {
  readonly sessionId: SessionId;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** the tool.called event this work belongs to */
  readonly parentEventId: EventId;
  /**
   * Appends a domain event. buildId defaults to the current build at the time of emitting;
   * searchId defaults to null. Returns the stored envelope.
   */
  emit<T extends EventType>(
    type: T,
    payload: EventPayloads[T],
    o?: { searchId?: SearchId | null; buildId?: BuildId | null },
  ): EventEnvelope<T>;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  monotonicMs: () => performance.now(),
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Monotonic ULID generator (48-bit ms time + 80-bit randomness, incremented within one ms). */
export function ulidGen(clockMs: () => number = () => Date.now()): IdGen {
  let lastMs = -1;
  let lastRand: bigint = 0n;
  return {
    ulid(prefix) {
      let ms = clockMs();
      if (ms <= lastMs) {
        ms = lastMs;
        lastRand += 1n;
      } else {
        lastMs = ms;
        lastRand = BigInt('0x' + randomBytes(10).toString('hex'));
      }
      let n = (BigInt(ms) << 80n) | (lastRand & ((1n << 80n) - 1n));
      let s = '';
      for (let i = 0; i < 26; i++) {
        s = CROCKFORD[Number(n & 31n)] + s;
        n >>= 5n;
      }
      return prefix + s;
    },
  };
}
