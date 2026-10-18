import { KgError, canonicalJson, parseArtifactSchema, type Json, type ParseArtifact, type ParseRecipeSpec, type Parser, type SourceRef } from '@kg/core';

export interface FixtureEntry {
  /** a virtual path, e.g. "fixture://mini-corpus/v1/gas.pdf" or ".../gas.kgparse.json" */
  path: string;
  artifact: ParseArtifact;
}

/**
 * FixtureParser: returns committed artifacts. identify(path) and readArtifact(path) look entries up by path;
 * parse(src, recipe) returns the artifact whose sourceSha256 and recipe match exactly.
 */
export class FixtureParser implements Parser {
  readonly calls: { method: 'identify' | 'parse' | 'readArtifact'; arg: string }[] = [];
  constructor(protected readonly entries: readonly FixtureEntry[]) {}
  async identify(path: string) {
    this.calls.push({ method: 'identify', arg: path });
    const e = this.entries.find((x) => x.path === path);
    if (!e) throw new KgError('not_found', `no fixture at ${path}`);
    return { sha256: e.artifact.sourceSha256, sourceName: e.artifact.sourceName };
  }
  async parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    this.calls.push({ method: 'parse', arg: src.path });
    const bySha = this.entries.filter((x) => x.artifact.sourceSha256 === src.sha256);
    if (bySha.length === 0) throw new KgError('not_found', `no fixture artifact for sha256 ${src.sha256}`);
    const hit = bySha.find((x) => canonicalJson(x.artifact.recipe as unknown as Json) === canonicalJson(recipe as unknown as Json));
    if (!hit) throw new KgError('precondition', `fixture for ${src.path} exists only under another parse recipe`);
    return structuredClone(hit.artifact);
  }
  async readArtifact(path: string): Promise<ParseArtifact> {
    this.calls.push({ method: 'readArtifact', arg: path });
    const e = this.entries.find((x) => x.path === path);
    if (!e) throw new KgError('not_found', `no fixture at ${path}`);
    const p = parseArtifactSchema.safeParse(e.artifact);
    if (!p.success) throw new KgError('invalid_input', `fixture at ${path} is not a valid artifact`);
    return structuredClone(e.artifact);
  }
}

/** A parser that always fails (for ingest failure scenarios). */
export class FailingParser extends FixtureParser {
  override async parse(): Promise<ParseArtifact> {
    throw new KgError('upstream', 'docling sidecar crashed (scripted)');
  }
}
