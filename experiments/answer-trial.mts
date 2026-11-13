/**
 * Answer trial. Does handing an answering model the passages that search returns improve its answers? Twelve reviewed
 * questions about the Plischke textbooks (8 single-passage, 2 multi-passage, 2 whole-topic) are answered by the local model
 * under three conditions: with no passages ("no-context"), with the passages the question was written from ("gold", the
 * best a retriever could do), and with the five passages the plain search returns ("retrieved"). The same local model then
 * scores each answer from 0 to 1 against the reference answer. Needs Ollama with embeddinggemma and qwen3.5.
 *
 *   node_modules/.bin/tsx experiments/answer-trial.mts > experiments/answer-trial.out.json
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runEval, type EvalSet } from '../packages/eval/src';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'kg-answer-'));
try {
  const kg = openKg({ db: join(tmp, 'db'), create: true });
  kg.saveConfig({ sources: ['FoundationsPlischke', 'ThermoPlischke'].map((d) => ({ path: join(ROOT, `test/corpa/stat-mech/${d}.pdf`) })) });
  await ingest(kg, { artifactDirs: [join(ROOT, 'test/corpa/stat-mech/artifacts')] });
  const full = JSON.parse(readFileSync(join(ROOT, 'test/corpa/stat-mech/eval/eval-set-plischke.json'), 'utf8')) as EvalSet;
  const pick = (type: string, n: number) => full.questions.filter((q) => q.type === type).slice(0, n);
  const questions = [...pick('single-hop', 8), ...pick('multi-hop', 2), ...pick('topic', 2)];
  const set: EvalSet = { ...full, name: 'plischke-subset', questions };
  const { runId, summary } = await runEval(kg, set, { conditions: ['no-context', 'gold', 'retrieved'], ks: [1, 5] });
  const rows = kg.history.evalResults(runId).map((r) => ({ questionId: r.questionId, type: questions.find((q) => q.id === r.questionId)?.type, condition: r.condition, judge: r.judgeScore, recall: r.recall, answer: r.answer }));
  console.log(JSON.stringify({ summary, questions: questions.map((q) => ({ id: q.id, type: q.type, question: q.question, referenceAnswer: q.referenceAnswer })), rows }, null, 1));
  kg.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
