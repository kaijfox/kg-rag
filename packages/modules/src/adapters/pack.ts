import { normText } from '@kg/kernel';
import type { ChunkPiece } from './index';

/** A passage never exceeds this many characters: the embedding model has a context limit, and one oversized passage would stop an ingest. */
export const MAX_PASSAGE = 1500;

function cutLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    if (word.length > MAX_PASSAGE) {
      if (cur !== '') (out.push(cur), (cur = ''));
      for (let i = 0; i < word.length; i += MAX_PASSAGE) out.push(word.slice(i, i + MAX_PASSAGE));
    } else if (cur !== '' && cur.length + 1 + word.length > MAX_PASSAGE) {
      out.push(cur);
      cur = word;
    } else cur = cur === '' ? word : `${cur} ${word}`;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Cuts a paragraph that is too long at line breaks (and at spaces inside a line that is itself too long). */
export function cutParagraph(p: string): string[] {
  if (p.length <= MAX_PASSAGE) return [p];
  const out: string[] = [];
  let cur = '';
  for (const line of p.split('\n')) {
    for (const part of line.length > MAX_PASSAGE ? cutLine(line) : [line]) {
      if (cur !== '' && cur.length + 1 + part.length > MAX_PASSAGE) {
        out.push(cur);
        cur = part;
      } else cur = cur === '' ? part : `${cur}\n${part}`;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Packs a section's paragraphs, in order, into passages of about 1000 characters, none over MAX_PASSAGE. */
export function packParagraphs(paras: readonly string[], sectionPath: string[]): ChunkPiece[] {
  const out: ChunkPiece[] = [];
  let cur = '';
  for (const p of paras.flatMap(cutParagraph)) {
    if (cur !== '' && normText(cur).length + 2 + normText(p).length > 1000) {
      out.push({ text: cur, sectionPath });
      cur = p;
    } else cur = cur === '' ? p : `${cur}\n\n${p}`;
  }
  if (cur !== '') out.push({ text: cur, sectionPath });
  return out;
}
