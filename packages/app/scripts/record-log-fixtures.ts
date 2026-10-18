/**
 * Records testkit/fixtures/log/*.jsonl from a deterministic skeleton run (FixedClock, SeqIds, HashEmbedder,
 * mini-corpus artifacts). The logs are inputs for viewer and analysis tests, not expectations of the code
 * that produced them; their content is described by hand in fixtures/log/README.md.
 * Usage: tsx scripts/record-log-fixtures.ts <out dir>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL_RUN_TOOL, evalSetId, loggedLlm, runTool, sha256hex, type EvalRunId, type EventEnvelope, type Json, type SearchResponse } from '@kg/core';
import { FixedClock, FixtureParser, HashEmbedder, MINI_DOCS, ScriptedLlm, SeqIds, miniArtifactPath, miniConfig, miniParserEntries } from '@kg/testkit';
import { createSkeleton } from '../src/index';

const out = process.argv[2]!;
const clock = new FixedClock('2026-10-17T12:00:00.000Z', 250);
const ids = new SeqIds();
const sk = createSkeleton({ parser: new FixtureParser(miniParserEntries()), embedder: new HashEmbedder(4096), config: miniConfig(), clock, ids });
const jsonl = (evs: EventEnvelope[]) => evs.map((e) => JSON.stringify(e)).join('\n') + '\n';

// ---- agent session: ingest, 3 searches, item and overall feedback, a failed call, usage, outcome, note
const agent = (await sk.api.openSession({ kind: 'agent', label: 'claude-code: thermo questions', meta: { client: 'claude-code' } })).sessionId;
await sk.api.ingest(agent, { artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(1, d) })) });
const s1 = await sk.api.search(agent, { query: 'Boltzmann formula tombstone microstates', k: 3 });
await sk.api.feedback(agent, { searchId: s1.searchId, items: [{ itemId: s1.items[0]!.itemId, relevance: 2 }, { itemId: s1.items[2]!.itemId, relevance: 1 }], note: 'first hit is the formula' });
const s2 = await sk.api.search(agent, { query: 'der Waals', k: 3 });
await sk.api.feedback(agent, { searchId: s2.searchId, overall: 1, note: 'only the first result is about van der Waals' });
const s3 = await sk.api.search(agent, { query: 'Avogadro', k: 3 });
await sk.api.feedback(agent, { searchId: s3.searchId, overall: 0, note: 'nothing about Avogadro in this corpus' });
await sk.api.feedback(agent, { searchId: 'sr_0000000000000000000000ZZZZ' as never, overall: 2 }).catch(() => undefined);
await sk.api.reportUsage(agent, { searchId: s1.searchId, itemIds: [s1.items[0]!.itemId], account: 'quoted S = k log W' });
await sk.api.reportOutcome(agent, { searchId: s1.searchId, success: true, note: 'answer accepted' });
await sk.api.addNote(agent, { text: 'search 3 is a corpus gap, not a retrieval failure' });
writeFileSync(join(out, 'session-agent.jsonl'), jsonl(sk.log.events(agent)));

// ---- eval session: one eval run over two questions, each a nested KgApi.search plus a scripted judge call
const evalS = (await sk.api.openSession({ kind: 'eval', label: 'eval mini-set, retrieved condition', meta: {} })).sessionId;
const questions = [
  { id: 'q1', q: 'Which formula relates entropy to the number of microstates?', gold: s1.items[0]!.itemId },
  { id: 'q2', q: 'Which equation corrects the ideal gas law for excluded volume?', gold: s2.items[0]!.itemId },
];
const setId = evalSetId(questions as unknown as Json);
const judge = new ScriptedLlm({ byPurpose: { 'eval-judge': '{"score": 1, "rationale": "matches the reference"}' } });
await runTool(sk.runtime, EVAL_RUN_TOOL, evalS, { evalSetId: setId, evalSetSha256: sha256hex(JSON.stringify(questions)), conditions: ['retrieved'], ks: [1, 3] }, async (ctx, input) => {
  const runId = ctx.ids.ulid('er_') as EvalRunId;
  const buildId = sk.store.currentBuild()!;
  ctx.emit('eval.run.started', { runId, buildId, evalSetId: input.evalSetId, evalSetSha256: input.evalSetSha256, conditions: input.conditions, ks: input.ks }, { buildId });
  for (const q of questions) {
    const r: SearchResponse = await sk.api.search(evalS, { query: q.q, k: 3 });
    const rank = r.items.findIndex((i) => i.itemId === q.gold) + 1;
    await loggedLlm(judge, ctx).complete({ purpose: 'eval-judge', model: 'qwen3.5:latest', system: 'grade', messages: [{ role: 'user', content: q.q }], temperature: 0, maxTokens: 64 });
    ctx.emit('eval.question.scored', { runId, questionId: q.id, condition: 'retrieved', recall: { '1': rank === 1 ? 1 : 0, '3': rank >= 1 && rank <= 3 ? 1 : 0 }, judgeScore: 1 }, { buildId, searchId: r.searchId });
  }
  ctx.emit('eval.run.completed', { runId, summary: { questions: questions.length } }, { buildId });
  return { runId, summary: { questions: questions.length } };
});
writeFileSync(join(out, 'session-eval.jsonl'), jsonl(sk.log.events(evalS)));

// ---- live partial: a session cut off in the middle of its second search (after the first search.step)
const live = (await sk.api.openSession({ kind: 'agent', label: 'live session (cut mid-search)', meta: {} })).sessionId;
await sk.api.search(live, { query: 'entropy', k: 5 });
await sk.api.search(live, { query: 'van der Waals excluded volume', k: 5 });
const evs = sk.log.events(live);
const secondQuery = evs.filter((e) => e.type === 'query')[1]!;
const cut = evs.findIndex((e) => e.type === 'search.step' && e.searchId === secondQuery.searchId);
writeFileSync(join(out, 'session-live-partial.jsonl'), jsonl(evs.slice(0, cut + 1)));
console.log('wrote', ['session-agent', 'session-eval', 'session-live-partial'].map((n) => join(out, `${n}.jsonl`)).join(', '));
