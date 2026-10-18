/**
 * renderChunkView: the embedding text of one chunk under a formula view. The walk is positional: each formula block of
 * the chunk, in reading order, is located in the stored chunk text at or after the end of the previous match.
 */
import { KgError, type ChunkViewRenderer, type FormulaView } from '@kg/core';
import { BLOCK_SEPARATOR, FORMULA_PLACEHOLDER, asDoclingDocument, descendantRefs, formulaBlockText, resolveRef } from './blocks';

/**
 * Index of the first occurrence of `text` at or after `from` that is a whole block: it starts the chunk text or follows a
 * block separator, and it ends the chunk text or is followed by one. A formula block is never split, so its occurrence
 * always has this shape; a prose occurrence inside a longer block does not, and is skipped.
 */
function findWholeBlock(chunkText: string, text: string, from: number): number {
  let at = chunkText.indexOf(text, from);
  while (at >= 0) {
    const end = at + text.length;
    const startsBlock = at === 0 || chunkText.slice(Math.max(0, at - BLOCK_SEPARATOR.length), at) === BLOCK_SEPARATOR;
    const endsBlock = end === chunkText.length || chunkText.startsWith(BLOCK_SEPARATOR, end);
    if (startsBlock && endsBlock) return at;
    at = chunkText.indexOf(text, at + 1);
  }
  return -1;
}

/**
 * Like findWholeBlock for a formula inside an inline group: the text is one space-joined item of the block, so it starts
 * the chunk text or follows whitespace, and ends the chunk text or is followed by whitespace.
 */
function findInlineItem(chunkText: string, text: string, from: number): number {
  let at = chunkText.indexOf(text, from);
  while (at >= 0) {
    const end = at + text.length;
    if ((at === 0 || /\s/.test(chunkText[at - 1]!)) && (end === chunkText.length || /\s/.test(chunkText[end]!))) return at;
    at = chunkText.indexOf(text, at + 1);
  }
  return -1;
}

const VIEWS: readonly FormulaView[] = ['placeholder', 'full'];

export const renderChunkView: ChunkViewRenderer = (artifact, blockRefs, chunkText, view) => {
  if (!VIEWS.includes(view)) throw new KgError('invalid_input', `unknown formula view ${String(view)}`);
  if (view === 'full') return chunkText;

  const doc = asDoclingDocument(artifact.document);
  const inInline = new Set<string>();
  for (const ref of blockRefs) {
    const node = resolveRef(doc, ref);
    if (ref.startsWith('#/groups/') && node.label === 'inline') descendantRefs(doc, node, inInline);
  }
  let out = '';
  let pos = 0;
  for (const ref of blockRefs) {
    const node = resolveRef(doc, ref);
    if (node.label !== 'formula') continue;
    const text = formulaBlockText(node);
    if (inInline.has(ref)) {
      // a split inline group keeps all its refs on every piece, so a formula may live in another piece: skip it
      const inside = findInlineItem(chunkText, text, pos);
      if (inside < 0) continue;
      out += chunkText.slice(pos, inside) + FORMULA_PLACEHOLDER;
      pos = inside + text.length;
      continue;
    }
    const at = findWholeBlock(chunkText, text, pos);
    if (at < 0) throw new KgError('invalid_input', `formula block ${ref} is not found as a whole block in the chunk text at or after offset ${pos}`);
    out += chunkText.slice(pos, at) + FORMULA_PLACEHOLDER;
    pos = at + text.length;
  }
  return out + chunkText.slice(pos);
};
