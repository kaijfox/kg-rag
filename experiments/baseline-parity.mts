/**
 * Checks the rebuilt system against the first build's stored retrieval results: for each author, builds a database from
 * the kept stat-mech documents with the real embedding model, runs the pinned questions through the baseline machine, and
 * compares recall per question with the first build's stored run. Needs Ollama with embeddinggemma. No answers or judging.
 *
 *   node_modules/.bin/tsx scratch/rebuild/baseline-parity.mts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { retrievalMetrics, type EvalSet } from '../../packages/eval/src';
import { ingest } from '../../packages/modules/src';
import { openKg } from '../../packages/app/src';

const ROOT = resolve(import.meta.dirname, '../..');
const authors: Record<string, string[]> = { kardar: ['FoundationsKardar', 'ThermoKardar'], plischke: ['FoundationsPlischke', 'ThermoPlischke'] };
const tmp = mkdtempSync(join(tmpdir(), 'kg-parity-'));
let same = 0;
let total = 0;
for (const [author, docs] of Object.entries(authors)) {
  const db = join(tmp, author);
  const kg = openKg({ db, create: true });
  kg.saveConfig({ sources: docs.map((d) => ({ path: join(ROOT, `test/corpa/stat-mech/${d}.pdf`) })) });
  const t0 = performance.now();
  const rep = await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
  console.log(`${author}: ${rep.stats.currentChunks} chunks, ${rep.embedded} embedded in ${Math.round((performance.now() - t0) / 1000)} s`);
  const set = JSON.parse(readFileSync(join(ROOT, `scratch/sprint-2/eval-set-${author}.json`), 'utf8')) as EvalSet;
  const old = JSON.parse(readFileSync(join(ROOT, `scratch/sprint-2/run-own-k5-${author}.json`), 'utf8')).summary.byCondition.retrieved.retrieval.perQuestion as Record<string, { recall: Record<string, number> }>;
  const session = kg.openSession('eval', 'parity');
  const ranked = new Map<string, { id: string; kind: 'chunk'; sourceChunkIds: string[] }[]>();
  for (const q of set.questions) {
    const r = await kg.search({ query: q.question, k: 5, sessionId: session });
    ranked.set(q.id, r.items.map((i) => ({ id: i.id, kind: 'chunk' as const, sourceChunkIds: i.sourceChunkIds })));
  }
  const m = retrievalMetrics(set.questions, (id) => ranked.get(id)!, [1, 3, 5]);
  let diff = 0;
  for (const q of set.questions) {
    total++;
    const a = m.perQuestion[q.id]!.recall;
    const b = old[q.id]!.recall;
    if ([1, 3, 5].every((k) => Math.abs(a[String(k)]! - b[String(k)]!) < 1e-9)) same++;
    else {
      diff++;
      console.log(`  ${q.id} differs: now ${JSON.stringify(a)} was ${JSON.stringify(b)}`);
    }
  }
  console.log(`${author}: recall now ${JSON.stringify(m.overall.recall)}, was ${JSON.stringify(Object.fromEntries([1, 3, 5].map((k) => [k, Object.values(old).reduce((s, x) => s + x.recall[String(k)]!, 0) / Object.keys(old).length])))}; ${diff} of ${set.questions.length} questions differ`);
  kg.close();
}
console.log(`identical recall at k = 1, 3 and 5 for ${same} of ${total} questions`);
rmSync(tmp, { recursive: true, force: true });
