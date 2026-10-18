import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { KgError, parseRecipeSchema, recipesEqual, type ParseArtifact, type ParseRecipeSpec, type Parser, type SourceRef } from '@kg/core';
import { identifySource, readArtifactFile } from './artifactFile';

export interface SubprocessParserOptions {
  /** the kg-parse executable (a name looked up on PATH, or a path). Default: kg-parse */
  command?: string;
  /** directory for the per-call temporary recipe and output files. Default: the OS temp directory */
  workDir?: string;
}

interface ParseLine {
  path: string;
  sourceSha256?: string;
}

const MAX_STDERR = 2000;

function tail(s: string): string {
  return s.length > MAX_STDERR ? s.slice(-MAX_STDERR) : s;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return done(stdout);
      const code = (err as { code?: unknown }).code;
      if (code === 'ENOENT') return fail(new KgError('precondition', `kg-parse executable not found: ${command}`));
      if (code === 3) return fail(new KgError('precondition', `kg-parse refused the recipe (exit 3): ${tail(stderr)}`));
      const how = typeof code === 'number' ? `exit ${code}` : `signal ${(err as { signal?: unknown }).signal ?? 'unknown'}`;
      return fail(new KgError('upstream', `kg-parse failed (${how}): ${tail(stderr)}`));
    });
  });
}

/** The last stdout line that is a JSON object with a string path (earlier lines may be logs). */
function parseStdout(stdout: string): ParseLine {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]!) as Partial<ParseLine>;
      if (typeof v.path === 'string') return { path: v.path, sourceSha256: v.sourceSha256 };
    } catch {
      // not the result line; keep looking
    }
  }
  throw new KgError('upstream', `kg-parse printed no result line: ${tail(stdout)}`);
}

/** Runs the kg-parse CLI (contract in packages/parse-sidecar/CARD.md) and reads back what it wrote. */
export class SubprocessParser implements Parser {
  readonly command: string;
  private readonly workDir: string | undefined;

  constructor(opts: SubprocessParserOptions = {}) {
    this.command = opts.command ?? 'kg-parse';
    this.workDir = opts.workDir;
  }

  identify(path: string): Promise<{ sha256: string; sourceName: string }> {
    return identifySource(path);
  }

  async parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    const checked = parseRecipeSchema.safeParse(recipe);
    if (!checked.success) throw new KgError('invalid_input', `parse recipe: ${checked.error.issues[0]?.message ?? 'invalid'}`);
    const tmp = await mkdtemp(join(this.workDir ?? tmpdir(), 'kg-parse-'));
    try {
      const recipeFile = join(tmp, 'recipe.json');
      const outDir = join(tmp, 'out');
      await mkdir(outDir);
      await writeFile(recipeFile, JSON.stringify(recipe));
      const stdout = await runCommand(this.command, ['parse', '--input', src.path, '--recipe', recipeFile, '--out', outDir]);
      const line = parseStdout(stdout);
      const artifactPath = isAbsolute(line.path) ? line.path : resolve(outDir, line.path);
      let artifact: ParseArtifact;
      try {
        artifact = await readArtifactFile(artifactPath);
      } catch (e) {
        if (e instanceof KgError) throw new KgError('upstream', `kg-parse wrote an unreadable artifact: ${e.message}`);
        throw e;
      }
      if (artifact.sourceSha256 !== src.sha256 || line.sourceSha256 !== src.sha256) {
        throw new KgError('upstream', `kg-parse output is for sha256 ${artifact.sourceSha256}, expected ${src.sha256}`);
      }
      if (!recipesEqual(artifact.recipe, recipe)) {
        throw new KgError('upstream', 'kg-parse did not echo the requested recipe');
      }
      return artifact;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  readArtifact(path: string): Promise<ParseArtifact> {
    return readArtifactFile(path);
  }
}
