/**
 * Sweeps the adjacent-chunk settings (how many best chunks to expand, how far, and how much a neighbour scores relative to
 * its seed) and reports recall and the share of questions with all gold chunks in the top 5, by question type.
 *
 *   node_modules/.bin/tsx scratch/rebuild/adjacent-sweep.mts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { retrievalMetrics, type EvalSet } from '../../packages/eval/src';
import { ingest } from '../../packages/modules/src';
import { openKg } from '../../packages/app/src';

const ROOT = resolve(import.meta.dirname, '../..');
const authors: Record<string, string[]> = { kardar: ['FoundationsKardar', 'ThermoKardar'], plischke: ['FoundationsPlischke', 'ThermoPlischke'] };
const variants = [
  { name: 'baseline', seeds: 0, radius: 0, decay: 0 },
  { name: 'seeds 3, radius 1, decay 0.9', seeds: 3, radius: 1, decay: 0.9 },
  { name: 'seeds 2, radius 1, decay 0.99', seeds: 2, radius: 1, decay: 0.99 },
  { name: 'seeds 2, radius 2, decay 0.99', seeds: 2, radius: 2, decay: 0.99 },
  { name: 'seeds 1, radius 2, decay 0.99', seeds: 1, radius: 2, decay: 0.99 },
];
const tmp = mkdtempSync(join(tmpdir(), 'kg-sweep-'));
const acc: Record<string, Record<string, { n: number; recall5: number; all5: number }>> = {};
for (const [author, docs] of Object.entries(authors)) {
  const kg = openKg({ db: join(tmp, author), create: true });
  kg.saveConfig({ sources: docs.map((d) => ({ path: join(ROOT, `test/corpa/stat-mech/${d}.pdf`) })) });
  await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
  for (const [i, v] of variants.entries()) {
    kg.registry.addMachine({ name: `v${i}`, version: '1', provides: ['query', 'k'], start: 'embed', states: v.seeds === 0
      ? { embed: { module: 'embed-query', next: 'nearest' }, nearest: { module: 'nearest-chunks', next: 'cut' }, cut: { module: 'keep-top-k', next: null } }
      : { embed: { module: 'embed-query', next: 'nearest' }, nearest: { module: 'nearest-chunks', next: 'adj' }, adj: { module: 'adjacent-chunks', settings: { seeds: v.seeds, radius: v.radius, decay: v.decay }, next: 'cut' }, cut: { module: 'keep-top-k', next: null } } });
  }
  const set = JSON.parse(readFileSync(join(ROOT, `scratch/sprint-2/eval-set-${author}.json`), 'utf8')) as EvalSet;
  const s = kg.openSession('eval', 'adjacent-sweep');
  for (const [i, v] of variants.entries()) {
    const ranked = new Map<string, { id: string; kind: 'chunk'; sourceChunkIds: string[] }[]>();
    for (const q of set.questions) ranked.set(q.id, (await kg.search({ query: q.question, k: 5, machine: `v${i}`, sessionId: s })).items.map((x) => ({ id: x.id, kind: 'chunk' as const, sourceChunkIds: x.sourceChunkIds })));
    const m = retrievalMetrics(set.questions, (id) => ranked.get(id)!, [5]);
    for (const [type, x] of Object.entries(m.byType)) {
      const a = ((acc[v.name] ??= {})[type] ??= { n: 0, recall5: 0, all5: 0 });
      a.n += x.n; a.recall5 += x.recall['5']! * x.n; a.all5 += x.allGold['5']! * x.n;
    }
  }
  kg.close();
}
for (const v of variants) console.log(v.name.padEnd(32), Object.entries(acc[v.name]!).map(([t, a]) => `${t} ${(a.recall5 / a.n).toFixed(2)}/${(a.all5 / a.n).toFixed(2)}`).join('   '));
console.log('(each cell: recall@5 / share with all gold in the top 5)');
rmSync(tmp, { recursive: true, force: true });
