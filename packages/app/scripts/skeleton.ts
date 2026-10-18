/**
 * Walking skeleton, end to end:
 *   import real docling artifacts (testkit fixtures) -> section-pack/1 chunks -> store -> embed (Ollama
 *   embeddinggemma if running, else HashEmbedder) -> build -> MCP-shaped search -> feedback -> usage ->
 *   a failing call -> note -> viewer-style read of the log for the session and for one search.
 * Usage: pnpm skeleton   (or: tsx scripts/skeleton.ts [--hash] [--query "..."])
 */
import { DEFAULT_CONFIG, type DatabaseConfig, type Json, type SearchResponse } from '@kg/core';
import { FixtureParser, HashEmbedder, REAL_SLICES, realArtifact, HASH_SPACE } from '@kg/testkit';
import { createSkeleton, mcpCall, ollamaAvailable, ollamaEmbedder, renderSearch, renderSession } from '../src/index';

const args = process.argv.slice(2);
const query = args.includes('--query') ? args[args.indexOf('--query') + 1]! : 'What does the first law of thermodynamics say about heat and work?';
const useOllama = !args.includes('--hash') && (await ollamaAvailable(DEFAULT_CONFIG.space.model));
const config: DatabaseConfig = useOllama ? DEFAULT_CONFIG : { ...DEFAULT_CONFIG, space: HASH_SPACE };
const embedder = useOllama ? ollamaEmbedder(config.space.model, config.space.dims) : new HashEmbedder(HASH_SPACE.dims);

const entries = REAL_SLICES.map((s) => ({ path: `fixture://docling-real/${s}.kgparse.json`, artifact: realArtifact(s) }));
const sk = createSkeleton({ parser: new FixtureParser(entries), embedder, config });
const label = (id: string) => {
  for (const v of sk.store.currentDocVersions()) {
    const i = v.chunkIds.indexOf(id as never);
    if (i >= 0) return `${v.docKey}#${i}`;
  }
  return id.slice(0, 9);
};

const { sessionId } = await sk.api.openSession({ kind: 'agent', label: 'walking-skeleton', meta: { embedder: embedder.model } });
const call = async (name: string, a: Json) => {
  const r = await mcpCall(sk.api, sessionId, name, a);
  console.log(`MCP ${name} -> ${r.isError ? 'ERROR ' : ''}${r.content[0]!.text.slice(0, 200)}${r.content[0]!.text.length > 200 ? '...' : ''}`);
  return r;
};

console.log(`embedder: ${embedder.model} (${useOllama ? 'live Ollama' : 'HashEmbedder fallback'})\n`);
const ing = await call('ingest', { artifacts: REAL_SLICES.map((s) => ({ path: `fixture://docling-real/${s}.kgparse.json` })) });
const search = (await call('search', { query, k: 5 })).structuredContent as unknown as SearchResponse;
const top = search.items[0]!;
await call('feedback', { searchId: search.searchId, overall: 2, items: [{ itemId: top.itemId, relevance: 2 }, { itemId: search.items[1]!.itemId, relevance: 0 }], note: 'top hit states the first law' });
await call('get_items', { itemIds: [top.itemId] });
await call('report_usage', { searchId: search.searchId, itemIds: [top.itemId], account: 'quoted dE = dQ - dW' });
await call('feedback', { searchId: 'sr_0000000000000000000000ZZZZ', overall: 1 });
await call('add_note', { text: 'skeleton run: check that the log alone explains the ranking' });
await call('snapshot_build', { name: 'skeleton' });

console.log(`\nbuild ${search.buildId}: ${sk.store.getBuild(search.buildId)!.itemIds.length} chunks; mixedRecipes=${sk.store.getBuild(search.buildId)!.manifest.mixedRecipes}; ingest ok=${!ing.isError}`);
console.log(`\n================ event log for search ${search.searchId} (LogReader.eventsBySearch) ================`);
console.log(renderSearch(sk.log, search.searchId, label));
console.log(`\n================ whole session (LogReader.events) ================`);
console.log(renderSession(sk.log, sessionId, label));
console.log(`\ntop result ${label(top.itemId)} (score ${top.score.toFixed(3)}):\n${top.text.slice(0, 400)}`);
