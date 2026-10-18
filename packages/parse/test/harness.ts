import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { asDocKey } from '@kg/core';
import { MINI_DOCS, miniArtifact, miniParseRecipe } from '@kg/testkit';
import type { ParserHarness } from '@kg/testkit/conformance';
import { ArtifactDirParser } from '../src/index';

/**
 * Copies the mini-corpus v1 artifacts into a fresh temp directory. Each source is a fake file (its bytes are not a
 * real PDF); its sha256 becomes the copied envelope's sourceSha256, so the artifact matches the source it names.
 * Source files are named after the artifact's sourceName (for example entropy.pdf), so identify's base name matches.
 */
export async function makeArtifactDirHarness(): Promise<ParserHarness> {
  const root = await mkdtemp(join(tmpdir(), 'kg-parse-artdir-'));
  const srcDir = join(root, 'sources');
  const artDir = join(root, 'artifacts');
  await mkdir(srcDir);
  await mkdir(artDir);
  const sources: { path: string; docKey: ReturnType<typeof asDocKey> }[] = [];
  const artifactPaths: string[] = [];
  for (const doc of MINI_DOCS) {
    const bytes = Buffer.from(`fake source bytes for the ${doc} fixture\n`);
    const srcPath = join(srcDir, `${doc}.pdf`);
    await writeFile(srcPath, bytes);
    const envelope = structuredClone(miniArtifact(1, doc));
    envelope.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    const artPath = join(artDir, `${doc}.kgparse.json.gz`);
    await writeFile(artPath, gzipSync(JSON.stringify(envelope)));
    sources.push({ path: srcPath, docKey: asDocKey(doc) });
    artifactPaths.push(artPath);
  }
  return {
    parser: new ArtifactDirParser(artDir),
    sources,
    recipe: miniParseRecipe(),
    artifactPaths,
    missingPath: join(root, 'missing.pdf'),
  };
}
