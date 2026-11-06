/**
 * The embedding interface and the one place embedding templates are rendered. An embedder turns already-conditioned
 * texts into unit-length vectors, in input order. Conditioning (templates) never happens inside an embedder.
 */
import { KgError } from './errors';
import type { EmbeddingSpaceSpec } from './types';

export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

/** Normalises in place and returns v; a zero vector stays zero. */
export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  if (s === 0) return v;
  const n = Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

const PLACEHOLDER = /\{([a-zA-Z_]+)\}/g;
const DOC_PLACEHOLDERS = new Set(['text', 'headings']);
export const HEADINGS_SEPARATOR = ' > ';

/** Throws unless both templates use only their allowed placeholders and contain their main one. */
export function validateSpace(space: EmbeddingSpaceSpec): void {
  for (const m of space.documentTemplate.matchAll(PLACEHOLDER)) if (!DOC_PLACEHOLDERS.has(m[1]!)) throw new KgError('invalid_input', `unknown placeholder {${m[1]}} in document template`);
  for (const m of space.queryTemplate.matchAll(PLACEHOLDER)) if (m[1] !== 'query') throw new KgError('invalid_input', `unknown placeholder {${m[1]}} in query template`);
  if (!space.documentTemplate.includes('{text}')) throw new KgError('invalid_input', 'document template lacks {text}');
  if (!space.queryTemplate.includes('{query}')) throw new KgError('invalid_input', 'query template lacks {query}');
  if (!Number.isInteger(space.dims) || space.dims <= 0) throw new KgError('invalid_input', 'dims must be a positive integer');
}

export function renderDocument(space: EmbeddingSpaceSpec, item: { text: string; sectionPath?: readonly string[] }): string {
  const headings = (item.sectionPath ?? []).join(HEADINGS_SEPARATOR);
  return space.documentTemplate.replace(PLACEHOLDER, (_m, name: string) => (name === 'text' ? item.text : headings));
}

export function renderQuery(space: EmbeddingSpaceSpec, query: string): string {
  return space.queryTemplate.replace(PLACEHOLDER, () => query);
}
