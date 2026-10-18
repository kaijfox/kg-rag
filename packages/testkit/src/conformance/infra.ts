import { expect } from 'vitest';
import { ID_PATTERNS, type Clock, type IdGen } from '@kg/core';
import type { Suite } from './harness';

export function infraConformance(make: () => { clock: Clock; ids: IdGen }): Suite {
  return {
    name: 'infraConformance',
    cases: [
      {
        name: 'clock: ISO-8601 UTC, non-decreasing; monotonicMs non-decreasing',
        run() {
          const { clock } = make();
          const ts = [clock.now(), clock.now(), clock.now()];
          for (const t of ts) expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          expect([...ts].sort()).toEqual(ts);
          const a = clock.monotonicMs();
          expect(clock.monotonicMs()).toBeGreaterThanOrEqual(a);
        },
      },
      {
        name: 'ids: well-formed per prefix, unique and strictly increasing',
        run() {
          const { ids } = make();
          const xs = Array.from({ length: 50 }, () => ids.ulid('ev_'));
          for (const x of xs) expect(x).toMatch(ID_PATTERNS.event);
          expect(new Set(xs).size).toBe(xs.length);
          expect([...xs].sort()).toEqual(xs);
          expect(ids.ulid('se_')).toMatch(ID_PATTERNS.session);
          expect(ids.ulid('sr_')).toMatch(ID_PATTERNS.search);
        },
      },
    ],
  };
}
