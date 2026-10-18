import type { Embedder } from '@kg/core';

/** Tokens: lowercase, split on anything that is not a Unicode letter or digit. */
export function hashTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** 32-bit FNV-1a over the UTF-8 bytes. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * HashEmbedder(dims): bag of words. Each token adds 1 to component fnv1a32(token) mod dims; the vector is
 * L2-normalized (the empty string gives the zero vector). Deterministic, batch-independent, and similar texts
 * get similar vectors, so search fixtures mean something. Reimplemented independently in
 * fixtures/search/oracle.py to compute the search fixture's expected rankings.
 */
export class HashEmbedder implements Embedder {
  readonly model: string;
  constructor(readonly dims = 64) {
    this.model = `hash-bow-${dims}`;
  }
  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedOne(t));
  }
  embedOne(t: string): Float32Array {
    const v = new Float64Array(this.dims);
    for (const tok of hashTokens(t)) v[fnv1a32(tok) % this.dims]! += 1;
    let s = 0;
    for (const x of v) s += x * x;
    const out = new Float32Array(this.dims);
    if (s === 0) return out;
    const n = Math.sqrt(s);
    for (let i = 0; i < this.dims; i++) out[i] = v[i]! / n;
    return out;
  }
}
