/** The portable unit produced by the docling sidecar (anywhere) and read here. The document is opaque outside src/chunk. */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { KgError, type JsonObject } from '@kg/kernel';

export type ParseArtifact = {
  format: 'kg-parse-artifact/1';
  sourceSha256: string;
  sourceName: string;
  recipe: JsonObject;
  parser: { name: 'docling'; version: string };
  producedAt: string;
  producedOn: string;
  stats: JsonObject;
  /** DoclingDocument.export_to_dict() */
  document: JsonObject;
};

export type FormulaView = 'placeholder' | 'full';

export interface ChunkDraft {
  id: string;
  text: string;
  sectionPath: string[];
  occurrence: number;
  pages: number[];
  blockRefs: string[];
}
export type Chunker = (artifact: ParseArtifact, docKey: string, recipe: JsonObject) => ChunkDraft[];
export type ChunkViewRenderer = (artifact: ParseArtifact, blockRefs: readonly string[], chunkText: string, view: FormulaView) => string;

/** Checks the envelope and the few DoclingDocument keys the chunker needs. */
export function validateArtifact(value: unknown, where: string): ParseArtifact {
  const a = value as Partial<ParseArtifact> | null;
  const bad = (what: string) => new KgError('invalid_input', `${where}: invalid artifact: ${what}`);
  if (!a || typeof a !== 'object') throw bad('not an object');
  if (a.format !== 'kg-parse-artifact/1') throw bad('format must be kg-parse-artifact/1');
  if (typeof a.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sourceSha256)) throw bad('sourceSha256');
  if (typeof a.sourceName !== 'string' || a.sourceName === '') throw bad('sourceName');
  if (!a.recipe || typeof a.recipe !== 'object') throw bad('recipe');
  const d = a.document as { schema_name?: unknown; body?: { children?: unknown }; texts?: unknown } | undefined;
  if (!d || d.schema_name !== 'DoclingDocument' || !Array.isArray(d.body?.children) || !Array.isArray(d.texts)) throw bad('document is not a DoclingDocument');
  return a as ParseArtifact;
}

/** Reads a .kgparse.json or .kgparse.json.gz file and validates it. */
export async function readArtifactFile(path: string): Promise<ParseArtifact> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    throw new KgError(code === 'ENOENT' ? 'not_found' : 'invalid_input', `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse((path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  } catch {
    throw new KgError('invalid_input', `${path} is not valid JSON or gzip`);
  }
  return validateArtifact(value, path);
}
