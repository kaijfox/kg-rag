/**
 * Runs an eval set against one author's index and exports every result.
 * Usage: tsx scripts/baselineRun.ts <setAuthor> <indexAuthor> --conditions a,b --tag name [--limit n] [--ks 1,5,10,20]
 * setAuthor === indexAuthor is the own-corpus run. Otherwise it is a cross-corpus run: the questions come from the other
 * author's text, the gold chunk IDs name chunks that are not in this index, so recall is meaningless (exported as null)
 * and only answers and judgements are scored (the gold condition uses the verbatim gold text).
 * Output: scratch/sprint-2/run-<tag>.json (summary and one row per question and condition, answers included).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSet } from '@kg/core';
import { evalSetId } from '@kg/core';
import { makeJudge } from '@kg/eval';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const setAuthor = process.argv[2]!;
const indexAuthor = process.argv[3]!;
const out = join(root, 'scratch/sprint-2');
const tag = arg('--tag', `${setAuthor}-on-${indexAuthor}`);
const limit = Number(arg('--limit', '0'));
const conditions = arg('--conditions', 'no-context,gold,retrieved').split(',');
const ks = arg('--ks', '1,5,10,20').split(',').map(Number);

const full = JSON.parse(readFileSync(join(out, `eval-set-${setAuthor}.json`), 'utf8')) as EvalSet;
let questions = full.questions;
if (limit > 0 && limit < questions.length) {
  // an even spread over the file order, which interleaves nothing: take every n-th so all types appear
  const step = questions.length / limit;
  questions = Array.from({ length: limit }, (_, i) => full.questions[Math.floor(i * step)]!);
}
const cross = setAuthor !== indexAuthor;
const set: EvalSet = { ...full, name: `${full.name}${cross ? '-cross' : ''}${limit ? `-first${limit}` : ''}`, questions };
if (limit) set.id = evalSetId(questions as never);

const kg = compose({ dbPath: join(out, `${indexAuthor}.kg.sqlite`), artifactDir: join(root, 'test/corpa/stat-mech/artifacts') });
const t0 = performance.now();
const res = await kg.runEval(
  { rt: kg.runtime, api: kg.api, store: kg.store, answerer: kg.llm, judge: makeJudge(kg.llm), repo: kg.repo },
  set,
  { conditions, ks, buildId: kg.store.currentBuild()! },
);
const ms = Math.round(performance.now() - t0);
const byId = new Map(questions.map((q) => [q.id, q]));
const rows = kg.repo.results(res.runId).map((r) => ({ ...r, ...(cross ? { recall: null } : {}), type: byId.get(r.questionId)!.type, docs: byId.get(r.questionId)!.sourceDocKeys }));
writeFileSync(join(out, `run-${tag}.json`), JSON.stringify({ tag, setAuthor, indexAuthor, setId: set.id, runId: res.runId, ms, conditions, ks, summary: res.summary, rows }, null, 1));
console.log(`run ${tag}: ${questions.length} questions x ${conditions.length} conditions in ${ms} ms`, JSON.stringify(res.summary).slice(0, 800));
kg.close();
