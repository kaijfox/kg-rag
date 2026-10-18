/** Typed access to the committed fixtures. Every fixture directory has a README.md saying what it means. */
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CHUNK_RECIPE,
  DEFAULT_SEARCH_RECIPE,
  asDocKey,
  validateEventEnvelope,
  type ChunkId,
  type DatabaseConfig,
  type DocKey,
  type EmbeddingSpaceSpec,
  type EventEnvelope,
  type MachineMap,
  type ParseArtifact,
  type ParseRecipeSpec,
  type RecipeId,
} from '@kg/core';
import type { FixtureEntry } from './fakes/parser';

export const FIXTURES_DIR = new URL('../fixtures/', import.meta.url);
export const GOLDEN_DIR = new URL('../golden/', import.meta.url);
const json = <T>(rel: string, base = FIXTURES_DIR): T => JSON.parse(readFileSync(new URL(rel, base), 'utf8')) as T;
export const fixturePath = (rel: string) => new URL(rel, FIXTURES_DIR).pathname;

// ---------------------------------------------------------------- mini-corpus
export type MiniDoc = 'gas' | 'entropy';
export const MINI_DOCS: readonly MiniDoc[] = ['entropy', 'gas'];
export interface ExpectedChunk {
  label: string;
  sectionPath: string[];
  blocks: string[];
  occurrence: number;
  pages: number[];
  blockRefs: string[];
  chars: number;
  text: string;
}
export function miniArtifact(version: 1 | 2, doc: MiniDoc): ParseArtifact {
  return json<ParseArtifact>(`mini-corpus/v${version}/${doc}.kgparse.json`);
}
export function miniExpected(version: 1 | 2): Record<MiniDoc, ExpectedChunk[]> {
  return json(`mini-corpus/expected-chunks-v${version}.json`);
}
export function miniDiff(): { survive: string[]; vanish: string[]; new: string[] } {
  return json('mini-corpus/expected-diff.json');
}
/** chunk label -> chunk ID, computed by the independent Python oracle in mini-corpus/build.py */
export function miniLabels(): Record<string, ChunkId> {
  return json('mini-corpus/labels.json');
}
/** Extra chunker fixture: the same paragraph alone in two sections (mini-corpus/extra, README "extra"). */
export const dupSectionsArtifact = (): ParseArtifact => json('mini-corpus/extra/dupsec.kgparse.json');
export const dupSectionsExpected = (): ExpectedChunk[] => json<{ dupsec: ExpectedChunk[] }>('mini-corpus/extra/expected-chunks.json').dupsec;
export const miniSourcePath = (version: 1 | 2, doc: MiniDoc) => `fixture://mini-corpus/v${version}/${doc}.pdf`;
export const miniArtifactPath = (version: 1 | 2, doc: MiniDoc) => `fixture://mini-corpus/v${version}/${doc}.kgparse.json`;
/** FixtureParser entries for both versions, as sources (.pdf) and as artifact files (.kgparse.json). */
export function miniParserEntries(): FixtureEntry[] {
  const out: FixtureEntry[] = [];
  for (const v of [1, 2] as const)
    for (const d of MINI_DOCS) {
      const artifact = miniArtifact(v, d);
      out.push({ path: miniSourcePath(v, d), artifact }, { path: miniArtifactPath(v, d), artifact });
    }
  return out;
}
export const miniParseRecipe = (): ParseRecipeSpec => miniArtifact(1, 'gas').recipe;

/** The embedding space used with HashEmbedder in fixtures (search/queries.json expectations depend on it). */
export const HASH_SPACE: EmbeddingSpaceSpec = {
  model: 'hash-bow-4096',
  digest: 'fake-hash-bow-4096', // no real model: a fake digest
  dims: 4096,
  documentTemplate: '{headings}\n{text}',
  /** non-identity on purpose: a search that skips the template embeds different text (review M23); 'question' occurs nowhere in the corpus, so rankings equal the bare query's */
  queryTemplate: 'question: {query}',
  formulaView: 'placeholder',
};
export const miniConfig = (): DatabaseConfig => ({
  parseRecipe: miniParseRecipe(),
  chunkRecipe: DEFAULT_CHUNK_RECIPE,
  space: HASH_SPACE,
  searchRecipe: DEFAULT_SEARCH_RECIPE,
});

// ---------------------------------------------------------------- real docling slices
export type RealSlice = 'thermo-plischke-p2-4' | 'foundations-kardar-p3-5' | 'thermo-kardar-p6-7';
export const REAL_SLICES: readonly RealSlice[] = ['thermo-plischke-p2-4', 'foundations-kardar-p3-5', 'thermo-kardar-p6-7'];
export const realArtifact = (s: RealSlice): ParseArtifact => json(`docling-real/${s}.kgparse.json`);
export interface RealFacts {
  docKey: string;
  allowedSectionPaths: string[][];
  mustSplit: string[];
  formulaCount: number;
  textNotInAnyChunk: string[];
  chunkContains?: string[];
  refInSection: { ref: string; sectionPath: string[] }[];
}
export const realFacts = (): Record<RealSlice, RealFacts> => json<{ slices: Record<RealSlice, RealFacts> }>('docling-real/expected-facts.json').slices;
export const realDocKey = (s: RealSlice): DocKey => asDocKey(realFacts()[s].docKey);

// ---------------------------------------------------------------- search
export interface SearchFixtureQuery {
  id: string;
  query: string;
  k: number;
  build: 'v1' | 'v2';
  /** expected top results as chunk labels, in order */
  expectedTop: string[];
  /** labels that must not appear at all */
  mustNotAppear?: string[];
  expectedCount: number;
  why: string;
}
export const searchQueries = (): SearchFixtureQuery[] => json<{ queries: SearchFixtureQuery[] }>('search/queries.json').queries;

// ---------------------------------------------------------------- logs
export type LogFixture = 'session-agent' | 'session-eval' | 'session-live-partial';
export function logFixture(name: LogFixture): EventEnvelope[] {
  return readFileSync(new URL(`log/${name}.jsonl`, FIXTURES_DIR), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => validateEventEnvelope(JSON.parse(l)));
}

// ---------------------------------------------------------------- machine (contract 0.6.0)
/** The hand-written MachineMap of the similarity search machine (fixtures/machine/search-map.json). */
export const machineMapFixture = (): MachineMap => json<MachineMap>('machine/search-map.json');
/** The events of one recorded search run that the map describes (fixtures/machine/search-run.jsonl). */
export function machineRunFixture(): EventEnvelope[] {
  return readFileSync(new URL('machine/search-run.jsonl', FIXTURES_DIR), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => validateEventEnvelope(JSON.parse(l)));
}

// ---------------------------------------------------------------- eval
/** Contract 0.6.1: the judge and answerer that the reference eval runner and the session-eval log fixture record. */
export const REFERENCE_JUDGE = { recipeId: 'rc_fmzaecx2stduxxewhf62' as RecipeId, model: 'qwen3.5:latest' };
export const REFERENCE_ANSWERER = { model: 'qwen3.5:latest', promptDigest: '0db52f4076c082518412afd3dd3576e2cb0c63703fd7fed5e23ade60efef31d9' };
export const evalFixture = <T = unknown>(name: 'mini-set' | 'retrievals' | 'expected-metrics' | 'judge-verdicts'): T =>
  name === 'judge-verdicts'
    ? (readFileSync(new URL('eval/judge-verdicts.jsonl', FIXTURES_DIR), 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l)) as T)
    : json<T>(`eval/${name}.json`);

// ---------------------------------------------------------------- golden
export const goldenIds = <T = unknown>(): T => json<T>('ids.json', GOLDEN_DIR);
