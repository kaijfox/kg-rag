/** Default recipes. Changing any of these changes recipe IDs (see golden vectors) and, for parse/chunk, chunk IDs. */
import type { ChunkRecipeSpec, DatabaseConfig, EmbeddingSpaceSpec, ParseRecipeSpec, SearchRecipeSpec } from './model';
import { DEFAULT_POOL } from './ports/search';

export const DEFAULT_PARSE_RECIPE: ParseRecipeSpec = {
  kind: 'parse',
  version: '1',
  spec: {
    parser: 'docling',
    doclingVersion: '2.140.0',
    options: { do_ocr: false, do_table_structure: true, do_formula_enrichment: false },
  },
};

/** section-pack/1, specified in packages/chunk/CARD.md. Provisional until the chunker freeze before Phase 4. */
export const DEFAULT_CHUNK_RECIPE: ChunkRecipeSpec = {
  kind: 'chunk',
  version: '1',
  spec: { algorithm: 'section-pack/1', targetChars: 1000, maxChars: 1500, minChars: 200 },
};

/**
 * The default search machine: `similarity` (retrieve with vector-knn, then cut with truncate), version 1.
 * `topology` is the machine's wiring fingerprint, pinned here as a literal because core cannot compute it (it must
 * not import the search package), exactly as the embedding model digest is pinned below. The search package asserts
 * that the machine's computed topology equals this literal, so changing the machine forces a conscious edit here and
 * of the golden id vectors.
 */
export const DEFAULT_SEARCH_RECIPE: SearchRecipeSpec = {
  kind: 'search',
  version: '1',
  spec: {
    machine: 'similarity',
    settings: { pool: DEFAULT_POOL, kinds: ['chunk'] },
    topology: 'ab74647e68ade0b3',
  },
};

/**
 * Provisional default space (Phase 1 spike, decision log): embeddinggemma via Ollama, with the
 * model's documented retrieval prompts.
 */
export const DEFAULT_SPACE: EmbeddingSpaceSpec = {
  model: 'embeddinggemma:latest',
  /** `ollama /api/tags` digest of embeddinggemma:latest, read 2026-10-18 */
  digest: '85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1',
  dims: 768,
  documentTemplate: 'title: {headings} | text: {text}',
  queryTemplate: 'task: search result | query: {query}',
  formulaView: 'placeholder',
};

export const DEFAULT_CONFIG: DatabaseConfig = {
  parseRecipe: DEFAULT_PARSE_RECIPE,
  chunkRecipe: DEFAULT_CHUNK_RECIPE,
  space: DEFAULT_SPACE,
  searchRecipe: DEFAULT_SEARCH_RECIPE,
};
