/** The configuration of one database (one directory), and its defaults. Stored as kg.json. */
import type { JsonObject } from './ids';
import type { EmbeddingSpaceSpec } from './types';

export interface SourceEntry {
  /** a file path, relative to the database directory or absolute */
  path: string;
  docKey?: string;
  /** which ingest module reads it: "docling-pdf", "markdown", "decision-log" */
  adapter?: string;
  meta?: JsonObject;
}

export interface KgConfig {
  space: EmbeddingSpaceSpec;
  parseRecipe: JsonObject;
  chunkRecipe: JsonObject;
  /** machine used by `search` when none is named */
  searchMachine: string;
  /** machine that builds an index from the sources */
  buildMachine: string;
  llm: { model: string; temperature: number; maxTokens: number };
  extract: { enabled: boolean; secondPass: boolean; maxFactsPerChunk: number };
  sources: SourceEntry[];
  /** where parsed documents are kept, relative to the database directory */
  artifactsDir: string;
  /** the model-call cache is pruned to this many bytes */
  cacheMaxBytes: number;
}

/** Chosen so that the pinned evaluation questions, which name chunk IDs, stay valid. Changing a recipe changes chunk IDs. */
export const DEFAULT_PARSE_RECIPE: JsonObject = {
  kind: 'parse',
  version: '1',
  spec: { parser: 'docling', doclingVersion: '2.140.0', options: { do_ocr: false, do_table_structure: true, do_formula_enrichment: false } },
};
export const DEFAULT_CHUNK_RECIPE: JsonObject = {
  kind: 'chunk',
  version: '1',
  spec: { algorithm: 'section-pack/1', targetChars: 1000, maxChars: 1500, minChars: 200 },
};

export const DEFAULT_SPACE: EmbeddingSpaceSpec = {
  model: 'embeddinggemma:latest',
  digest: '85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1',
  dims: 768,
  documentTemplate: 'title: {headings} | text: {text}',
  queryTemplate: 'task: search result | query: {query}',
};

export const DEFAULT_CONFIG: KgConfig = {
  space: DEFAULT_SPACE,
  parseRecipe: DEFAULT_PARSE_RECIPE,
  chunkRecipe: DEFAULT_CHUNK_RECIPE,
  searchMachine: 'chunk-search',
  buildMachine: 'build',
  llm: { model: 'qwen3.5:latest', temperature: 0, maxTokens: 1200 },
  extract: { enabled: false, secondPass: false, maxFactsPerChunk: 12 },
  sources: [],
  artifactsDir: 'artifacts',
  cacheMaxBytes: 200 * 1024 * 1024,
};

/** A config from user JSON: any field left out takes its default. */
export function withDefaults(user: Partial<KgConfig>): KgConfig {
  return {
    ...DEFAULT_CONFIG,
    ...user,
    space: { ...DEFAULT_CONFIG.space, ...(user.space ?? {}) },
    llm: { ...DEFAULT_CONFIG.llm, ...(user.llm ?? {}) },
    extract: { ...DEFAULT_CONFIG.extract, ...(user.extract ?? {}) },
  };
}
