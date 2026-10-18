/**
 * Identifiers and their derivation. The only place IDs are computed.
 *
 * Content-addressed IDs: prefix + first 20 chars of base32(sha256(tag U+001F part1 U+001F part2 ...)).
 * base32 is RFC 4648, lowercase alphabet, no padding; 20 chars = 100 bits.
 * Time-ordered IDs (sessions, searches, events, runs) come from IdGen as prefix + 26-char ULID.
 *
 * Addressing modes (labels per prefix, see the glossary in scratch/sprint-1/lifecycle.md):
 *   content-addressed: ch_, nd_, bd_, mp_, qs_ (hash of the content or output itself)
 *   input-addressed:   pa_, dv_ (hash of a recipe plus its inputs; the output is not re-checked against the id)
 *   spec hash:         rc_, es_ (hash of the canonical spec itself, not of a recipe applied to inputs)
 *   reserved:          rl_, sm_ (formula not fixed; v0 writes none)
 *   time-ordered:      se_, sr_, ev_, dr_, er_ (IdGen ULID, not derived from content)
 *
 * "Recipe" is the plan (RecipeSpec; for a pipeline, a machine recipe: machine name, version, typed settings and a
 * topology pin). "Derivation" is a recipe applied to specific inputs.
 *
 * Golden vectors: packages/testkit/golden/ids.json (computed by an independent Python
 * implementation of these formulas, see packages/testkit/golden/README.md).
 */
import { createHash } from 'node:crypto';
import type { BuildManifest, EmbeddingSpaceSpec, Json, Mapping, RecipeSpec } from './model';
import { KgError } from './errors';

export type Brand<T, B extends string> = T & { readonly __brand: B };

// addressing modes per prefix: see header
export type ChunkId = Brand<string, 'ChunkId'>; // ch_ content-addressed
export type DerivedItemId = Brand<string, 'DerivedItemId'>; // rl_ (relation) | sm_ (summary); reserved, v0 writes none (reserved)
export type ItemId = ChunkId | DerivedItemId;
export type NodeId = Brand<string, 'NodeId'>; // nd_ content-addressed
export type RecipeId = Brand<string, 'RecipeId'>; // rc_ spec hash
export type BuildId = Brand<string, 'BuildId'>; // bd_ content-addressed over its members
export type MappingId = Brand<string, 'MappingId'>; // mp_ content-addressed
export type DocVersionId = Brand<string, 'DocVersionId'>; // dv_ input-addressed (derivation: chunk recipe applied to an artifact)
export type ArtifactId = Brand<string, 'ArtifactId'>; // pa_ input-addressed (derivation: parse recipe applied to a source)
export type SpaceId = Brand<string, 'SpaceId'>; // es_ spec hash
export type EvalSetId = Brand<string, 'EvalSetId'>; // qs_ content-addressed
// names
export type DocKey = Brand<string, 'DocKey'>; // stable document name, e.g. "ThermoPlischke"
// time-ordered (IdGen)
export type SessionId = Brand<string, 'SessionId'>; // se_
export type SearchId = Brand<string, 'SearchId'>; // sr_
export type EventId = Brand<string, 'EventId'>; // ev_
export type RunId = Brand<string, 'RunId'>; // dr_ (set-level derivation run)
export type EvalRunId = Brand<string, 'EvalRunId'>; // er_

export type UlidPrefix = 'se_' | 'sr_' | 'ev_' | 'dr_' | 'er_';

const HASH20 = '[a-z2-7]{20}';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
/** Regexes every ID must match. Used by zod schemas and conformance suites. */
export const ID_PATTERNS = {
  chunk: new RegExp(`^ch_${HASH20}$`),
  derivedItem: new RegExp(`^(rl|sm)_${HASH20}$`),
  item: new RegExp(`^(ch|rl|sm)_${HASH20}$`),
  node: new RegExp(`^nd_${HASH20}$`),
  recipe: new RegExp(`^rc_${HASH20}$`),
  build: new RegExp(`^bd_${HASH20}$`),
  mapping: new RegExp(`^mp_${HASH20}$`),
  docVersion: new RegExp(`^dv_${HASH20}$`),
  artifact: new RegExp(`^pa_${HASH20}$`),
  space: new RegExp(`^es_${HASH20}$`),
  evalSet: new RegExp(`^qs_${HASH20}$`),
  session: new RegExp(`^se_${ULID}$`),
  search: new RegExp(`^sr_${ULID}$`),
  event: new RegExp(`^ev_${ULID}$`),
  run: new RegExp(`^dr_${ULID}$`),
  evalRun: new RegExp(`^er_${ULID}$`),
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
const PATH_SEP = '\u001e'; // record separator between section path entries

/** sha256 over tag and parts joined by U+001F; base32; first 20 chars. Parts must not contain U+001F. */
export function hashId(prefix: string, tag: string, parts: readonly string[]): string {
  for (const p of [tag, ...parts]) {
    if (p.includes(SEP)) throw new KgError('invalid_input', `hash part contains U+001F: ${JSON.stringify(p.slice(0, 40))}`);
  }
  const digest = createHash('sha256').update([tag, ...parts].join(SEP), 'utf8').digest();
  return prefix + base32(digest).slice(0, 20);
}

/**
 * Text normalization for hashing only (stored text stays verbatim):
 * NFC, then every run of JS whitespace (\s, which includes NBSP, U+2000-U+200A, U+3000, CR, LF, TAB)
 * becomes one ASCII space, then trim. Ligatures are left alone (NFC, not NFKC).
 */
export function normText(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Name normalization for node IDs: NFKC, lowercase, whitespace collapsed and trimmed, then leading
 * Unicode punctuation stripped except opening brackets ( [ {, and trailing punctuation stripped except
 * closing brackets ) ] }, then trimmed again.
 * "Dorsolateral Striatum (DLS)." -> "dorsolateral striatum (dls)".
 */
export function normName(s: string): string {
  const base = s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return base
    .replace(/^(?:(?![([{])\p{P})+/u, '')
    .replace(/(?:(?![)\]}])\p{P})+$/u, '')
    .trim();
}

/**
 * RFC 8785 (JCS) canonical JSON. Object keys sorted by UTF-16 code units; numbers in ECMAScript
 * shortest form (JSON.stringify); strings escaped as JSON.stringify does (which matches JCS).
 * Throws on non-finite numbers, undefined, lone surrogates, and non-plain values.
 */
export function canonicalJson(v: Json): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new KgError('invalid_input', `canonicalJson: non-finite number ${v}`);
      return JSON.stringify(v);
    case 'string':
      if (/\p{Cs}/u.test(v)) throw new KgError('invalid_input', 'canonicalJson: lone surrogate in string');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => canonicalJson(x)).join(',') + ']';
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new KgError('invalid_input', 'canonicalJson: non-plain object');
      const keys = Object.keys(v).sort();
      return (
        '{' +
        keys
          .map((k) => {
            const x = (v as Record<string, Json | undefined>)[k];
            if (x === undefined) throw new KgError('invalid_input', `canonicalJson: undefined at key ${k}`);
            if (/\p{Cs}/u.test(k)) throw new KgError('invalid_input', 'canonicalJson: lone surrogate in key');
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
 * Chunk ID = H('chunk/1', docKey, normText(section path entries) joined by U+001E, sha256hex(normText(text)), occurrence).
 * occurrence = index of this chunk among the document's chunks with the same normalized section path and
 * the same normText (almost always 0). No ordinal, no database ID, no recipe.
 */
export function chunkId(docKey: DocKey, sectionPath: readonly string[], text: string, occurrence: number): ChunkId {
  if (!Number.isInteger(occurrence) || occurrence < 0) throw new KgError('invalid_input', `bad occurrence ${occurrence}`);
  const path = sectionPath.map((h) => {
    const n = normText(h);
    if (n.includes(PATH_SEP)) throw new KgError('invalid_input', 'section heading contains U+001E');
    return n;
  });
  return hashId('ch_', 'chunk/1', [docKey, path.join(PATH_SEP), sha256hex(normText(text)), String(occurrence)]) as ChunkId;
}

/**
 * Assigns occurrences and IDs to a chunker's output in reading order. Every chunker must use this
 * (chunkerConformance checks the result equals chunkId(...) for each draft).
 */
export function assignChunkIds<T extends { sectionPath: readonly string[]; text: string }>(
  docKey: DocKey,
  drafts: readonly T[],
): (T & { id: ChunkId; occurrence: number })[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    const key = d.sectionPath.map(normText).join(PATH_SEP) + SEP + normText(d.text);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...d, occurrence, id: chunkId(docKey, d.sectionPath, d.text, occurrence) };
  });
}

export const recipeId = (r: RecipeSpec): RecipeId => hashId('rc_', 'recipe/1', [canonicalJson(r as Json)]) as RecipeId;

/** 0.6.1: two recipes are equal when their canonical JSON is (the same condition as having the same recipe id). */
export const recipesEqual = (a: RecipeSpec, b: RecipeSpec): boolean => canonicalJson(a as Json) === canonicalJson(b as Json);

export const nodeId = (name: string): NodeId => {
  const n = normName(name);
  if (n === '') throw new KgError('invalid_input', `node name normalizes to empty: ${JSON.stringify(name)}`);
  return hashId('nd_', 'node/1', [n]) as NodeId;
};

/**
 * RESERVED. Derived item IDs are deferred (design-feedback 2026-10-17, "derived item IDs vs
 * nondeterministic producers"): whether a text hash enters the ID is undecided. v0 writes no derived
 * items. The prefixes rl_ / sm_ and the brand are fixed now; the formula is not.
 */
export function derivedItemId(
  _kind: 'relation' | 'summary',
  _recipe: RecipeId,
  _inputs: readonly ItemId[],
  _text: string,
): DerivedItemId {
  throw new KgError('not_implemented', 'derivedItemId is reserved until the relation layer sprint decides the formula');
}

export const artifactId = (sourceSha256: string, parseRecipe: RecipeId): ArtifactId => {
  if (!ID_PATTERNS.sha256.test(sourceSha256)) throw new KgError('invalid_input', 'sourceSha256 must be 64 lowercase hex');
  return hashId('pa_', 'artifact/1', [sourceSha256, parseRecipe]) as ArtifactId;
};

export const docVersionId = (docKey: DocKey, artifact: ArtifactId, chunkRecipe: RecipeId): DocVersionId =>
  hashId('dv_', 'docversion/1', [docKey, artifact, chunkRecipe]) as DocVersionId;

export const spaceId = (s: EmbeddingSpaceSpec): SpaceId => hashId('es_', 'space/1', [canonicalJson(s as Json)]) as SpaceId;

/**
 * Build ID = H('build/2', canonicalJson(manifest), sorted unique itemIds joined by ','). The items are hashed
 * because the manifest names derived recipes, not derived items: re-deriving only the chunks that failed under
 * the same recipe must give a new build (contract-revisions R-23).
 */
export const buildId = (m: BuildManifest, itemIds: readonly ItemId[]): BuildId =>
  hashId('bd_', 'build/2', [canonicalJson(m as unknown as Json), [...new Set(itemIds)].sort().join(',')]) as BuildId;

export const mappingId = (m: Omit<Mapping, 'id'>): MappingId =>
  hashId('mp_', 'mapping/1', [canonicalJson(m as unknown as Json)]) as MappingId;

export const evalSetId = (questions: Json): EvalSetId => hashId('qs_', 'evalset/1', [canonicalJson(questions)]) as EvalSetId;

/** Default document key: file base name without its last extension ("a/b/ThermoPlischke.pdf" -> "ThermoPlischke"). */
export function defaultDocKey(pathOrName: string): DocKey {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (!ID_PATTERNS.docKey.test(stem)) throw new KgError('invalid_input', `bad docKey from ${JSON.stringify(pathOrName)}`);
  return stem as DocKey;
}

export const asDocKey = (s: string): DocKey => {
  if (!ID_PATTERNS.docKey.test(s)) throw new KgError('invalid_input', `bad docKey ${JSON.stringify(s)}`);
  return s as DocKey;
};
