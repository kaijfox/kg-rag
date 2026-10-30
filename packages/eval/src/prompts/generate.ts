import { topologyOf } from '@kg/pipeline';
import {
  KgError,
  loggedLlm,
  recipeId,
  type Chunk,
  type ChunkId,
  type DocKey,
  type Ctx,
  type Llm,
  type LlmRequest,
  type MachineRecipeSpec,
  type QuestionDraft,
  type QuestionType,
  type RecipeId,
} from '@kg/core';
import { evalGenerateMachine, type DroppedDraft, type GenerateOutput, type GenerationGroup, type GenerationPassage } from '../machines/evalGenerate';
import { settle } from '../machines/settle';
import { fill, loadPrompt, promptDigest } from './loader';

export interface GenerateSettings {
  model: string;
  temperature: number;
  /** questions asked per group of each type; 0 skips the type */
  mix: { 'single-hop': number; 'multi-hop': number; topic: number };
  /** malformed replies asked again per group before the run fails */
  retryBudget: number;
  [k: string]: string | number | { [k: string]: number };
}

export const GENERATE_SETTINGS: GenerateSettings = {
  model: 'qwen3.5:latest',
  temperature: 0.7,
  mix: { 'single-hop': 1, 'multi-hop': 1, topic: 1 },
  retryBudget: 2,
};

const PROMPT_FOR: Record<GenerationGroup['type'], string> = {
  'single-hop': 'generate-single-hop.md',
  'multi-hop': 'generate-multi-hop.md',
  topic: 'generate-topic.md',
};
/** The prompt files the eval-generate machine loads; its recipe's promptDigest covers exactly these. */
export const GENERATE_PROMPTS: readonly string[] = Object.values(PROMPT_FOR);

/** The request for one group: the passages numbered from 0, the section for topic groups, the count from the mix. */
export function generationRequest(group: GenerationGroup, settings: GenerateSettings): LlmRequest {
  const p = loadPrompt(PROMPT_FOR[group.type]);
  const count = String(settings.mix[group.type]);
  const passages = group.passages.map((c, i) => `[${i}] ${c.text}`).join('\n\n');
  const section = group.passages[0]?.sectionPath.join(' > ') ?? '';
  return {
    purpose: 'eval-generate',
    model: settings.model,
    system: fill(p.system, { count }),
    messages: [{ role: 'user', content: fill(p.user, { passages, section }) }],
    temperature: settings.temperature,
    maxTokens: 1200,
    json: true,
  };
}

export interface Generated {
  drafts: QuestionDraft[];
  /** drafts refused by the dedupe or wording check; `group` indexes the `groups` argument */
  dropped: DroppedDraft[];
  /** the id of the recipe that wrote them, for `EvalSet.genRecipeId` */
  genRecipeId: RecipeId;
}

/** One line for a log: how many drafts were dropped and why. */
export function describeDropped(dropped: readonly DroppedDraft[]): string {
  if (dropped.length === 0) return 'no drafts dropped';
  return `${dropped.length} drafts dropped: ${dropped.map((d) => `group ${d.group} ${d.reason}`).join(', ')}`;
}

/**
 * Writes questions for the groups of chunks: one prompt per group, strict parsing with retries, then dedupe and the
 * wording check. Groups of a type the mix sets to 0 are skipped. Chunks are looked up by ID; an unknown ID is invalid_input.
 * With a `ctx` the model calls are logged (`llm.called`) like the answerer's; dropped drafts come back with their reason.
 */
export async function generateQuestionsDetailed(
  llm: Llm,
  chunks: readonly Chunk[],
  groups: readonly { type: GenerationGroup['type']; chunkIds: readonly ChunkId[] }[],
  recipe: MachineRecipeSpec<'eval-generate', GenerateSettings>,
  o: { ctx?: Ctx } = {},
): Promise<Generated> {
  const s = recipe.spec.settings;
  if (recipe.spec.machine !== 'eval-generate' || recipe.spec.topology !== topologyOf(evalGenerateMachine)) {
    throw new KgError('invalid_input', 'the generation recipe does not name this machine and topology');
  }
  const byId = new Map<string, Chunk>(chunks.map((c) => [c.id, c]));
  const origin: number[] = [];
  const work: GenerationGroup[] = [];
  groups.forEach((g, gi) => {
    if (s.mix[g.type] <= 0) return;
    origin.push(gi);
    work.push({
      type: g.type,
      passages: g.chunkIds.map((id): GenerationPassage => {
        const c = byId.get(id);
        if (!c) throw new KgError('invalid_input', `generation group names chunk ${id}, which is not in the given chunks`);
        return { id: c.id, text: c.text, sectionPath: [...c.sectionPath], docKey: c.docKey as DocKey };
      }),
    });
  });
  const out = await settle<GenerateOutput>(evalGenerateMachine, {
    llm: o.ctx ? loggedLlm(llm, o.ctx) : llm,
    groups: work,
    request: (g: GenerationGroup) => generationRequest(g, s),
    retryBudget: s.retryBudget,
  });
  if (out.error) throw out.error;
  return { drafts: out.drafts, dropped: out.dropped.map((d) => ({ ...d, group: origin[d.group]! })), genRecipeId: recipeId(recipe) };
}

/** The drafts of `generateQuestionsDetailed`, for callers that need nothing else. */
export async function generateQuestions(
  llm: Llm,
  chunks: readonly Chunk[],
  groups: readonly { type: GenerationGroup['type']; chunkIds: readonly ChunkId[] }[],
  recipe: MachineRecipeSpec<'eval-generate', GenerateSettings>,
  o: { ctx?: Ctx } = {},
): Promise<QuestionDraft[]> {
  return (await generateQuestionsDetailed(llm, chunks, groups, recipe, o)).drafts;
}

/** The generation recipe for these settings. */
export function generateRecipe(settings: GenerateSettings = GENERATE_SETTINGS): MachineRecipeSpec<'eval-generate', GenerateSettings> {
  return {
    kind: 'eval-generate',
    version: '1',
    spec: { machine: 'eval-generate', settings, topology: topologyOf(evalGenerateMachine), promptDigest: promptDigest(GENERATE_PROMPTS) },
  };
}

export type { QuestionType };
