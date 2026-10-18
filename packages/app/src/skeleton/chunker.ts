/**
 * SKELETON implementation of section-pack/1 (spec: packages/chunk/CARD.md). Written in Phase 1 to run
 * the walking skeleton and the chunker spike; the Phase 2 `chunk` package replaces it.
 */
import {
  KgError,
  assignChunkIds,
  normText,
  type ChunkDraft,
  type ChunkRecipeSpec,
  type Chunker,
  type DocKey,
  type ParseArtifact,
} from '@kg/core';

type Ref = { $ref: string };
interface DNode {
  self_ref: string;
  label?: string;
  content_layer?: string;
  children?: Ref[];
  text?: string;
  level?: number;
  prov?: { page_no: number }[];
  captions?: Ref[];
  data?: { grid?: { text: string }[][] };
}

interface Block {
  text: string;
  refs: string[];
  pages: number[];
}
type Event = { kind: 'heading'; level: number; text: string } | { kind: 'block'; block: Block };

const TEXT_LABELS = new Set([
  'text',
  'paragraph',
  'list_item',
  'caption',
  'footnote',
  'code',
  'reference',
  'checkbox_selected',
  'checkbox_unselected',
  'handwritten_text',
]);
const SKIP_LABELS = new Set(['page_header', 'page_footer']);

function resolver(doc: Record<string, unknown>) {
  return (ref: string): DNode => {
    const m = /^#\/(\w+)\/(\d+)$/.exec(ref);
    if (!m) throw new KgError('invalid_input', `unresolvable ref ${ref}`);
    const arr = doc[m[1]!] as DNode[] | undefined;
    const node = arr?.[Number(m[2])];
    if (!node) throw new KgError('invalid_input', `dangling ref ${ref}`);
    return node;
  };
}

const pagesOf = (n: DNode) => (n.prov ?? []).map((p) => p.page_no);

/** Step 1: walk body in reading order and emit headings and blocks. */
export function normalize(doc: Record<string, unknown>): Event[] {
  const get = resolver(doc);
  const visited = new Set<string>();
  const out: Event[] = [];
  const isBody = (n: DNode) => (n.content_layer ?? 'body') === 'body';
  const block = (text: string, refs: string[], pages: number[]) => {
    if (normText(text) !== '') out.push({ kind: 'block', block: { text, refs, pages } });
  };
  const textOf = (n: DNode) => (n.label === 'formula' ? (normText(n.text ?? '') === '' ? '[formula]' : n.text!) : (n.text ?? ''));
  const captionsOf = (n: DNode) => {
    const caps = (n.captions ?? [])
      .filter((c) => !visited.has(c.$ref)) // a caption already emitted elsewhere is not repeated
      .map((c) => {
        visited.add(c.$ref);
        return get(c.$ref);
      });
    return { text: caps.map((c) => c.text ?? '').filter((t) => normText(t) !== ''), refs: caps.map((c) => c.self_ref), pages: caps.flatMap(pagesOf) };
  };

  const visit = (ref: string): void => {
    if (visited.has(ref)) return;
    visited.add(ref);
    const n = get(ref);
    if (!isBody(n)) return;
    const kind = ref.split('/')[1];
    if (kind === 'groups') {
      if (n.label === 'inline') {
        const parts: string[] = [];
        const refs: string[] = [];
        const pages: number[] = [];
        const collect = (r: string) => {
          if (visited.has(r)) return;
          visited.add(r);
          const c = get(r);
          if (!isBody(c)) return;
          if (r.startsWith('#/texts/')) {
            parts.push(textOf(c));
            refs.push(c.self_ref);
            pages.push(...pagesOf(c));
          }
          for (const cc of c.children ?? []) collect(cc.$ref);
        };
        for (const c of n.children ?? []) collect(c.$ref);
        block(parts.filter((p) => normText(p) !== '').join(' '), refs, pages);
        return;
      }
      for (const c of n.children ?? []) visit(c.$ref);
      return;
    }
    if (kind === 'texts') {
      const label = n.label ?? 'text';
      if (label === 'title') {
        if (normText(n.text ?? '') !== '') out.push({ kind: 'heading', level: 0, text: n.text! });
      } else if (label === 'section_header') {
        if (normText(n.text ?? '') !== '') out.push({ kind: 'heading', level: n.level ?? 1, text: n.text! });
      } else if (SKIP_LABELS.has(label)) {
        // furniture-like even when in the body layer
      } else if (label === 'formula' || TEXT_LABELS.has(label) || normText(n.text ?? '') !== '') {
        block(textOf(n), [n.self_ref], pagesOf(n));
      }
      for (const c of n.children ?? []) visit(c.$ref);
      return;
    }
    if (kind === 'tables') {
      const cap = captionsOf(n);
      for (const c of n.children ?? []) visited.add(c.$ref); // table children are its captions/footnotes
      const rows = (n.data?.grid ?? []).map((row) => row.map((c) => c.text).join(' | '));
      const grid = rows.join('\n');
      const parts = [...cap.text, ...(normText(grid) !== '' ? [grid] : [])];
      block(parts.join('\n'), [n.self_ref, ...cap.refs], [...pagesOf(n), ...cap.pages]);
      return;
    }
    if (kind === 'pictures') {
      const cap = captionsOf(n);
      for (const c of n.children ?? []) visited.add(c.$ref); // figure-internal labels never leak
      block(cap.text.join('\n'), [n.self_ref, ...cap.refs], [...pagesOf(n), ...cap.pages]);
      return;
    }
    // key_value_items, form_items: skipped in v0
  };

  const body = doc['body'] as DNode | undefined;
  if (!body) throw new KgError('invalid_input', 'document has no body');
  for (const c of body.children ?? []) visit(c.$ref);
  return out;
}

/** Block length = normText length (S5): whitespace-only differences never move a chunk boundary. */
export const nlen = (s: string) => normText(s).length;

/**
 * Step 3: split a block whose normalized length exceeds maxChars. Each piece is the longest prefix (of the
 * remainder) with normalized length <= maxChars that ends at a sentence end ("." + whitespace + uppercase), else that longest
 * shortest prefix whose normalized length is exactly maxChars (hard cut).
 */
export function splitBlock(b: Block, maxChars: number): Block[] {
  if (nlen(b.text) <= maxChars) return [b];
  const pieces: Block[] = [];
  const t = b.text;
  let s = 0;
  while (nlen(t.slice(s)) > maxChars) {
    // largest end (exclusive) with nlen(t[s..end)) <= maxChars; nlen is monotone in end
    let lo = s + 1;
    let hi = t.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (nlen(t.slice(s, mid)) <= maxChars) lo = mid;
      else hi = mid - 1;
    }
    const limit = lo;
    let cut = -1;
    let next = -1;
    for (let e = limit - 1; e > s; e--) {
      if (t[e] !== '.') continue;
      const m = /^\.(\s+)\p{Lu}/u.exec(t.slice(e, e + 64));
      if (m) {
        cut = e;
        next = e + 1 + m[1]!.length;
        break;
      }
    }
    if (cut >= 0) {
      pieces.push({ ...b, text: t.slice(s, cut + 1) });
      s = next;
    } else {
      // hard cut: the SHORTEST prefix whose normalized length reaches maxChars (trailing whitespace stays with the
      // next piece, as with a plain cut at maxChars characters of single-spaced text)
      let lo2 = s + 1;
      let hi2 = limit;
      while (lo2 < hi2) {
        const mid = Math.floor((lo2 + hi2) / 2);
        if (nlen(t.slice(s, mid)) >= maxChars) hi2 = mid;
        else lo2 = mid + 1;
      }
      pieces.push({ ...b, text: t.slice(s, lo2) });
      s = lo2;
    }
  }
  pieces.push({ ...b, text: t.slice(s) });
  return pieces;
}

interface Packed {
  sectionPath: string[];
  blocks: Block[];
}
const joinedLength = (bs: Block[]) => bs.reduce((n, b) => n + nlen(b.text), 0) + 2 * Math.max(0, bs.length - 1);

export const sectionPack: Chunker = (artifact: ParseArtifact, docKey: DocKey, recipe: ChunkRecipeSpec): ChunkDraft[] => {
  if (recipe.spec.algorithm !== 'section-pack/1') throw new KgError('invalid_input', `unsupported algorithm ${recipe.spec.algorithm}`);
  const { targetChars: T, maxChars: M, minChars: m } = recipe.spec;
  const events = normalize(artifact.document as Record<string, unknown>);

  const chunks: Packed[] = [];
  const stack: { level: number; text: string }[] = [];
  let section: Block[] = [];
  const flushSection = () => {
    const path = stack.map((h) => h.text);
    const out: Block[][] = [];
    let cur: Block[] = [];
    for (const b of section.flatMap((x) => splitBlock(x, M))) {
      if (cur.length === 0) {
        cur = [b];
        continue;
      }
      const curLen = joinedLength(cur);
      const j = curLen + 2 + nlen(b.text);
      if (j <= T || (curLen < m && j <= M)) cur.push(b);
      else {
        out.push(cur);
        cur = [b];
      }
    }
    if (cur.length) out.push(cur);
    if (out.length >= 2) {
      const last = out[out.length - 1]!;
      const prev = out[out.length - 2]!;
      if (joinedLength(last) < m && joinedLength(prev) + 2 + joinedLength(last) <= M) {
        out.splice(out.length - 2, 2, [...prev, ...last]);
      }
    }
    for (const bs of out) chunks.push({ sectionPath: path, blocks: bs });
    section = [];
  };

  for (const ev of events) {
    if (ev.kind === 'heading') {
      flushSection();
      while (stack.length && stack[stack.length - 1]!.level >= ev.level) stack.pop();
      stack.push({ level: ev.level, text: ev.text });
    } else section.push(ev.block);
  }
  flushSection();

  const drafts = chunks.map((c) => ({
    text: c.blocks.map((b) => b.text).join('\n\n'),
    sectionPath: c.sectionPath,
    pages: [...new Set(c.blocks.flatMap((b) => b.pages))].sort((a, b) => a - b),
    blockRefs: [...new Set(c.blocks.flatMap((b) => b.refs))],
  }));
  return assignChunkIds(docKey, drafts).map((d) => ({
    id: d.id,
    text: d.text,
    sectionPath: d.sectionPath,
    occurrence: d.occurrence,
    pages: d.pages,
    blockRefs: d.blockRefs,
  }));
};
