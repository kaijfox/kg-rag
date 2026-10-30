import { readFileSync } from 'node:fs';
import { KgError, sha256hex } from '@kg/core';

export interface Prompt {
  system: string;
  user: string;
}

const DIR = new URL('./', import.meta.url);
const SPLIT = '\n=== user ===\n';

const cache = new Map<string, string>();
function read(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL(name, DIR), 'utf8');
    cache.set(name, text);
  }
  return text;
}

/** A prompt file split into its system part and its user part at the line `=== user ===`. */
export function loadPrompt(file: string): Prompt {
  const text = read(file);
  const at = text.indexOf(SPLIT);
  if (at < 0) throw new KgError('internal', `prompt ${file} has no "=== user ===" line`);
  return { system: text.slice(0, at).trim(), user: text.slice(at + SPLIT.length).trim() };
}

/** Fills {{name}} placeholders. A placeholder without a value is an error (nothing is left for the model to guess). */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z]+)\}\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new KgError('internal', `prompt placeholder {{${name}}} has no value`);
    return v;
  });
}

/**
 * sha256 over the named prompt files (sorted by name, each as name, NUL, content, NUL). A machine's recipe lists only
 * the files that machine loads, so editing another machine's prompt leaves this digest, and the recipe id, unchanged.
 */
export function promptDigest(files: readonly string[]): string {
  const parts = [...files].sort().map((f) => `${f}\u0000${read(f)}\u0000`);
  return sha256hex(parts.join(''));
}

/** sha256 of one prompt file's text (what a run records for the prompt of the answerer). */
export function fileDigest(file: string): string {
  return sha256hex(read(file));
}
