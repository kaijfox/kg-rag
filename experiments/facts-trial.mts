/**
 * Facts trial. The default search machine of a new database, "facts-and-neighbours", ranks extracted facts beside passages.
 * This builds both Plischke textbooks with extraction on (one qwen3.5 call per passage; responses from the earlier
 * ThermoPlischke trial are reused when they are still valid) and runs all 26 reviewed Plischke questions through the plain
 * passage search and through facts-and-neighbours, retrieval only. Recall at k is the share of a question's answering
 * passages that appear among the first k results, where a fact counts for the passages it cites. Needs Ollama with
 * embeddinggemma and qwen3.5; about 25 minutes the first time.
 *
 *   node_modules/.bin/tsx experiments/facts-trial.mts > experiments/facts-trial.out.json
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runEval, type EvalSet } from '../packages/eval/src';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'kg-facts-'));
try {
  const db = join(tmp, 'db');
  mkdirSync(db, { recursive: true });
  const old = join(ROOT, 'kg-data/trial-thermo-plischke/cache.sqlite');
  if (existsSync(old)) copyFileSync(old, join(db, 'cache.sqlite'));
  const kg = openKg({ db, create: true });
  kg.saveConfig({ sources: ['FoundationsPlischke', 'ThermoPlischke'].map((d) => ({ path: join(ROOT, `test/corpa/stat-mech/${d}.pdf`) })), extract: { ...kg.config.extract, enabled: true } });
  const t0 = Date.now();
  const rep = await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
  const seconds = Math.round((Date.now() - t0) / 1000);
  const set = JSON.parse(readFileSync(join(ROOT, 'test/corpa/stat-mech/eval/eval-set-plischke.json'), 'utf8')) as EvalSet;
  const { runId, summary } = await runEval(kg, set, { conditions: ['chunk-search', 'facts-and-neighbours'], ks: [1, 3, 5], retrievalOnly: true });
  const rows = kg.history.evalResults(runId).map((r) => ({ questionId: r.questionId, type: set.questions.find((q) => q.id === r.questionId)?.type, machine: r.condition, recall: r.recall, retrieved: r.retrieved }));
  console.log(JSON.stringify({ buildSeconds: seconds, stats: kg.index.stats(), build: rep.stats, summary, rows }, null, 1));
  kg.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
