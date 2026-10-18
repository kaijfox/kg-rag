import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { KgError, recipesEqual, type ParseArtifact, type ParseRecipeSpec, type Parser, type SourceRef } from '@kg/core';
import { fsError, identifySource, readArtifactFile } from './artifactFile';

const ARTIFACT_NAME = /\.kgparse\.json(\.gz)?$/;

/**
 * Serves artifacts that were produced elsewhere and copied into a directory. Candidates are read in file-name
 * order; the first one with the requested source hash and an identical recipe wins. A file in the directory that
 * is not a valid artifact makes parse fail with invalid_input, even when it is not the one needed.
 */
export class ArtifactDirParser implements Parser {
  constructor(readonly dir: string) {}

  identify(path: string): Promise<{ sha256: string; sourceName: string }> {
    return identifySource(path);
  }

  async parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    for (const name of await this.listArtifacts()) {
      const a = await readArtifactFile(join(this.dir, name));
      if (a.sourceSha256 === src.sha256 && recipesEqual(a.recipe, recipe)) return a;
    }
    throw new KgError('not_found', `no artifact in ${this.dir} for sha256 ${src.sha256} under the requested recipe`);
  }

  readArtifact(path: string): Promise<ParseArtifact> {
    return readArtifactFile(path);
  }

  private async listArtifacts(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if ((e as { code?: unknown }).code === 'ENOENT') return [];
      throw fsError(e, this.dir);
    }
    return names.filter((n) => ARTIFACT_NAME.test(n)).sort();
  }
}
