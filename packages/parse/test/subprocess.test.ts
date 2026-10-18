import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asDocKey, parseArtifactSchema, type ParseArtifact, type ParseRecipeSpec } from '@kg/core';
import { miniArtifact, miniParseRecipe } from '@kg/testkit';
import { parserConformance, registerSuite, expectKgError } from '@kg/testkit/conformance';
import { SubprocessParser } from '../src/index';

/**
 * A stub kg-parse. On parse it copies $KG_STUB_ENVELOPE into the --out directory and prints the result line with
 * $KG_STUB_SHA. KG_STUB_MODE=exit2 or exit3 (or exit4) fails instead, with a message on stderr.
 */
const STUB_LINES = [
  '#!/bin/sh',
  'mode="$KG_STUB_MODE"',
  'case "$mode" in',
  '  exit2) echo "docling crashed" >&2; exit 2 ;;',
  '  exit3) echo "docling version differs" >&2; exit 3 ;;',
  '  exit4) echo "unexpected" >&2; exit 4 ;;',
  'esac',
  'out=""',
  'while [ $# -gt 0 ]; do',
  '  if [ "$1" = "--out" ]; then out="$2"; fi',
  '  shift',
  'done',
  'mkdir -p "$out"',
  'cp "$KG_STUB_ENVELOPE" "$out/stub.kgparse.json.gz"',
  'printf \'{"path":"%s","sourceSha256":"%s"}\\n\' "$out/stub.kgparse.json.gz" "$KG_STUB_SHA"',
  '',
];

let dir: string;
let stub: string;
const env = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kg-parse-stub-'));
  stub = join(dir, 'kg-parse');
  await writeFile(stub, STUB_LINES.join('\n'));
  await chmod(stub, 0o755);
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Writes a source file and an envelope (gzip) for it; the envelope carries the given recipe and source hash. */
async function fixture(name: string, recipe: ParseRecipeSpec, envelopeSha?: string) {
  const sub = await mkdtemp(join(dir, 'case-'));
  const srcBytes = Buffer.from(`source bytes ${name}\n`);
  const srcPath = join(sub, `${name}.pdf`);
  await writeFile(srcPath, srcBytes);
  const sourceSha = sha(srcBytes);
  const envelope: ParseArtifact = { ...structuredClone(miniArtifact(1, 'entropy')), recipe: structuredClone(recipe), sourceSha256: envelopeSha ?? sourceSha };
  const envPath = join(sub, 'envelope.kgparse.json.gz');
  await writeFile(envPath, gzipSync(JSON.stringify(envelope)));
  return { srcPath, sourceSha, envPath, envelope };
}

function useStub(envPath: string, sha256: string, mode = 'ok') {
  process.env.KG_STUB_ENVELOPE = envPath;
  process.env.KG_STUB_SHA = sha256;
  process.env.KG_STUB_MODE = mode;
}

const formulaRecipe: ParseRecipeSpec = {
  ...miniParseRecipe(),
  spec: {
    ...miniParseRecipe().spec,
    formulaDecoding: { model: 'GLM-OCR-4bit', revision: 'r1', prompt: 'Formula Recognition:', cropMargin: 0.18 },
  },
};

// The shared conformance suite, run through the stub. The harness fixes the env for its single source.
registerSuite(
  parserConformance(async () => {
    const f = await fixture('entropy', miniParseRecipe());
    useStub(f.envPath, f.sourceSha);
    return {
      parser: new SubprocessParser({ command: stub }),
      sources: [{ path: f.srcPath, docKey: asDocKey('entropy') }],
      recipe: miniParseRecipe(),
      artifactPaths: [f.envPath],
      missingPath: join(dir, 'does-not-exist.pdf'),
    };
  }),
);

describe('SubprocessParser', () => {
  it('identify gives the sha256 of the bytes and the base name', async () => {
    const f = await fixture('ident', miniParseRecipe());
    const id = await new SubprocessParser({ command: stub }).identify(f.srcPath);
    expect(id).toEqual({ sha256: f.sourceSha, sourceName: 'ident.pdf' });
  });

  it('parse returns the artifact the sidecar wrote, validated and with the echoed recipe', async () => {
    const f = await fixture('ok', miniParseRecipe());
    useStub(f.envPath, f.sourceSha);
    const a = await new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('ok'), sha256: f.sourceSha }, miniParseRecipe());
    expect(parseArtifactSchema.safeParse(a).success).toBe(true);
    expect(a.sourceSha256).toBe(f.sourceSha);
  });

  it('a recipe with formulaDecoding is passed to the plain parse pass and echoed back', async () => {
    const f = await fixture('formula', formulaRecipe);
    useStub(f.envPath, f.sourceSha);
    const a = await new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('formula'), sha256: f.sourceSha }, formulaRecipe);
    expect(a.recipe).toEqual(formulaRecipe);
  });

  it('exit 2 from the sidecar is an upstream error', async () => {
    const f = await fixture('exit2', miniParseRecipe());
    useStub(f.envPath, f.sourceSha, 'exit2');
    const err = await expectKgError(() => new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('exit2'), sha256: f.sourceSha }, miniParseRecipe()), 'upstream');
    expect(err.message).toContain('docling crashed');
  });

  it('exit 3 from the sidecar is a precondition error', async () => {
    const f = await fixture('exit3', miniParseRecipe());
    useStub(f.envPath, f.sourceSha, 'exit3');
    await expectKgError(() => new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('exit3'), sha256: f.sourceSha }, miniParseRecipe()), 'precondition');
  });

  it('any other non-zero exit is an upstream error', async () => {
    const f = await fixture('exit4', miniParseRecipe());
    useStub(f.envPath, f.sourceSha, 'exit4');
    await expectKgError(() => new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('exit4'), sha256: f.sourceSha }, miniParseRecipe()), 'upstream');
  });

  it('a missing executable is a precondition error', async () => {
    const f = await fixture('nobin', miniParseRecipe());
    useStub(f.envPath, f.sourceSha);
    await expectKgError(() => new SubprocessParser({ command: join(dir, 'no-such-kg-parse') }).parse({ path: f.srcPath, docKey: asDocKey('nobin'), sha256: f.sourceSha }, miniParseRecipe()), 'precondition');
  });

  it('an artifact for a different source hash is an upstream error', async () => {
    const f = await fixture('shamismatch', miniParseRecipe(), 'a'.repeat(64));
    useStub(f.envPath, 'a'.repeat(64));
    await expectKgError(() => new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('shamismatch'), sha256: f.sourceSha }, miniParseRecipe()), 'upstream');
  });

  it('an artifact that does not echo the requested recipe is an upstream error', async () => {
    const f = await fixture('recipemismatch', miniParseRecipe());
    useStub(f.envPath, f.sourceSha);
    await expectKgError(() => new SubprocessParser({ command: stub }).parse({ path: f.srcPath, docKey: asDocKey('recipemismatch'), sha256: f.sourceSha }, formulaRecipe), 'upstream');
  });

  it('readArtifact rejects a file that fails the schema with invalid_input', async () => {
    const bad = join(dir, 'bad.kgparse.json');
    await writeFile(bad, JSON.stringify({ format: 'nope' }));
    await expectKgError(() => new SubprocessParser({ command: stub }).readArtifact(bad), 'invalid_input');
  });

  it('a missing source file is a not_found error from identify', async () => {
    await expectKgError(() => new SubprocessParser({ command: stub }).identify(join(dir, 'missing.pdf')), 'not_found');
  });
});
