import { TOOLS, runTool, recipeId, type EventEnvelope, type JsonObject, type Llm, type LlmRequest, type LlmResponse, type RecipeSpec, type SearchResponse, type SearchService } from '@kg/core';
import { FixedClock, InMemoryEventLog, SeqIds, loadMiniCorpus, type MiniCorpus } from '@kg/testkit';
import { createSearchService, type Executor } from '../src/service';

/** Llm that answers from a per-purpose queue (the last answer repeats). */
export class QueueLlm implements Llm {
  calls: string[] = [];
  constructor(private q: Record<string, unknown[]>) {}
  async complete(r: LlmRequest): Promise<LlmResponse> {
    this.calls.push(r.purpose);
    const list = this.q[r.purpose]!;
    const v = list.length > 1 ? list.shift() : list[0];
    return { text: JSON.stringify(v), model: r.model, inputTokens: 1, outputTokens: 1 };
  }
}

export async function searchWith(execute: Executor, recipe: RecipeSpec | null, query: string, k = 3, llm?: Llm, mc?: MiniCorpus) {
  mc ??= await loadMiniCorpus();
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const service: SearchService = createSearchService({ store: mc.store, embedder: mc.embedder, ...(llm ? { llm } : {}), execute });
  const session = log.openSession({ kind: 'test', label: 'spike', meta: {} });
  const rt = { log, clock, ids, currentBuild: () => mc!.store.currentBuild() };
  const rid = recipe ? mc.store.putRecipe(recipe) : undefined;
  let res: SearchResponse | undefined;
  let error: unknown;
  try {
    res = await runTool(rt, TOOLS.search, session, { query, k, ...(rid ? { searchRecipeId: rid } : {}) }, (ctx, r) => service.search(ctx, r));
  } catch (e) { error = e; }
  const events = log.events(session) as EventEnvelope[];
  const steps = events.filter((e) => e.type === 'search.step').map((e) => (e.payload as unknown as { trace: JsonObject & { stepType: string } }).trace);
  return { res, error, events, steps, mc, log, session, rt, rid, recipeId: rid ?? (recipe ? recipeId(recipe) : undefined) };
}
export const stripRecipe = (events: EventEnvelope[]) => JSON.parse(JSON.stringify(events).replace(/"searchRecipeId":"rc_[a-z0-9]+"/g, '"searchRecipeId":"X"'));
