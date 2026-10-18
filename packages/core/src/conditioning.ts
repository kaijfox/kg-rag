/**
 * Conditioning: the only place embedding templates are rendered.
 *
 * Document template placeholders: {text} (the item text, verbatim) and {headings} (the section path
 * joined by " > ", or "" when the path is empty). Query template placeholder: {query}.
 * `{text}` is the text the caller passes: for chunks of a space whose `formulaView` differs from the stored text, ingest
 * renders it first with the chunk package's view renderer (ChunkViewRenderer); this module only substitutes.
 * Any other {word} in a template is an error. Rendering is plain substitution: no trimming, no escaping.
 */
import { KgError } from './errors';
import type { EmbeddingSpaceSpec } from './model';

const DOC_PLACEHOLDERS = new Set(['text', 'headings']);
const QUERY_PLACEHOLDERS = new Set(['query']);
const PLACEHOLDER = /\{([a-zA-Z_]+)\}/g;

function check(template: string, allowed: Set<string>, which: string): void {
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (!allowed.has(m[1]!)) throw new KgError('invalid_input', `unknown placeholder {${m[1]}} in ${which} template`);
  }
}

/** Throws unless both templates use only their allowed placeholders and contain their main one. */
export function validateSpace(space: EmbeddingSpaceSpec): void {
  check(space.documentTemplate, DOC_PLACEHOLDERS, 'document');
  check(space.queryTemplate, QUERY_PLACEHOLDERS, 'query');
  if (!space.documentTemplate.includes('{text}')) throw new KgError('invalid_input', 'document template lacks {text}');
  if (!space.queryTemplate.includes('{query}')) throw new KgError('invalid_input', 'query template lacks {query}');
  if (!Number.isInteger(space.dims) || space.dims <= 0) throw new KgError('invalid_input', 'dims must be a positive integer');
}

export const HEADINGS_SEPARATOR = ' > ';

export function renderDocument(space: EmbeddingSpaceSpec, item: { text: string; sectionPath?: readonly string[] }): string {
  check(space.documentTemplate, DOC_PLACEHOLDERS, 'document');
  const headings = (item.sectionPath ?? []).join(HEADINGS_SEPARATOR);
  return space.documentTemplate.replace(PLACEHOLDER, (_m, name: string) => (name === 'text' ? item.text : headings));
}

export function renderQuery(space: EmbeddingSpaceSpec, query: string): string {
  check(space.queryTemplate, QUERY_PLACEHOLDERS, 'query');
  return space.queryTemplate.replace(PLACEHOLDER, () => query);
}
