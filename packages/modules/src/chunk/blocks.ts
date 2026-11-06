/**
 * Shared block helpers: the one place where docling nodes are resolved, where a formula block's text is defined and
 * where block texts are joined. The chunker (sectionPack) and the view renderer (renderChunkView) both use them, so
 * they cannot disagree about what a formula block's text is.
 */
import { KgError, normText } from '@kg/kernel';

/** Blocks inside a chunk are joined with this separator; chunk text is the blocks joined by it. */
export const BLOCK_SEPARATOR = '\n\n';

/** Text that stands for a formula block that has no decoded text. */
export const FORMULA_PLACEHOLDER = '[formula]';

/** Length a formula block is measured at, decoded or not (normText of the placeholder). */
export const FORMULA_MEASURE = normText(FORMULA_PLACEHOLDER).length;

/** The subset of a docling node this package reads. Docling's JSON layout is known only here. */
export type DocNode = {
  self_ref: string;
  label?: string;
  level?: number;
  text?: string;
  content_layer?: string;
  children?: { $ref: string }[];
  captions?: { $ref: string }[];
  prov?: { page_no: number }[];
  data?: { grid?: { text?: string }[][] };
};

export type DoclingDocument = {
  body: { children?: { $ref: string }[] };
  texts?: DocNode[];
  groups?: DocNode[];
  tables?: DocNode[];
  pictures?: DocNode[];
};

export const asDoclingDocument = (document: unknown): DoclingDocument => document as DoclingDocument;

/** Refs to these collections are skipped in v0 (key-value and form items are not chunked). */
export function isSkippedRef(ref: string): boolean {
  return ref.startsWith('#/key_value_items/') || ref.startsWith('#/form_items/');
}

/** Resolves a `#/texts/N`, `#/groups/N`, `#/tables/N` or `#/pictures/N` ref; anything else is invalid input. */
export function resolveRef(doc: DoclingDocument, ref: string): DocNode {
  const m = /^#\/(texts|groups|tables|pictures)\/(0|[1-9][0-9]*)$/.exec(ref);
  if (!m) throw new KgError('invalid_input', `unsupported docling ref ${JSON.stringify(ref)}`);
  const node = (doc[m[1] as 'texts' | 'groups' | 'tables' | 'pictures'] ?? [])[Number(m[2])];
  if (!node) throw new KgError('invalid_input', `docling ref ${ref} does not resolve`);
  return node;
}

/** The text of a formula block: the item's own text verbatim, or the placeholder when it has no text. */
export function formulaBlockText(item: DocNode): string {
  const text = item.text ?? '';
  return normText(text) === '' ? FORMULA_PLACEHOLDER : text;
}

/** Joins block texts into chunk text. */
export function joinBlocks(texts: readonly string[]): string {
  return texts.join(BLOCK_SEPARATOR);
}

/** The text a node contributes to an inline group: a formula's block text (placeholder when undecoded), else its own text. */
export const inlineItemText = (item: DocNode): string => (item.label === 'formula' ? formulaBlockText(item) : (item.text ?? ''));

/** Refs of every node below `node`, depth first. Used to tell which formula refs of a chunk sit inside an inline group. */
export function descendantRefs(doc: DoclingDocument, node: DocNode, out: Set<string> = new Set()): Set<string> {
  for (const c of node.children ?? []) {
    if (out.has(c.$ref) || isSkippedRef(c.$ref)) continue;
    out.add(c.$ref);
    descendantRefs(doc, resolveRef(doc, c.$ref), out);
  }
  return out;
}
