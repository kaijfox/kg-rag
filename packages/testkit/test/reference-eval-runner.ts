/**
 * Control for evalRunnerConformance: a minimal runner written to the eval card, used only to show the suite can
 * pass. Not exported; the `eval` package writes its own.
 */
import { EVAL_RUN_TOOL, KgError, canonicalJson, loggedLlm, orphanedGold, runTool, sha256hex, type EvalRunId, type Json, type SearchId } from '@kg/core';
import type { RunEval } from '../src/conformance/evalRunner';

export const referenceRunEval: RunEval = async (d, set, o) => {
  const { sessionId } = await d.api.openSession({ kind: 'eval', label: set.name });
  const buildId = o.buildId ?? d.rt.currentBuild();
  if (!buildId) throw new KgError('precondition', 'no build');
  const input = { evalSetId: set.id, evalSetSha256: sha256hex(canonicalJson(set as unknown as Json)), buildId, conditions: o.conditions, ks: o.ks };
  return runTool(d.rt, EVAL_RUN_TOOL, sessionId, input, async (ctx) => {
    if (!d.store.getBuild(buildId)) throw new KgError('not_found', `build ${buildId}`);
    if (d.store.staleCheck(buildId).stale && !o.allowStale) throw new KgError('precondition', `build ${buildId} is stale`);
    const runId = ctx.ids.ulid('er_') as EvalRunId;
    d.repo.putRun({ runId, evalSetId: set.id, evalSetSha256: input.evalSetSha256, buildId, sessionId, config: { conditions: o.conditions, ks: o.ks }, createdAt: ctx.clock.now() });
    ctx.emit('eval.run.started', { runId, buildId, evalSetId: set.id, evalSetSha256: input.evalSetSha256, conditions: o.conditions, ks: o.ks }, { buildId });
    const llm = loggedLlm(d.answerer, ctx);
    for (const q of set.questions)
      for (const c of o.conditions) {
        let searchId: SearchId | null = null;
        let recall: Record<string, number> | null = null;
        let retrieved: string[] | null = null;
        if (c === 'retrieved') {
          const r = await d.api.search(sessionId, { query: q.question, k: Math.max(...o.ks), buildId });
          searchId = r.searchId;
          retrieved = r.items.map((i) => i.itemId);
          recall = {};
          for (const k of o.ks) {
            const cover = new Set(r.items.filter((i) => i.rank <= k && i.kind !== 'summary').flatMap((i) => i.sourceChunkIds));
            recall[String(k)] = q.goldChunkIds.filter((g) => cover.has(g)).length / q.goldChunkIds.length;
          }
        }
        const ans = await llm.complete({ purpose: 'eval-answer', model: 'qwen3.5:latest', system: 'answer', messages: [{ role: 'user', content: q.question }], temperature: 0, maxTokens: 64 });
        const v = await d.judge(q, ans.text, c);
        ctx.emit('eval.question.scored', { runId, questionId: q.id, condition: c, recall, judgeScore: v.score }, { buildId, searchId });
        d.repo.putResult({ runId, questionId: q.id, condition: c, searchId, retrieved: retrieved as never, recall, answer: ans.text, judgeScore: v.score, judgeRaw: v.raw });
      }
    const summary = { orphaned: orphanedGold(set, d.store, buildId) as unknown as Json };
    ctx.emit('eval.run.completed', { runId, summary }, { buildId });
    return { runId, summary };
  });
};
