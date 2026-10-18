/** Reads <name>.kgparse.json[.gz] and <name>.hybrid.json[.gz] from a directory (default: test/corpa/stat-mech/artifacts). */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ParseArtifact } from '@kg/core';
export const DEFAULT_DIR = new URL('../../../../test/corpa/stat-mech/artifacts/', import.meta.url).pathname;
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : gunzipSync(readFileSync(`${p}.gz`)).toString('utf8'));
export const artifactNames = (dir = DEFAULT_DIR) =>
  [...new Set(readdirSync(dir).filter((f) => /\.kgparse\.json(\.gz)?$/.test(f)).map((f) => f.replace(/\.kgparse\.json(\.gz)?$/, '')))].sort();
export const readArtifact = (dir: string, name: string) => JSON.parse(read(join(dir, `${name}.kgparse.json`))) as ParseArtifact;
export const readHybrid = (dir: string, name: string) => JSON.parse(read(join(dir, `${name}.hybrid.json`))) as { text: string; headings: string[]; refs: string[] }[];
