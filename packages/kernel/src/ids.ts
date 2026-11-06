/**
 * Identifiers and their derivation. The only place IDs are computed.
 *
 * Content-derived IDs: prefix + first 20 characters of base32(sha256(tag U+001F part1 U+001F part2 ...)).
 * base32 is RFC 4648, lowercase, no padding; 20 characters carry 100 bits.
 * Time-ordered IDs (sessions, searches, events, eval runs) are a prefix plus a 26-character ULID.
 *
 * The chunk-ID formula is the one the pinned evaluation questions cite. Changing it invalidates them.
 */
import { createHash, randomBytes } from 'node:crypto';
import { KgError } from './errors';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

const HASH20 = '[a-z2-7]{20}';
/** Patterns every ID must match. */
export const ID_PATTERNS = {
  chunk: new RegExp(`^ch_${HASH20}$`),
  item: new RegExp(`^it_${HASH20}$`),
  link: new RegExp(`^lk_${HASH20}$`),
  space: new RegExp(`^es_${HASH20}$`),
  docKey: /^[^\u0000-\u001f\u007f/\\]{1,200}$/,
  sha256: /^[0-9a-f]{64}$/,
} as const;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** RFC 4648 base32, lowercase, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function sha256hex(s: string | Uint8Array): string {
  return createHash('sha256').update(s).digest('hex');
}

const SEP = '\u001f'; // unit separator between hash parts
const PATH_SEP = '\u001e'; // record separator between section-path entries

/** sha256 over the tag and parts joined by U+001F; base32; first 20 characters. Parts must not contain U+001F. */
export function hashId(prefix: string, tag: string, parts: readonly string[]): string {
  for (const p of [tag, ...parts]) {
    if (p.includes(SEP)) throw new KgError('invalid_input', `hash part contains U+001F: ${JSON.stringify(p.slice(0, 40))}`);
  }
  const digest = createHash('sha256').update([tag, ...parts].join(SEP), 'utf8').digest();
  return prefix + base32(digest).slice(0, 20);
}

/**
 * Text normalisation for hashing only (stored text stays verbatim): NFC, then every run of JS whitespace becomes one
 * ASCII space, then trim.
 */
export function normText(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Name normalisation for mentions and aliases: NFKC, lowercase, whitespace collapsed, leading punctuation stripped
 * except opening brackets, trailing punctuation stripped except closing brackets.
 * "Dorsolateral Striatum (DLS)." becomes "dorsolateral striatum (dls)".
 */
export function normName(s: string): string {
  const base = s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return base
    .replace(/^(?:(?![([{])\p{P})+/u, '')
    .replace(/(?:(?![)\]}])\p{P})+$/u, '')
    .trim();
}

/** RFC 8785 canonical JSON: keys sorted, numbers in shortest form. Throws on undefined, non-finite numbers and non-plain objects. */
export function canonicalJson(v: Json): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new KgError('invalid_input', `canonicalJson: non-finite number ${v}`);
      return JSON.stringify(v);
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => canonicalJson(x)).join(',') + ']';
      const keys = Object.keys(v).sort();
      return (
        '{' +
        keys
          .map((k) => {
            const x = (v as Record<string, Json | undefined>)[k];
            if (x === undefined) throw new KgError('invalid_input', `canonicalJson: undefined at key ${k}`);
            return JSON.stringify(k) + ':' + canonicalJson(x);
          })
          .join(',') +
        '}'
      );
    }
    default:
      throw new KgError('invalid_input', `canonicalJson: unsupported type ${typeof v}`);
  }
}

/**
 * Chunk ID = H('chunk/1', docKey, normText(section-path entries) joined by U+001E, sha256hex(normText(text)), occurrence).
 * occurrence = index of this chunk among the document's chunks with the same normalised path and text (almost always 0).
 */
export function chunkId(docKey: string, sectionPath: readonly string[], text: string, occurrence: number): string {
  if (!Number.isInteger(occurrence) || occurrence < 0) throw new KgError('invalid_input', `bad occurrence ${occurrence}`);
  const path = sectionPath.map((h) => {
    const n = normText(h);
    if (n.includes(PATH_SEP)) throw new KgError('invalid_input', 'section heading contains U+001E');
    return n;
  });
  return hashId('ch_', 'chunk/1', [docKey, path.join(PATH_SEP), sha256hex(normText(text)), String(occurrence)]);
}

/** Assigns occurrences and IDs to a chunker's output in reading order. Every chunker must use this. */
export function assignChunkIds<T extends { sectionPath: readonly string[]; text: string }>(
  docKey: string,
  drafts: readonly T[],
): (T & { id: string; occurrence: number })[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    const key = d.sectionPath.map(normText).join(PATH_SEP) + SEP + normText(d.text);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...d, occurrence, id: chunkId(docKey, d.sectionPath, d.text, occurrence) };
  });
}

/**
 * Derived-item ID = H('item/1', kind, madeBy, sorted unique source chunk IDs, normText(text)). The text is part of the
 * ID because a model gives different sentences for the same input, and a new sentence is a new record.
 */
export function itemId(kind: string, madeBy: string, sourceChunkIds: readonly string[], text: string): string {
  const sources = [...new Set(sourceChunkIds)].sort().join(',');
  return hashId('it_', 'item/1', [kind, madeBy, sources, normText(text)]);
}

/** Link ID = H('link/1', kind, subject, fromId, toId, madeBy). */
export function linkId(kind: string, subject: string, fromId: string, toId: string, madeBy: string): string {
  return hashId('lk_', 'link/1', [kind, subject, fromId, toId, madeBy]);
}

export const spaceId = (spec: Json): string => hashId('es_', 'space/1', [canonicalJson(spec)]);

/** Document key from a file name: the base name without its last extension. */
export function defaultDocKey(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (!ID_PATTERNS.docKey.test(stem)) throw new KgError('invalid_input', `bad docKey from ${JSON.stringify(pathOrName)}`);
  return stem;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export type UlidPrefix = 'se_' | 'sr_' | 'ev_' | 'er_' | 'ix_';

/** Monotonic ULID generator: 48-bit milliseconds plus 80 bits of randomness, incremented within one millisecond. */
export function ulidGen(clockMs: () => number = () => Date.now()): { ulid(prefix: UlidPrefix): string } {
  let lastMs = -1;
  let lastRand = 0n;
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
