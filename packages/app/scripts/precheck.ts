/**
 * Retrieval-only pre-checks on an own-corpus eval set (no answer model, no judge).
 *   ranks <author>        for every question, the rank of each gold chunk in the top 50 -> ranks-<author>.json
 *   paraphrase <author>   for questions whose gold is not all in the top 5: 3 model paraphrases, best recall vs original
 * Usage: tsx scripts/precheck.ts <stage> <author>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChunkId, EvalSet } from '@kg/core';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(root, 'scratch/sprint-2');
const stage = process.argv[2]!;
const author = process.argv[3]!;
const set = JSON.parse(readFileSync(join(out, `eval-set-${author}.json`), 'utf8')) as EvalSet;
const kg = compose({ dbPath: join(out, `${author}.kg.sqlite`), artifactDir: join(root, 'test/corpa/stat-mech/artifacts') });
const { sessionId } = await kg.api.openSession({ kind: 'cli', label: `precheck-${stage}-${author}` });
const KS = [1, 3, 5, 10, 20, 50];
const docs = kg.store.currentDocVersions();
const index = new Map<string, { doc: string; i: number }>();
for (const d of docs) d.chunkIds.forEach((id, i) => index.set(id, { doc: d.docKey, i }));

/** rank (1-based) of every gold chunk among the chunk sources of the ranked items; null when absent from the top n */
async function goldRanks(query: string, gold: readonly ChunkId[], n = 50): Promise<(number | null)[]> {
  const res = await kg.api.search(sessionId, { query, k: n });
  const rank = new Map<string, number>();
  res.items.forEach((it, r) => it.sourceChunkIds.forEach((c) => !rank.has(c) && rank.set(c, r + 1)));
  return gold.map((g) => rank.get(g) ?? null);
}
const recallAt = (ranks: (number | null)[], k: number) => ranks.filter((r) => r !== null && r <= k).length / Math.max(ranks.length, 1);

if (stage === 'ranks') {
  const rows = [];
  for (const q of set.questions) {
    const ranks = await goldRanks(q.question, q.goldChunkIds);
    const pos = q.goldChunkIds.map((g) => index.get(g));
    const sameDoc = pos.every((p) => p && p.doc === pos[0]!.doc);
    const sorted = pos.filter((p): p is { doc: string; i: number } => !!p).map((p) => p.i).sort((a, b) => a - b);
    const adjacent = q.goldChunkIds.length > 1 && sameDoc && sorted.every((v, i) => i === 0 || v - sorted[i - 1]! === 1);
    rows.push({
      id: q.id,
      type: q.type,
      nGold: q.goldChunkIds.length,
      ranks,
      adjacent,
      formula: q.goldText.some((t) => t.includes('[formula]')),
      recall: Object.fromEntries(KS.map((k) => [k, recallAt(ranks, k)])),
      allGold: Object.fromEntries(KS.map((k) => [k, recallAt(ranks, k) === 1 ? 1 : 0])),
    });
  }
  writeFileSync(join(out, `ranks-${author}.json`), JSON.stringify(rows, null, 1));
  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : NaN);
  for (const t of ['single-hop', 'multi-hop', 'topic', 'all']) {
    const r = rows.filter((x) => t === 'all' || x.type === t);
    console.log(t.padEnd(10), `n=${r.length}`, 'recall', KS.map((k) => `@${k}=${mean(r.map((x) => x.recall[k]!))}`).join(' '), '| all-gold', KS.map((k) => `@${k}=${mean(r.map((x) => x.allGold[k]!))}`).join(' '));
  }
}

if (stage === 'paraphrase') {
  const ranksFile = JSON.parse(readFileSync(join(out, `ranks-${author}.json`), 'utf8')) as { id: string; allGold: Record<string, number>; recall: Record<string, number> }[];
  const failing = ranksFile.filter((r) => r.allGold['5'] === 0).map((r) => r.id);
  const rows = [];
  for (const id of failing) {
    const q = set.questions.find((x) => x.id === id)!;
    const resp = await kg.llm.complete({
      purpose: 'precheck-paraphrase',
      model: 'qwen3.5:latest',
      system: 'Rewrite the user question three different ways. Keep the meaning, change the wording and sentence structure. Reply with one JSON object and nothing else: {"paraphrases": ["...", "...", "..."]}',
      messages: [{ role: 'user', content: q.question }],
      temperature: 0.7,
      maxTokens: 400,
      json: true,
    });
    let ps: string[] = [];
    try {
      ps = (JSON.parse(resp.text) as { paraphrases: string[] }).paraphrases.slice(0, 3);
    } catch {
      /* a malformed reply leaves this question with no paraphrases and it is counted as such */
    }
    const base = recallAt(await goldRanks(q.question, q.goldChunkIds), 5);
    const alt = [];
    for (const p of ps) alt.push(recallAt(await goldRanks(p, q.goldChunkIds), 5));
    rows.push({ id, type: q.type, original: base, paraphrases: ps, recalls: alt, best: Math.max(base, ...alt) });
  }
  writeFileSync(join(out, `paraphrase-${author}.json`), JSON.stringify(rows, null, 1));
  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : NaN);
  console.log(`failing at k=5: ${failing.length} of ${set.questions.length}; mean recall@5 original ${mean(rows.map((r) => r.original))}, best of original+3 paraphrases ${mean(rows.map((r) => r.best))}`);
}
kg.close();
