/**
 * Project-log trial. A 16-entry log of an invented ingestion service (experiments/data/toy-project-log.md) holds seven
 * replacements. Five are written in the sentence form the guide teaches; two are written the way a person might write
 * them without having read the guide (one states "X is no longer used", one says an old date "is replaced by this
 * pipeline"). Ten questions each have the current entry as the answer. The log is searched with plain search
 * ("chunk-search") and with "current-state", which leaves out entries that a later entry replaced, using real
 * embeddings (Ollama embeddinggemma) and, for a second pair of runs, extracted facts (qwen3.5). Prints a JSON result.
 *
 *   node_modules/.bin/tsx experiments/project-log-trial.mts [--no-extract] > experiments/project-log-trial.out.json
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const LOG = resolve(import.meta.dirname, 'data/toy-project-log.md');
const extract = !process.argv.includes('--no-extract');

// entries by the start of their title
const T = {
  storeJson: 'Record store is JSON files', storeSqlite: 'Record store is SQLite', storePg: 'Record store is Postgres',
  chunk500: 'Chunk size is 500', chunk1000: 'Chunk size is 1000',
  miniLm: 'Embedding model is MiniLM', gemma: 'Embedding model is embeddinggemma',
  deployHand: 'Deployment is by hand', deployCi: 'Deployment runs from',
  logText: 'Log lines are plain text', logJson: 'Log lines are JSON',
  authKeys: 'Authentication uses API keys', authOauth: 'Authentication uses OAuth',
  rate: 'Request rate limit', rerank: 'Query reranking was tried', retry: 'Failed requests are retried',
};
/** true replacements: [newer, older, how the sentence is written] */
const TRUE_REPLACEMENTS: [string, string, string][] = [
  [T.storeSqlite, T.storeJson, 'guide form'], [T.storePg, T.storeSqlite, 'guide form'], [T.chunk1000, T.chunk500, 'guide form'],
  [T.logJson, T.logText, 'guide form'], [T.authOauth, T.authKeys, 'guide form (two entries share the older date)'],
  [T.gemma, T.miniLm, 'states "no longer used", no date'], [T.deployCi, T.deployHand, 'old date "is replaced by this pipeline"'],
];
const QUESTIONS: { q: string; current: string; stale: string[] }[] = [
  { q: 'Where does the ingestion service keep its records?', current: T.storePg, stale: [T.storeJson, T.storeSqlite] },
  { q: 'Which database do the workers write to?', current: T.storePg, stale: [T.storeJson, T.storeSqlite] },
  { q: 'How long is each piece of a document before embedding?', current: T.chunk1000, stale: [T.chunk500] },
  { q: 'What model turns text into embeddings?', current: T.gemma, stale: [T.miniLm] },
  { q: 'How is the service deployed?', current: T.deployCi, stale: [T.deployHand] },
  { q: 'In what format does the service write its log?', current: T.logJson, stale: [T.logText] },
  { q: 'How do clients prove who they are?', current: T.authOauth, stale: [T.authKeys] },
  { q: 'How many requests per minute may be sent upstream?', current: T.rate, stale: [] },
  { q: 'Did adding a reranking step help?', current: T.rerank, stale: [] },
  { q: 'How many times is a failed upstream request retried?', current: T.retry, stale: [] },
];
const K = 3;

const work = mkdtempSync(join(tmpdir(), 'kg-logtrial-'));
try {
  const kg = openKg({ db: join(work, 'db'), create: true });
  kg.saveConfig({ sources: [{ path: LOG, adapter: 'decision-log', docKey: 'log' }], searchMachine: 'current-state', extract: { ...kg.config.extract, enabled: extract } });
  const t0 = Date.now();
  const report = await ingest(kg, { sidecar: null });
  const seconds = Math.round((Date.now() - t0) / 1000);

  const chunks = kg.index.currentChunks();
  const entryOfChunk = new Map(chunks.map((c) => [c.id, (c.meta.title as string) ?? c.sectionPath[0] ?? '']));
  const titleOf = (id: string) => entryOfChunk.get(id) ?? '?';
  const label = (t: string) => {
    const bare = t.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '');
    return Object.values(T).find((p) => bare.startsWith(p)) ?? bare;
  };

  // links the rule found
  const links = kg.index.linksOf(chunks.map((c) => c.id), 'either', 'replaces');
  const found = links.map((l) => ({ newer: label(titleOf(l.fromId)), older: label(titleOf(l.toId)) }));
  const unique = [...new Map(found.map((f) => [f.newer + '>' + f.older, f])).values()];
  const detection = TRUE_REPLACEMENTS.map(([newer, older, how]) => ({ newer, older, how, detected: unique.some((f) => f.newer === newer && f.older === older) }));
  const spurious = unique.filter((f) => !TRUE_REPLACEMENTS.some(([n, o]) => n === f.newer && o === f.older));

  const s = kg.openSession('eval', 'project-log-trial');
  const run = async (machine: string) => {
    const rows = [];
    for (const { q, current, stale } of QUESTIONS) {
      const r = await kg.search({ query: q, k: K, machine, sessionId: s, shadow: false });
      const entries = r.items.map((i) => label(titleOf(i.sourceChunkIds[0] ?? i.id)));
      const firstCurrent = entries.indexOf(current);
      rows.push({ q, returned: entries, currentRank: firstCurrent < 0 ? null : firstCurrent + 1, staleShown: entries.filter((e) => stale.includes(e)), kinds: r.items.map((i) => i.kind), texts: r.items.map((i) => i.text.replace(/\s+/g, ' ').slice(0, 130)) });
    }
    return rows;
  };
  const machines: Record<string, Awaited<ReturnType<typeof run>>> = {};
  for (const m of ['chunk-search', 'current-state']) machines[m] = await run(m);

  const summary = Object.fromEntries(
    Object.entries(machines).map(([m, rows]) => [m, {
      currentInTop1: rows.filter((r) => r.currentRank === 1).length,
      currentInTopK: rows.filter((r) => r.currentRank !== null).length,
      questionsShowingAStaleEntry: rows.filter((r) => r.staleShown.length > 0).length,
      questionsWithStaleEntries: QUESTIONS.filter((q) => q.stale.length > 0).length,
    }]),
  );
  console.log(JSON.stringify({ k: K, extraction: extract, entries: chunks.length, buildSeconds: seconds, modelCalls: (report as unknown as { stats?: unknown }).stats, stats: kg.index.stats(), detection, spurious, summary, machines }, null, 1));
  kg.close();
} finally {
  rmSync(work, { recursive: true, force: true });
}
