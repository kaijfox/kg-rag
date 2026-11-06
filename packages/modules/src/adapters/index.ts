/**
 * Source adapters turn a source file into a document. A docling PDF becomes a parsed artifact that the section-pack
 * chunker cuts. A text source brings its own chunks. The kernel never reads a PDF.
 */
import { readFile } from 'node:fs/promises';
import { KgError, normText, sha256hex, type JsonObject } from '@kg/kernel';
import type { ParseArtifact } from '../parse/artifact';
import { ArtifactStore } from '../parse/artifacts';

export interface ChunkPiece {
  text: string;
  sectionPath: string[];
  meta?: JsonObject;
}

export interface LoadedDoc {
  docKey: string;
  sourceSha256: string;
  sourceName: string;
  parseRecipe: JsonObject;
  /** set when the document is not cut by the default chunk recipe */
  chunkRecipe?: JsonObject;
  meta: JsonObject;
  /** a parsed docling document: cut by the section-pack chunker */
  artifact?: ParseArtifact;
  /** a text source's own chunks, in reading order */
  pieces?: ChunkPiece[];
}

export interface SourceAdapter {
  name: string;
  load(src: { path: string; docKey: string; meta: JsonObject }, env: { parseRecipe: JsonObject; artifacts: ArtifactStore }): Promise<LoadedDoc>;
}

export const doclingPdf: SourceAdapter = {
  name: 'docling-pdf',
  async load(src, env) {
    const { sha256, sourceName } = await ArtifactStore.identify(src.path);
    const artifact = await env.artifacts.resolve(src.path, env.parseRecipe);
    return { docKey: src.docKey, sourceSha256: sha256, sourceName, parseRecipe: env.parseRecipe, meta: src.meta, artifact };
  },
};

async function readText(path: string): Promise<{ text: string; sha256: string }> {
  try {
    const buf = await readFile(path);
    return { text: buf.toString('utf8'), sha256: sha256hex(buf) };
  } catch (e) {
    throw new KgError((e as { code?: unknown }).code === 'ENOENT' ? 'not_found' : 'invalid_input', `cannot read ${path}`);
  }
}

const MARKDOWN_RECIPE: JsonObject = { kind: 'chunk', version: '1', spec: { algorithm: 'markdown-pack/1', targetChars: 1000, maxChars: 1500 } };
const MARKDOWN_PARSE: JsonObject = { kind: 'parse', version: '1', spec: { parser: 'markdown' } };

/** Splits markdown at headings; packs each section's paragraphs into chunks of about 1000 characters. */
export const markdown: SourceAdapter = {
  name: 'markdown',
  async load(src) {
    const { text, sha256 } = await readText(src.path);
    const pieces: ChunkPiece[] = [];
    const path: { level: number; text: string }[] = [];
    let body: string[] = [];
    const flush = () => {
      const paras = body.join('\n').split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
      body = [];
      let cur = '';
      for (const p of paras) {
        if (cur !== '' && normText(cur).length + 2 + normText(p).length > 1000) {
          pieces.push({ text: cur, sectionPath: path.map((h) => h.text) });
          cur = p;
        } else cur = cur === '' ? p : `${cur}\n\n${p}`;
      }
      if (cur !== '') pieces.push({ text: cur, sectionPath: path.map((h) => h.text) });
    };
    for (const line of text.split('\n')) {
      const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
      if (!h) {
        body.push(line);
        continue;
      }
      flush();
      while (path.length > 0 && path[path.length - 1]!.level >= h[1]!.length) path.pop();
      path.push({ level: h[1]!.length, text: h[2]! });
    }
    flush();
    return { docKey: src.docKey, sourceSha256: sha256, sourceName: src.path.split('/').pop()!, parseRecipe: MARKDOWN_PARSE, chunkRecipe: MARKDOWN_RECIPE, meta: src.meta, pieces };
  },
};

const ENTRY_RECIPE: JsonObject = { kind: 'chunk', version: '1', spec: { algorithm: 'entries/1' } };
const ENTRY_PARSE: JsonObject = { kind: 'parse', version: '1', spec: { parser: 'dated-entries' } };

/**
 * A log of dated entries, each under a second-level heading ("## 2026-10-17: Title"). One chunk per entry, with the
 * entry's date, title and key in the chunk's meta so that rules can relate entries.
 */
export const decisionLog: SourceAdapter = {
  name: 'decision-log',
  async load(src) {
    const { text, sha256 } = await readText(src.path);
    const pieces: ChunkPiece[] = [];
    const perDate = new Map<string, number>();
    let current: { heading: string; lines: string[] } | null = null;
    const close = () => {
      if (!current) return;
      const title = current.heading.replace(/^##\s+/, '').trim();
      const date = /^(\d{4}-\d{2}-\d{2})/.exec(title)?.[1] ?? null;
      const n = (perDate.get(date ?? 'undated') ?? 0) + 1;
      perDate.set(date ?? 'undated', n);
      const entryKey = `${date ?? 'undated'}#${n}`;
      pieces.push({ text: [current.heading, ...current.lines].join('\n').trim(), sectionPath: [title], meta: { entryKey, date, title } });
    };
    for (const line of text.split('\n')) {
      if (/^##\s+\S/.test(line) && !line.startsWith('###')) {
        close();
        current = { heading: line, lines: [] };
      } else if (current) current.lines.push(line);
    }
    close();
    return { docKey: src.docKey, sourceSha256: sha256, sourceName: src.path.split('/').pop()!, parseRecipe: ENTRY_PARSE, chunkRecipe: ENTRY_RECIPE, meta: src.meta, pieces };
  },
};

export function defaultAdapters(): Map<string, SourceAdapter> {
  return new Map([doclingPdf, markdown, decisionLog].map((a) => [a.name, a]));
}

/** The adapter name for a path when the source entry names none. */
export function adapterFor(path: string): string {
  if (/\.pdf$/i.test(path)) return 'docling-pdf';
  if (/\.(md|markdown|txt)$/i.test(path)) return 'markdown';
  throw new KgError('invalid_input', `no adapter for ${path}; name one in the source entry`);
}
