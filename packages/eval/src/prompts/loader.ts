import { readFileSync } from 'node:fs';
import { KgError, sha256hex } from '@kg/kernel';

export interface Prompt {
  system: string;
  user: string;
}

const DIR = new URL('./', import.meta.url);
const SPLIT = '\n=== user ===\n';
const cache = new Map<string, string>();
const read = (name: string): string => {
  let t = cache.get(name);
  if (t === undefined) cache.set(name, (t = readFileSync(new URL(name, DIR), 'utf8')));
  return t;
};

/** A prompt file split into its system part and its user part at the line `=== user ===`. */
export function loadPrompt(file: string): Prompt {
  const text = read(file);
  const at = text.indexOf(SPLIT);
  if (at < 0) throw new KgError('internal', `prompt ${file} has no "=== user ===" line`);
  return { system: text.slice(0, at).trim(), user: text.slice(at + SPLIT.length).trim() };
}

/** Fills {{name}} placeholders. A placeholder without a value is an error. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z]+)\}\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new KgError('internal', `prompt placeholder {{${name}}} has no value`);
    return v;
  });
}

/** sha256 over the named prompt files, so a run can record which prompts it used. */
export function promptDigest(files: readonly string[]): string {
  return sha256hex([...files].sort().map((f) => `${f}\u0000${read(f)}\u0000`).join(''));
}
