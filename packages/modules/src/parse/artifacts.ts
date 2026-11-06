/**
 * Parsed documents are kept, because a rebuild starts from them and docling is slow. The store looks a parsed document
 * up by the source file's hash and the parse recipe, in its own directory first and then in extra directories (artifacts
 * produced elsewhere, for example on a GPU machine), and runs the docling sidecar only when none matches.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { KgError, canonicalJson, sha256hex, type Json, type JsonObject } from '@kg/kernel';
import { readArtifactFile, type ParseArtifact } from './artifact';

const NAME = /\.kgparse\.json(\.gz)?$/;

export interface ArtifactStoreOptions {
  /** where parsed documents are kept */
  dir: string;
  /** read-only directories searched before the sidecar runs */
  extraDirs?: string[];
  /** the kg-parse command; null: never run the sidecar (a miss is `not_found`) */
  sidecar?: string | null;
}

export class ArtifactStore {
  constructor(private readonly o: ArtifactStoreOptions) {}

  /** sha256 of the file's bytes */
  static async identify(path: string): Promise<{ sha256: string; sourceName: string }> {
    try {
      return { sha256: sha256hex(await readFile(path)), sourceName: basename(path) };
    } catch (e) {
      throw new KgError((e as { code?: unknown }).code === 'ENOENT' ? 'not_found' : 'invalid_input', `cannot read ${path}`);
    }
  }

  private fileFor(sha: string, recipe: JsonObject): string {
    return join(this.o.dir, `${sha.slice(0, 16)}.${createHash('sha256').update(canonicalJson(recipe as Json)).digest('hex').slice(0, 12)}.kgparse.json.gz`);
  }

  /** The artifact for this source hash and recipe if one is kept or found in an extra directory. */
  async find(sha: string, recipe: JsonObject): Promise<ParseArtifact | null> {
    const want = canonicalJson(recipe as Json);
    const direct = this.fileFor(sha, recipe);
    try {
      return await readArtifactFile(direct);
    } catch (e) {
      if (!(e instanceof KgError) || e.code !== 'not_found') throw e;
    }
    for (const dir of [this.o.dir, ...(this.o.extraDirs ?? [])]) {
      let names: string[];
      try {
        names = (await readdir(dir)).filter((n) => NAME.test(n)).sort();
      } catch {
        continue;
      }
      for (const n of names) {
        const a = await readArtifactFile(join(dir, n));
        if (a.sourceSha256 === sha && canonicalJson(a.recipe as Json) === want) return a;
      }
    }
    return null;
  }

  async put(a: ParseArtifact): Promise<string> {
    await mkdir(this.o.dir, { recursive: true });
    const file = this.fileFor(a.sourceSha256, a.recipe);
    await writeFile(file, gzipSync(Buffer.from(JSON.stringify(a), 'utf8')));
    return file;
  }

  /** Returns the parsed document for a source file, running the sidecar when nothing kept matches, and keeps the result. */
  async resolve(path: string, recipe: JsonObject): Promise<ParseArtifact> {
    const { sha256 } = await ArtifactStore.identify(path);
    const hit = await this.find(sha256, recipe);
    if (hit) return hit;
    if (!this.o.sidecar) throw new KgError('not_found', `no parsed document for ${path} (sha256 ${sha256.slice(0, 12)}…) and the parser is off`);
    const a = await runSidecar(this.o.sidecar, resolve(path), recipe, sha256);
    await this.put(a);
    return a;
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return done(stdout);
      const code = (err as { code?: unknown }).code;
      if (code === 'ENOENT') return fail(new KgError('precondition', `parser command not found: ${command}`));
      fail(new KgError(code === 3 ? 'precondition' : 'upstream', `kg-parse failed (${String(code)}): ${stderr.slice(-1500)}`));
    });
  });
}

async function runSidecar(command: string, input: string, recipe: JsonObject, sha: string): Promise<ParseArtifact> {
  const tmp = await mkdtemp(join(tmpdir(), 'kg-parse-'));
  try {
    const recipeFile = join(tmp, 'recipe.json');
    const out = join(tmp, 'out');
    await mkdir(out);
    await writeFile(recipeFile, JSON.stringify(recipe));
    const stdout = await run(command, ['parse', '--input', input, '--recipe', recipeFile, '--out', out]);
    const line = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).reverse().map((l) => { try { return JSON.parse(l) as { path?: string }; } catch { return {}; } }).find((v) => typeof v.path === 'string');
    if (!line?.path) throw new KgError('upstream', `kg-parse printed no result line: ${stdout.slice(-500)}`);
    const a = await readArtifactFile(isAbsolute(line.path) ? line.path : resolve(out, line.path));
    if (a.sourceSha256 !== sha) throw new KgError('upstream', 'kg-parse output is for a different source file');
    if (canonicalJson(a.recipe as Json) !== canonicalJson(recipe as Json)) throw new KgError('upstream', 'kg-parse did not echo the requested recipe');
    return a;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
