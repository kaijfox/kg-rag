/**
 * A first look at fact extraction with the local model on one document (ThermoPlischke, 39 chunks): time, how many
 * facts pass the checks, why the rest are rejected, a sample, and whether the facts-and-neighbours machine finds the gold
 * chunks of the pinned questions that name only this document. Needs Ollama with embeddinggemma and qwen3.5.
 *
 *   node_modules/.bin/tsx experiments/extraction-trial.mts [directory-to-keep]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { retrievalMetrics, type EvalSet } from '../packages/eval/src';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const ROOT = resolve(import.meta.dirname, '..');
const db = resolve(process.argv[2] ?? join(ROOT, 'kg-data/trial-thermo-plischke'));
mkdirSync(db, { recursive: true });
const kg = openKg({ db, create: true });
kg.saveConfig({ sources: [{ path: join(ROOT, 'test/corpa/stat-mech/ThermoPlischke.pdf') }], extract: { enabled: true, secondPass: false, maxFactsPerChunk: 12 } });
const t0 = performance.now();
const rep = await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
console.log(`ingest ${Math.round((performance.now() - t0) / 1000)} s:`, JSON.stringify(rep.stats));
const step = kg.history.eventsOfType('step').find((e) => (e.payload as { module?: string }).module === 'extract-facts@1')!.payload as { notes: { text: string; data?: { rejected: { reason: string; text: string }[] } }[] };
console.log(step.notes[0]!.text);
const reasons: Record<string, number> = {};
for (const r of step.notes[0]!.data?.rejected ?? []) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
console.log('first rejections by reason (up to 25 logged):', JSON.stringify(reasons));
const ids = kg.index.currentChunks().slice(5, 9).flatMap((c) => kg.index.itemsByChunk().get(c.id) ?? []).slice(0, 8);
for (const i of ids) console.log(' -', i.text);

const set = JSON.parse(readFileSync(join(ROOT, 'test/corpa/stat-mech/eval/eval-set-plischke.json'), 'utf8')) as EvalSet;
const here = new Set(kg.index.currentChunks().map((c) => c.id));
const qs = set.questions.filter((q) => q.goldChunkIds.every((g) => here.has(g)));
const session = kg.openSession('eval', 'extraction-trial');
for (const machine of ['chunk-search', 'chunk-search-adjacent', 'facts-and-neighbours']) {
  const ranked = new Map<string, { id: string; kind: 'chunk' | 'fact' | 'summary'; sourceChunkIds: string[] }[]>();
  for (const q of qs) ranked.set(q.id, (await kg.search({ query: q.question, k: 5, machine, sessionId: session })).items.map((i) => ({ id: i.id, kind: i.kind, sourceChunkIds: i.sourceChunkIds })));
  const m = retrievalMetrics(qs, (id) => ranked.get(id)!, [1, 3, 5]);
  console.log(`${machine.padEnd(22)} n=${qs.length} recall ${JSON.stringify(Object.fromEntries(Object.entries(m.overall.recall).map(([k, x]) => [k, Math.round(x * 100) / 100])))}`);
}
kg.close();
