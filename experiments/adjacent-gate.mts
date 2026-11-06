/**
 * The measurement that gates the adjacent-chunk step: retrieval recall of the baseline machine and the machine that adds the
 * chunks next to the best three, on the 63 pinned questions, by question type. Retrieval only; no answers or judging.
 *
 *   node_modules/.bin/tsx scratch/rebuild/adjacent-gate.mts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { retrievalMetrics, type EvalSet } from '../../packages/eval/src';
import { ingest } from '../../packages/modules/src';
import { openKg } from '../../packages/app/src';

const ROOT = resolve(import.meta.dirname, '../..');
const authors: Record<string, string[]> = { kardar: ['FoundationsKardar', 'ThermoKardar'], plischke: ['FoundationsPlischke', 'ThermoPlischke'] };
const tmp = mkdtempSync(join(tmpdir(), 'kg-gate-'));
const machines = ['chunk-search', 'chunk-search-adjacent'];
const acc: Record<string, Record<string, { n: number; recall: Record<string, number>; allGold: Record<string, number> }>> = {};
for (const [author, docs] of Object.entries(authors)) {
  const kg = openKg({ db: join(tmp, author), create: true });
  kg.saveConfig({ sources: docs.map((d) => ({ path: join(ROOT, `test/corpa/stat-mech/${d}.pdf`) })) });
  await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
  const set = JSON.parse(readFileSync(join(ROOT, `scratch/sprint-2/eval-set-${author}.json`), 'utf8')) as EvalSet;
  const s = kg.openSession('eval', 'adjacent-gate');
  for (const machine of machines) {
    const ranked = new Map<string, { id: string; kind: 'chunk'; sourceChunkIds: string[] }[]>();
    for (const q of set.questions) ranked.set(q.id, (await kg.search({ query: q.question, k: 5, machine, sessionId: s })).items.map((i) => ({ id: i.id, kind: 'chunk' as const, sourceChunkIds: i.sourceChunkIds })));
    const m = retrievalMetrics(set.questions, (id) => ranked.get(id)!, [1, 5]);
    for (const [type, v] of Object.entries(m.byType)) {
      const a = ((acc[machine] ??= {})[type] ??= { n: 0, recall: { '1': 0, '5': 0 }, allGold: { '1': 0, '5': 0 } });
      a.n += v.n;
      for (const k of ['1', '5']) (a.recall[k] += v.recall[k]! * v.n, (a.allGold[k] += v.allGold[k]! * v.n));
    }
  }
  kg.close();
}
for (const machine of machines) {
  console.log(machine);
  for (const [type, a] of Object.entries(acc[machine]!)) console.log(`  ${type.padEnd(10)} n=${String(a.n).padStart(2)}  recall@1 ${(a.recall['1']! / a.n).toFixed(2)}  recall@5 ${(a.recall['5']! / a.n).toFixed(2)}  all gold in top 5: ${(a.allGold['5']! / a.n).toFixed(2)}`);
}
rmSync(tmp, { recursive: true, force: true });
