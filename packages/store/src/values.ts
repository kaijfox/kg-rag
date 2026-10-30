/** Store-specific value helpers: vector encoding and the KgError constructors the store raises. */
import { KgError } from '@kg/core';

/** Float32 little-endian, the vector BLOB format (explicit byte order, independent of the host). */
export function encodeVector(v: Float32Array): Buffer {
  const out = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) out.writeFloatLE(v[i]!, i * 4);
  return out;
}

export const invalid = (msg: string): KgError => new KgError('invalid_input', msg);
export const notFound = (msg: string): KgError => new KgError('not_found', msg);
