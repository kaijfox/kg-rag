/**
 * Ready-made harnesses over the fakes, shared by testkit's own tests and the meta-test. Phase 2 packages
 * build their own harnesses around the real implementation in the same shape.
 */
import {
  DEFAULT_SEARCH_RECIPE,
  asDocKey,
  type AnyItem,
  type BuildId,
  type Chunk,
  type ChunkId,
  type Chunker,
  type LlmRequest,
  type SearchState,
  type StepEnv,
} from '@kg/core';
import { FixtureParser } from './fakes/parser';
import { fakeKgApi, type FakeKgApiScript } from './fakes/kgapi';
import type { ScriptedHit } from './fakes/search';
import { dupSectionsArtifact, dupSectionsExpected, miniArtifact, miniArtifactPath, miniExpected, miniLabels, miniParserEntries, miniParseRecipe, miniSourcePath, MINI_DOCS } from './fixtures';
import type { KgApiHarness } from './conformance/kgapi';
import type { ParserHarness } from './conformance/parser';
import type { LlmHarness } from './conformance/llm';

export const BUILD_A = 'bd_aaaaaaaaaaaaaaaaaaaa' as BuildId;
export const BUILD_B = 'bd_bbbbbbbbbbbbbbbbbbbb' as BuildId;

/** Mini-corpus v1 chunks as items (from the hand-derived expectations and oracle IDs). */
export function miniChunks(version: 1 | 2 = 1): Chunk[] {
  const labels = miniLabels();
  return MINI_DOCS.flatMap((d) =>
    miniExpected(version)[d].map((c) => {
      const id = labels[c.label]! as ChunkId;
      return { id, kind: 'chunk' as const, text: c.text, sourceChunkIds: [id], recipeId: null, meta: {}, docKey: asDocKey(d), sectionPath: c.sectionPath, occurrence: c.occurrence, pages: c.pages, blockRefs: c.blockRefs };
    }),
  );
}

export function scriptedMiniApi(): FakeKgApiScript {
  const items: AnyItem[] = miniChunks(1);
  const hit = (i: number, score: number): ScriptedHit => ({ itemId: items[i]!.id, kind: 'chunk', text: items[i]!.text, score, sourceChunkIds: items[i]!.sourceChunkIds });
  return { buildId: BUILD_A, items, searches: { 'what does the second law say about entropy': [hit(0, 0.81), hit(1, 0.62), hit(3, 0.62), hit(2, 0.4)] } };
}

export function fakeKgApiHarness(): KgApiHarness {
  const script = scriptedMiniApi();
  const ids = script.items.map((i) => i.id as string);
  // BUILD_B lacks the first scripted item, so getItems on BUILD_B must omit it
  const parts = fakeKgApi({ ...script, members: { [BUILD_A]: ids, [BUILD_B]: ids.slice(1) } });
  return {
    api: parts.api,
    reader: parts.log,
    query: 'what does the second law say about entropy',
    advanceBuild: async () => parts.setBuild(BUILD_B),
    nonMember: { itemId: script.items[0]!.id, buildId: BUILD_B },
  };
}

export function fixtureParserHarness(make: (entries: ReturnType<typeof miniParserEntries>) => import('@kg/core').Parser = (e) => new FixtureParser(e)): ParserHarness {
  return {
    parser: make(miniParserEntries()),
    sources: MINI_DOCS.map((d) => ({ path: miniSourcePath(1, d), docKey: asDocKey(d) })),
    recipe: miniParseRecipe(),
    artifactPaths: MINI_DOCS.map((d) => miniArtifactPath(1, d)),
    missingPath: 'fixture://nowhere.pdf',
  };
}

export const LLM_REQUEST: LlmRequest = {
  purpose: 'eval-judge',
  model: 'qwen3.5:latest',
  system: 'You grade answers.',
  messages: [{ role: 'user', content: 'Reference: S never decreases. Answer: entropy grows. Score 0-1?' }],
  temperature: 0,
  maxTokens: 50,
};

/** A chunker fake: replays the hand-derived mini-corpus chunks (it cannot chunk anything else). */
export const fixtureChunker: Chunker = (a, docKey) => {
  for (const v of [1, 2] as const)
    for (const d of MINI_DOCS)
      if (miniArtifact(v, d).sourceSha256 === a.sourceSha256) {
        const labels = miniLabels();
        return miniExpected(v)[d].map((c) => ({ id: labels[c.label]! as ChunkId, text: c.text, sectionPath: c.sectionPath, occurrence: c.occurrence, pages: c.pages, blockRefs: c.blockRefs }));
      }
  if (dupSectionsArtifact().sourceSha256 === a.sourceSha256) {
    const labels = miniLabels();
    return dupSectionsExpected().map((c) => ({ id: labels[c.label]! as ChunkId, text: c.text, sectionPath: c.sectionPath, occurrence: c.occurrence, pages: c.pages, blockRefs: c.blockRefs }));
  }
  throw new Error(`fixtureChunker has no expectation for ${docKey}`);
};

export function stepState(): SearchState {
  const items = miniChunks(1);
  const cands = [0.2, 0.9, 0.5, 0.9].map((score, i) => ({ itemId: items[i]!.id, kind: 'chunk' as const, score, sourceChunkIds: items[i]!.sourceChunkIds, via: 'seed', queryId: 'q0' }));
  return { query: 'q', k: 3, buildId: BUILD_A, queries: [{ id: 'q0', text: 'q', origin: 'original', parentId: null }], candidates: cands, seeds: [], done: false, notes: {} };
}
export const nullEnv = {} as StepEnv;
export { DEFAULT_SEARCH_RECIPE };
export type { LlmHarness };
