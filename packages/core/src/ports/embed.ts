/**
 * Embedder: turns already-conditioned texts into vectors. Conditioning (templates) happens in core's
 * conditioning.ts, never inside an embedder.
 * Contract: same order as input; each vector has length dims; L2-normalized (|v| = 1 +- 1e-5) for
 * non-empty input; deterministic for a given model; embed([a, b]) equals [embed([a]), embed([b])]
 * up to 1e-5 per component; embed([]) resolves to []; "" must not throw.
 */
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

/** Normalizes in place and returns v; a zero vector stays zero. */
export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  if (s === 0) return v;
  const n = Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}
