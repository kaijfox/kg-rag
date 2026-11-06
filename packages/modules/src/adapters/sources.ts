/**
 * Turns the source list of kg.json into files. An entry names a file or a directory. A directory stands for every file in
 * it (and below it) that its adapter reads, so a documentation build or a notes folder is one entry and new files are
 * picked up by the next ingest. Hidden folders and node_modules are skipped.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { KgError, defaultDocKey, type JsonObject, type SourceEntry } from '@kg/kernel';
import { adapterFor } from './index';

const READS: Record<string, RegExp> = {
  'docling-pdf': /\.pdf$/i,
  markdown: /\.(md|markdown|txt)$/i,
  'decision-log': /\.(md|markdown|txt)$/i,
  html: /\.(html?|xhtml)$/i,
};

export interface SourceFile {
  /** the entry of kg.json this file came from */
  entry: SourceEntry;
  path: string;
  docKey: string;
  adapter: string;
  meta: JsonObject;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** Document key for a file found under a directory: its path below the directory, without the extension, joined by "›". */
function nestedKey(prefix: string | undefined, root: string, file: string): string {
  const rel = relative(root, file).split(sep).join(' › ');
  const dot = rel.lastIndexOf('.');
  const stem = dot > 0 ? rel.slice(0, dot) : rel;
  return prefix ? `${prefix} › ${stem}` : stem;
}

/**
 * `missing` lists entries whose path does not exist. Their documents are kept: a path can be missing because a drive is
 * not mounted, and only `kg remove` drops a source.
 */
export function expandSources(entries: readonly SourceEntry[], baseDir: string): { files: SourceFile[]; missing: string[] } {
  const files: SourceFile[] = [];
  const missing: string[] = [];
  const keys = new Map<string, string>();
  for (const entry of entries) {
    const abs = isAbsolute(entry.path) ? entry.path : join(baseDir, entry.path);
    if (!existsSync(abs)) {
      missing.push(entry.path);
      continue;
    }
    const meta = { ...(entry.meta ?? {}), source: entry.path } as JsonObject;
    const add = (path: string, docKey: string, adapter: string) => {
      const clash = keys.get(docKey);
      if (clash) throw new KgError('invalid_input', `${path} and ${clash} both have the document key ${JSON.stringify(docKey)}; give one of the sources a doc-key`);
      keys.set(docKey, path);
      files.push({ entry, path, docKey, adapter, meta });
    };
    if (statSync(abs).isDirectory()) {
      const all: string[] = [];
      walk(abs, all);
      let pattern: RegExp | null = null;
      try {
        pattern = entry.pattern ? new RegExp(entry.pattern) : null;
      } catch {
        throw new KgError('invalid_input', `the pattern ${JSON.stringify(entry.pattern)} of source ${entry.path} is not a regular expression`);
      }
      let exclude: RegExp | null = null;
      try {
        exclude = entry.exclude ? new RegExp(entry.exclude) : null;
      } catch {
        throw new KgError('invalid_input', `the exclude of source ${entry.path} is not a regular expression`);
      }
      for (const f of all) {
        if (pattern && !pattern.test(basename(f))) continue;
        if (exclude && exclude.test(relative(abs, f).split(sep).join('/'))) continue;
        let adapter = entry.adapter;
        if (adapter) {
          if (!(READS[adapter] ?? /./).test(f)) continue;
        } else {
          try {
            adapter = adapterFor(f);
          } catch {
            continue;
          }
        }
        add(f, nestedKey(entry.docKey, abs, f), adapter);
      }
    } else add(abs, entry.docKey ?? defaultDocKey(entry.path), entry.adapter ?? adapterFor(entry.path));
  }
  return { files, missing };
}
