import {
  KgError,
  renderDocument,
  type ChunkViewRenderer,
  type Chunker,
  type CorpusStore,
  type DatabaseConfig,
  type Embedder,
  type ItemId,
  type ParseArtifact,
  type ParseRecipeSpec,
  type Parser,
} from '@kg/core';

/** Display-formula decoder (0.6.0): the plain artifact and its source file in, the artifact under the full recipe out. */
export type FormulaDecoder = (artifact: ParseArtifact, sourcePath: string, recipe: ParseRecipeSpec) => Promise<ParseArtifact>;

export interface IngestDeps {
  store: CorpusStore;
  parser: Parser;
  chunker: Chunker;
  /** renders a chunk under the space's formula view */
  chunkView: ChunkViewRenderer;
  embedder: Embedder;
  config: DatabaseConfig;
  formulaDecoder?: FormulaDecoder;
}

export interface Vector {
  itemId: ItemId;
  vector: Float32Array;
}

/** The parse recipe the parser runs under: the configured one without its formula decoding (the decoder adds it). */
export function plainParseRecipe(r: ParseRecipeSpec): ParseRecipeSpec {
  if (r.spec.formulaDecoding === undefined) return r;
  const { formulaDecoding: _decoding, ...spec } = r.spec;
  return { ...r, spec };
}

/** True when the configured recipe decodes formulas and the artifact does not carry that decoding yet. */
export const needsDecoding = (config: DatabaseConfig, artifact: ParseArtifact): boolean =>
  config.parseRecipe.spec.formulaDecoding !== undefined && artifact.recipe.spec.formulaDecoding === undefined;

/** The text an embedder sees for one chunk: the chunk view under the space's formula view, then the document template. */
export function embeddedText(
  d: IngestDeps,
  artifact: ParseArtifact,
  chunk: { text: string; blockRefs: readonly string[]; sectionPath: readonly string[] },
): string {
  const text = d.chunkView(artifact, chunk.blockRefs, chunk.text, d.config.space.formulaView);
  return renderDocument(d.config.space, { text, sectionPath: [...chunk.sectionPath] });
}

export function checkEmbedded(vectors: readonly Float32Array[], texts: readonly string[]): void {
  if (vectors.length !== texts.length) throw new KgError('upstream', `embedder returned ${vectors.length} vectors for ${texts.length} texts`);
}
