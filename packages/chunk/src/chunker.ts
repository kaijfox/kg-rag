/**
 * section-pack/1: walks the docling body in reading order into sections of measured blocks, splits long blocks,
 * packs each section into chunks and assigns IDs with core's assignChunkIds.
 */
import {
  KgError,
  assignChunkIds,
  type ChunkDraft,
  type ChunkRecipeSpec,
  type Chunker,
  type DocKey,
  type ParseArtifact,
} from '@kg/core';
import {
  FORMULA_MEASURE,
  FORMULA_PLACEHOLDER,
  asDoclingDocument,
  formulaBlockText,
  inlineItemText,
  isSkippedRef,
  joinBlocks,
  resolveRef,
  type DocNode,
  type DoclingDocument,
} from './blocks';
import { normLength, splitBlock } from './split';

/** One packable block. `measure` is the length the packing rules see (normalized; formula blocks at placeholder length). */
export type Block = {
  text: string;
  measure: number;
  refs: string[];
  pages: number[];
  formula: boolean;
};

type Section = { path: string[]; blocks: Block[] };

const isBody = (n: DocNode) => (n.content_layer ?? 'body') === 'body' && n.label !== 'page_header' && n.label !== 'page_footer';
const pagesOf = (n: DocNode): number[] => (n.prov ?? []).map((p) => p.page_no);
const captionTexts = (refs: DocNode[]) => refs.map((c) => c.text ?? '').filter((t) => normLength(t) > 0);

/** Lengths of a packed chunk: the sum of its blocks, plus 2 per `\n\n` join. */
const chunkLength = (blocks: readonly Block[]): number =>
  blocks.reduce((n, b) => n + b.measure, 0) + 2 * Math.max(0, blocks.length - 1);

/** Walks body.children in reading order (section-pack/1 rule 1 and 2). */
export function walkDocument(doc: DoclingDocument, maxChars: number): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section = { path: [], blocks: [] };
  sections.push(current);
  const visited = new Set<string>();

  const startSection = (level: number, text: string) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text });
    current = { path: stack.map((h) => h.text), blocks: [] };
    sections.push(current);
  };

  const emit = (text: string, refs: string[], pages: number[], formula: boolean, measureText?: string) => {
    if (formula) {
      current.blocks.push({ text, measure: FORMULA_MEASURE, refs, pages, formula: true });
      return;
    }
    if (normLength(text) === 0) return;
    if (measureText !== undefined && normLength(measureText) <= maxChars) {
      current.blocks.push({ text, measure: normLength(measureText), refs, pages, formula: false });
      return;
    }
    for (const piece of splitBlock(text, maxChars))
      current.blocks.push({ text: piece, measure: normLength(piece), refs, pages, formula: false });
  };

  /** Captions not yet visited, in order; each is marked visited. */
  const takeCaptions = (node: DocNode): DocNode[] => {
    const out: DocNode[] = [];
    for (const c of node.captions ?? []) {
      if (visited.has(c.$ref)) continue;
      visited.add(c.$ref);
      out.push(resolveRef(doc, c.$ref));
    }
    return out;
  };

  const markChildrenVisited = (node: DocNode) => {
    for (const c of node.children ?? []) visited.add(c.$ref);
  };

  /** Text descendants of an inline group, in order, each marked visited. */
  const inlineTexts = (node: DocNode, texts: DocNode[]) => {
    for (const c of node.children ?? []) {
      if (isSkippedRef(c.$ref) || visited.has(c.$ref)) continue;
      visited.add(c.$ref);
      const child = resolveRef(doc, c.$ref);
      if (!isBody(child)) continue;
      if (c.$ref.startsWith('#/texts/')) texts.push(child);
      inlineTexts(child, texts);
    }
  };

  const visit = (ref: string) => {
    if (isSkippedRef(ref) || visited.has(ref)) return;
    visited.add(ref);
    const node = resolveRef(doc, ref);
    if (!isBody(node)) return;

    if (ref.startsWith('#/groups/')) {
      if (node.label === 'inline') {
        const texts: DocNode[] = [];
        inlineTexts(node, texts);
        const refs = [node.self_ref, ...texts.map((t) => t.self_ref)];
        const pages = [...new Set(texts.flatMap(pagesOf))];
        const join = (parts: string[]) => parts.filter((t) => normLength(t) > 0).join(' ');
        // formulas inside the group are measured at placeholder length, like whole formula blocks
        const measured = texts.map((t) => (t.label === 'formula' ? FORMULA_PLACEHOLDER : (t.text ?? '')));
        emit(join(texts.map(inlineItemText)), refs, pages, false, join(measured));
        return;
      }
      for (const c of node.children ?? []) visit(c.$ref);
      return;
    }

    if (ref.startsWith('#/tables/')) {
      const caps = takeCaptions(node);
      markChildrenVisited(node);
      const grid = (node.data?.grid ?? []).map((row) => row.map((cell) => cell.text ?? '').join(' | ')).join('\n');
      const text = [captionTexts(caps).join('\n'), grid].filter((s) => s !== '').join('\n');
      emit(text, [node.self_ref, ...caps.map((c) => c.self_ref)], [...new Set([...pagesOf(node), ...caps.flatMap(pagesOf)])], false);
      return;
    }

    if (ref.startsWith('#/pictures/')) {
      const caps = takeCaptions(node);
      markChildrenVisited(node);
      const text = captionTexts(caps).join('\n');
      emit(text, [node.self_ref, ...caps.map((c) => c.self_ref)], [...new Set([...pagesOf(node), ...caps.flatMap(pagesOf)])], false);
      return;
    }

    const label = node.label ?? 'text';
    if (label === 'title') startSection(0, node.text ?? '');
    else if (label === 'section_header') startSection(node.level ?? 1, node.text ?? '');
    else if (label === 'formula') emit(formulaBlockText(node), [node.self_ref], pagesOf(node), true);
    else emit(node.text ?? '', [node.self_ref], pagesOf(node), false);

    for (const c of node.children ?? []) visit(c.$ref);
  };

  for (const c of doc.body.children ?? []) visit(c.$ref);
  return sections;
}

/** Packs one section's blocks (rules 4 and 5). */
export function packBlocks(blocks: readonly Block[], targetChars: number, maxChars: number, minChars: number): Block[][] {
  const chunks: Block[][] = [];
  let cur: Block[] = [];
  let curLen = 0;
  for (const b of blocks) {
    if (cur.length === 0) {
      cur = [b];
      curLen = b.measure;
      continue;
    }
    const joined = curLen + 2 + b.measure;
    if (joined <= targetChars || (curLen < minChars && joined <= maxChars)) {
      cur.push(b);
      curLen = joined;
    } else {
      chunks.push(cur);
      cur = [b];
      curLen = b.measure;
    }
  }
  if (cur.length > 0) chunks.push(cur);

  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]!;
    const prev = chunks[chunks.length - 2]!;
    if (chunkLength(last) < minChars && chunkLength(prev) + 2 + chunkLength(last) <= maxChars) {
      chunks.splice(chunks.length - 2, 2, [...prev, ...last]);
    }
  }
  return chunks;
}

function checkRecipe(recipe: ChunkRecipeSpec): { targetChars: number; maxChars: number; minChars: number } {
  const { algorithm, targetChars, maxChars, minChars } = recipe.spec;
  if (algorithm !== 'section-pack/1') throw new KgError('invalid_input', `unknown chunk algorithm ${String(algorithm)}`);
  for (const [name, v] of [
    ['targetChars', targetChars],
    ['maxChars', maxChars],
  ] as const)
    if (!Number.isInteger(v) || v <= 0) throw new KgError('invalid_input', `${name} must be a positive integer`);
  if (!Number.isInteger(minChars) || minChars < 0) throw new KgError('invalid_input', 'minChars must be a non-negative integer');
  return { targetChars, maxChars, minChars };
}

/** The section-pack/1 chunker. Pure and deterministic; does not mutate its input. */
export const sectionPack: Chunker = (artifact: ParseArtifact, docKey: DocKey, recipe: ChunkRecipeSpec): ChunkDraft[] => {
  const { targetChars, maxChars, minChars } = checkRecipe(recipe);
  const doc = asDoclingDocument(artifact.document);
  if (doc === null || typeof doc !== 'object' || doc.body === null || typeof doc.body !== 'object')
    throw new KgError('invalid_input', 'parse artifact document has no body');
  const drafts: Omit<ChunkDraft, 'id' | 'occurrence'>[] = [];
  for (const section of walkDocument(doc, maxChars)) {
    for (const blocks of packBlocks(section.blocks, targetChars, maxChars, minChars)) {
      const pages = [...new Set(blocks.flatMap((b) => b.pages))].sort((a, b) => a - b);
      const refs = [...new Set(blocks.flatMap((b) => b.refs))];
      drafts.push({
        sectionPath: [...section.path],
        text: joinBlocks(blocks.map((b) => b.text)),
        pages,
        blockRefs: refs,
      });
    }
  }
  return assignChunkIds(docKey, drafts);
}
