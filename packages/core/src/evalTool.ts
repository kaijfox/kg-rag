/**
 * Eval's path to the log. Eval is not an MCP tool, but its events must go
 * through runTool like everything else: the eval runner calls runTool(rt, EVAL_RUN_TOOL, session, input,
 * handler); the handler emits eval.run.started / eval.question.scored / eval.run.completed via ctx and calls
 * KgApi.search for retrieval (nested tool calls in the same session). LLM calls go through loggedLlm so each
 * one appends llm.called. EVAL_RUN_TOOL is deliberately not in TOOLS, so MCP never exposes it.
 */
import { z } from 'zod';
import { sha256hex, type BuildId, type EvalRunId, type EvalSetId, type RecipeId } from './ids';
import type { Json } from './model';
import type { ToolDef } from './api';
import type { Ctx } from './ports/infra';
import { requestSha256, type Llm } from './ports/llm';
import { S, jsonSchema } from './schemas';

export interface EvalRunInput {
  evalSetId: EvalSetId;
  evalSetSha256: string;
  buildId?: BuildId;
  conditions: string[];
  ks: number[];
  /** search recipe per retrieved condition name; absent = the build's default search recipe for all of them */
  searchRecipes?: Record<string, RecipeId>;
}
/** 0.6.1: the judge of a run: its machine recipe (which carries the prompt digest) and the model it calls. */
export interface EvalJudgeInfo {
  recipeId: RecipeId;
  model: string;
}
/** 0.6.1: the answerer of a run: the model and a sha256 digest of its prompt text. */
export interface EvalAnswererInfo {
  model: string;
  promptDigest: string;
}
/**
 * 0.6.1: keys of EvalRunRecord.config (a JsonObject). `judge` and `answerer` are always written, with the same values
 * as eval.run.started.
 */
export interface EvalRunConfig {
  conditions: string[];
  ks: number[];
  searchRecipes?: Record<string, RecipeId>;
  judge: EvalJudgeInfo;
  answerer: EvalAnswererInfo;
}
export interface EvalRunOutput {
  runId: EvalRunId;
  summary: Json;
}

export const EVAL_RUN_TOOL: ToolDef<EvalRunInput, EvalRunOutput> = {
  name: 'eval_run',
  description: 'Internal: one eval run. Not exposed over MCP.',
  input: z.strictObject({
    evalSetId: S.evalSetId,
    evalSetSha256: S.sha256,
    buildId: S.buildId.optional(),
    conditions: z.array(z.string().min(1)).min(1),
    ks: z.array(z.number().int().positive()).min(1),
    searchRecipes: z.record(z.string().min(1), S.recipeId).optional(),
  }),
  output: z.strictObject({ runId: S.evalRunId, summary: jsonSchema }),
  summarize: (o) => ({ runId: o.runId }),
};

/** Wraps an Llm so every call appends llm.called (request/response hashes, tokens, duration) through ctx. */
export function loggedLlm(llm: Llm, ctx: Ctx): Llm {
  return {
    async complete(r) {
      const t0 = ctx.clock.monotonicMs();
      const res = await llm.complete(r);
      ctx.emit('llm.called', {
        purpose: r.purpose,
        model: res.model,
        requestSha256: requestSha256(r),
        responseSha256: sha256hex(res.text),
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        durationMs: Math.max(0, ctx.clock.monotonicMs() - t0),
      });
      return res;
    },
  };
}
