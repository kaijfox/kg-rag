/**
 * Spike 5c: embeddinggemma via Ollama on the stat-mech chunks (section-pack/1, OCR-off artifacts).
 * Reports dimension, throughput, and hit/recall@k + MRR on hand-written queries (data/embed-queries.json),
 * with the model's retrieval prompts (DEFAULT_SPACE) and without any template.
 * Usage: tsx scripts/spikes/embed-recall.ts [dir with *.kgparse.json(.gz)]
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_DIR, readArtifact } from './io';
import {
  DEFAULT_CHUNK_RECIPE,
  DEFAULT_SPACE,
  asDocKey,
  cosineScore,
  renderDocument,
  renderQuery,
  type ChunkDraft,
  type EmbeddingSpaceSpec,
  type ParseArtifact,
} from '@kg/core';
import { sectionPack } from '../../src/skeleton/chunker';
import { ollamaEmbedder } from '../../src/skeleton/ollama';

const dir = process.argv[2] ?? DEFAULT_DIR;
const DOCS = ['ThermoPlischke', 'ThermoKardar', 'FoundationsPlischke', 'FoundationsKardar'];
const chunks: (ChunkDraft & { doc: string })[] = [];
for (const d of DOCS) {
  const art = readArtifact(dir, d);
  for (const c of sectionPack(art, asDocKey(d), DEFAULT_CHUNK_RECIPE)) chunks.push({ ...c, doc: d });
}
const { queries } = JSON.parse(readFileSync(new URL('./data/embed-queries.json', import.meta.url), 'utf8')) as {
  queries: { id: string; q: string; gold: [string, string][] }[];
};
const gold = new Map(
  queries.map((q) => [
    q.id,
    new Set(chunks.filter((c) => q.gold.some(([d, ph]) => c.doc === d && c.text.toLowerCase().includes(ph.toLowerCase()))).map((c) => c.id)),
  ]),
);

const RAW: EmbeddingSpaceSpec = { ...DEFAULT_SPACE, documentTemplate: '{text}', queryTemplate: '{query}' };
const emb = ollamaEmbedder(DEFAULT_SPACE.model, DEFAULT_SPACE.dims, { batchSize: 32 });

async function run(space: EmbeddingSpaceSpec, label: string) {
  const t0 = performance.now();
  const docVecs = await emb.embed(chunks.map((c) => renderDocument(space, c)));
  const docMs = performance.now() - t0;
  const t1 = performance.now();
  const qVecs = await emb.embed(queries.map((q) => renderQuery(space, q.q)));
  const qMs = performance.now() - t1;
  const ks = [1, 5, 10, 20];
  const hit: Record<number, number> = { 1: 0, 5: 0, 10: 0, 20: 0 };
  const rec: Record<number, number> = { 1: 0, 5: 0, 10: 0, 20: 0 };
  let mrr = 0;
  const misses: string[] = [];
  queries.forEach((q, qi) => {
    const ranked = chunks
      .map((c, i) => ({ id: c.id, s: cosineScore(qVecs[qi]!, docVecs[i]!) }))
      .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
    const g = gold.get(q.id)!;
    const firstRank = ranked.findIndex((r) => g.has(r.id)) + 1;
    if (firstRank > 0) mrr += 1 / firstRank;
    for (const k of ks) {
      const top = new Set(ranked.slice(0, k).map((r) => r.id));
      const found = [...g].filter((x) => top.has(x)).length;
      if (found > 0) hit[k]! += 1;
      rec[k]! += found / g.size;
    }
    if (firstRank === 0 || firstRank > 10) misses.push(`${q.id}(first gold at rank ${firstRank || '>all'})`);
  });
  const n = queries.length;
  console.log(
    `${label}: chunks=${chunks.length} dims=${docVecs[0]!.length} embed=${(docMs / 1000).toFixed(1)}s (${(chunks.length / (docMs / 1000)).toFixed(1)} chunks/s, ${(chunks.reduce((a, c) => a + c.text.length, 0) / (docMs / 1000) / 1000).toFixed(1)}k chars/s) queries=${n} in ${qMs.toFixed(0)}ms\n` +
      `  hit@1 ${(hit[1]! / n).toFixed(2)} hit@5 ${(hit[5]! / n).toFixed(2)} hit@10 ${(hit[10]! / n).toFixed(2)} hit@20 ${(hit[20]! / n).toFixed(2)} | ` +
      `recall@1 ${(rec[1]! / n).toFixed(2)} @5 ${(rec[5]! / n).toFixed(2)} @10 ${(rec[10]! / n).toFixed(2)} @20 ${(rec[20]! / n).toFixed(2)} | MRR ${(mrr / n).toFixed(3)}\n` +
      `  misses@10: ${misses.join(', ') || 'none'}`,
  );
}

console.log(`gold sizes: ${queries.map((q) => `${q.id}:${gold.get(q.id)!.size}`).join(' ')}`);
await emb.embed(['warm-up']);
await run(DEFAULT_SPACE, 'embeddinggemma, retrieval prompts');
await run(RAW, 'embeddinggemma, no template');
