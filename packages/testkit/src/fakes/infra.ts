import type { Clock, IdGen, UlidPrefix } from '@kg/core';

/** Deterministic clock: each now() call advances by stepMs from start; monotonicMs() advances by 1 per call. */
export class FixedClock implements Clock {
  private n = 0;
  private m = 0;
  constructor(
    private readonly start = '2026-10-17T12:00:00.000Z',
    private readonly stepMs = 1000,
  ) {}
  now(): string {
    return new Date(Date.parse(this.start) + this.stepMs * this.n++).toISOString();
  }
  monotonicMs(): number {
    return this.m++;
  }
}

/** Sequential IDs: se_00000000000000000000000001, ... per prefix (valid Crockford ULID characters). */
export class SeqIds implements IdGen {
  private readonly counters = new Map<UlidPrefix, number>();
  ulid(prefix: UlidPrefix): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return prefix + String(n).padStart(26, '0');
  }
}
