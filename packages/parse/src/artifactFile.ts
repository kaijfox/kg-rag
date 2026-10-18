import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { KgError, parseArtifactSchema, sha256hex, type ParseArtifact } from '@kg/core';

/** Maps a filesystem failure onto the contract's error codes. */
export function fsError(e: unknown, path: string): KgError {
  const code = (e as { code?: unknown }).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new KgError('not_found', `no file at ${path}`);
  return new KgError('invalid_input', `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
}

/** sha256 of the file bytes (lowercase hex) and the base name, as Parser.identify promises. */
export async function identifySource(path: string): Promise<{ sha256: string; sourceName: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (e) {
    throw fsError(e, path);
  }
  return { sha256: sha256hex(bytes), sourceName: basename(path) };
}

/** Checks a value against core's parseArtifactSchema; the error names the failing field by its zod path. */
export function validateArtifact(value: unknown, where: string): ParseArtifact {
  const r = parseArtifactSchema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0]!;
  const at = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  throw new KgError('invalid_input', `${where}: invalid artifact at ${at}: ${issue.message}`);
}

/** Reads a .kgparse.json or .kgparse.json.gz file and validates it. */
export async function readArtifactFile(path: string): Promise<ParseArtifact> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (e) {
    throw fsError(e, path);
  }
  let text: string;
  try {
    text = (path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  } catch (e) {
    throw new KgError('invalid_input', `${path} is not valid gzip: ${e instanceof Error ? e.message : String(e)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KgError('invalid_input', `${path} is not valid JSON`);
  }
  return validateArtifact(value, path);
}
