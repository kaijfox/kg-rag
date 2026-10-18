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

export const DEFAULT_SEARCH_RECIPE: SearchRecipeSpec = {
  kind: 'search',
  version: '1',
  spec: {
    steps: [
      { type: 'vector-knn', params: { pool: DEFAULT_POOL, kinds: ['chunk'] } },
      { type: 'truncate', params: {} },
    ],
  },
};

/**
 * Provisional default space (Phase 1 spike, decision log): embeddinggemma via Ollama, with the
 * model's documented retrieval prompts.
 */
export const DEFAULT_SPACE: EmbeddingSpaceSpec = {
  model: 'embeddinggemma:latest',
  dims: 768,
  documentTemplate: 'title: {headings} | text: {text}',
  queryTemplate: 'task: search result | query: {query}',
};

export const DEFAULT_CONFIG: DatabaseConfig = {
  parseRecipe: DEFAULT_PARSE_RECIPE,
  chunkRecipe: DEFAULT_CHUNK_RECIPE,
  space: DEFAULT_SPACE,
  searchRecipe: DEFAULT_SEARCH_RECIPE,
};
