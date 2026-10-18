import { expect } from 'vitest';
import type { Embedder } from '@kg/core';
import type { Suite } from './harness';

const TEXTS = ['The entropy of an isolated system never decreases.', 'Boyle: pressure is inversely proportional to volume.', 'Résumé of Carnot efficiency, ΔS ≥ 0'];
const norm = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const close = (a: Float32Array, b: Float32Array, tol: number) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= tol);

/** tol: per-component tolerance for batch-vs-single and repeat equality (real models on GPU may need ~1e-4). */
export function embedderConformance(make: () => Embedder | Promise<Embedder>, o: { tol?: number } = {}): Suite {
  const tol = o.tol ?? 1e-5;
  return {
    name: 'embedderConformance',
    cases: [
      {
        name: 'returns one vector of length dims per text, in order',
        async run() {
          const e = await make();
          expect(Number.isInteger(e.dims) && e.dims > 0).toBe(true);
          expect(e.model.length).toBeGreaterThan(0);
          const vs = await e.embed(TEXTS);
          expect(vs.length).toBe(TEXTS.length);
          for (const v of vs) {
            expect(v).toBeInstanceOf(Float32Array);
            expect(v.length).toBe(e.dims);
            expect(v.every(Number.isFinite)).toBe(true);
          }
        },
      },
      {
        name: 'vectors are L2-normalized (|v| = 1 +- 1e-5)',
        async run() {
          const e = await make();
          for (const v of await e.embed(TEXTS)) expect(Math.abs(norm(v) - 1)).toBeLessThanOrEqual(1e-5);
        },
      },
      {
        name: 'deterministic: the same text twice gives the same vector',
        async run() {
          const e = await make();
          const [a] = await e.embed([TEXTS[0]!]);
          const [b] = await e.embed([TEXTS[0]!]);
          expect(close(a!, b!, tol)).toBe(true);
        },
      },
      {
        name: 'batching does not matter: embed([a, b, c]) equals singletons, and order is preserved',
        async run() {
          const e = await make();
          const batch = await e.embed(TEXTS);
          const singles = await Promise.all(TEXTS.map(async (t) => (await e.embed([t]))[0]!));
          batch.forEach((v, i) => expect(close(v, singles[i]!, tol), `text ${i}`).toBe(true));
          const rev = await e.embed([...TEXTS].reverse());
          rev.forEach((v, i) => expect(close(v, batch[TEXTS.length - 1 - i]!, tol)).toBe(true));
        },
      },
      {
        name: 'different texts give different vectors',
        async run() {
          const e = await make();
          const [a, b] = await e.embed([TEXTS[0]!, TEXTS[1]!]);
          expect(close(a!, b!, 1e-3)).toBe(false);
        },
      },
      {
        name: 'embed([]) resolves to [] and "" does not throw',
        async run() {
          const e = await make();
          expect(await e.embed([])).toEqual([]);
          const [v] = await e.embed(['']);
          expect(v!.length).toBe(e.dims);
          expect(v!.every(Number.isFinite)).toBe(true);
        },
      },
    ],
  };
}
