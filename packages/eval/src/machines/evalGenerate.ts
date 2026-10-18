import { KgError, type ChunkId, type DocKey, type LlmRequest, type Llm, type QuestionDraft, type QuestionType } from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import { parseGenerationReply, type GeneratedQuestion } from '../prompts/parse';
import { retryRequest } from './retry';

export interface GenerationPassage {
  id: ChunkId;
  text: string;
  sectionPath: string[];
  docKey: DocKey;
}
/** One prompt's worth of passages: linked chunks for multi-hop, one chunk for single-hop, one section for topic. */
export interface GenerationGroup {
  type: Exclude<QuestionType, 'exact-term'>;
  passages: GenerationPassage[];
}

export interface GenerateInput {
  llm: Llm;
  groups: GenerationGroup[];
  /** the request for one group (the prompt is built by the caller from the settings) */
  request: (group: GenerationGroup) => LlmRequest;
  retryBudget: number;
}

export interface GenerateContext {
  input: GenerateInput;
  index: number;
  retries: number;
  /** the malformed replies for the current group, shown to the model again with a corrective instruction */
  history: string[];
  raw: string | null;
  drafts: QuestionDraft[];
  dropped: DroppedDraft[];
  error: KgError | null;
}

/** A draft the dedupe or wording check refused, with the index in `groups` of the group that produced it. */
export interface DroppedDraft {
  group: number;
  reason: 'duplicate' | 'wording-copy';
  question: string;
}

export interface GenerateOutput {
  drafts: QuestionDraft[];
  dropped: DroppedDraft[];
  error: KgError | null;
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
const PHRASE = 4;

function phrases(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + PHRASE <= w.length; i++) out.add(w.slice(i, i + PHRASE).join(' '));
  return out;
}

/** True when the question copies a run of more than three consecutive words of one of the passages. */
export function reusesWording(question: string, passages: readonly string[]): boolean {
  const q = phrases(question);
  return passages.some((p) => [...phrases(p)].some((ph) => q.has(ph)));
}

const normalizedQuestion = (q: string): string => words(q).join(' ');

/** The drafts of one parsed reply: gold = the passages each question uses, sorted by chunk id. */
export function toDrafts(group: GenerationGroup, parsed: readonly GeneratedQuestion[]): QuestionDraft[] {
  return parsed.map((g) => {
    const used = g.uses.map((u) => group.passages[u]!);
    const sorted = [...used].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      type: group.type,
      question: g.question,
      referenceAnswer: g.referenceAnswer,
      goldChunkIds: sorted.map((p) => p.id),
      goldText: sorted.map((p) => p.text),
      sourceDocKeys: [...new Set<DocKey>(sorted.map((p) => p.docKey))].sort(),
    };
  });
}

/** Splits incoming drafts into those accepted (after `accepted`) and those dropped: a repeated question or copied passage wording. */
export function sortDrafts(
  accepted: readonly QuestionDraft[],
  incoming: readonly QuestionDraft[],
  group = 0,
): { accepted: QuestionDraft[]; dropped: DroppedDraft[] } {
  const seen = new Set(accepted.map((d) => normalizedQuestion(d.question)));
  const out = [...accepted];
  const dropped: DroppedDraft[] = [];
  for (const d of incoming) {
    const key = normalizedQuestion(d.question);
    if (seen.has(key)) dropped.push({ group, reason: 'duplicate', question: d.question });
    else if (reusesWording(d.question, d.goldText)) dropped.push({ group, reason: 'wording-copy', question: d.question });
    else {
      seen.add(key);
      out.push(d);
    }
  }
  return { accepted: out, dropped };
}

/** Drops drafts whose question repeats an accepted question, or copies passage wording of its own gold passages. */
export function acceptDrafts(accepted: readonly QuestionDraft[], incoming: readonly QuestionDraft[]): QuestionDraft[] {
  return sortDrafts(accepted, incoming).accepted;
}

/** The parse error of the current reply, or null. */
function generationError(c: GenerateContext): KgError | null {
  if (c.raw === null) return null;
  const group = c.input.groups[c.index]!;
  try {
    parseGenerationReply(c.raw, group.type, group.passages.length);
    return null;
  } catch (e) {
    return e instanceof KgError ? e : new KgError('internal', String(e));
  }
}

/** The current reply parsed, split into accepted drafts and dropped ones. */
function sortedOf(c: GenerateContext) {
  const group = c.input.groups[c.index]!;
  const parsed = parseGenerationReply(c.raw!, group.type, group.passages.length);
  return sortDrafts(c.drafts, toDrafts(group, parsed), c.index);
}

const generate = loggedActor(['llm.called'], async ({ llm, request }: { llm: Llm; request: LlmRequest }) => (await llm.complete(request)).text);

/** Question generation: one prompt per group, strict parsing with retries, then dedupe and wording checks. */
export const evalGenerateMachine = setup({
  types: {
    context: {} as GenerateContext,
    input: {} as GenerateInput,
    output: {} as GenerateOutput,
  },
  actors: { generate },
  guards: {
    hasGroup: ({ context }) => context.index < context.input.groups.length,
    malformed: ({ context }) => generationError(context) !== null,
    retryAllowed: ({ context }) => generationError(context) !== null && context.retries < context.input.retryBudget,
  },
}).createMachine({
  id: 'eval-generate',
  context: ({ input }) => ({ input, index: 0, retries: 0, history: [], raw: null, drafts: [], dropped: [], error: null }),
  initial: 'selecting',
  output: ({ context }) => ({ drafts: context.drafts, dropped: context.dropped, error: context.error }),
  states: {
    selecting: {
      meta: { routing: true },
      always: [{ guard: 'hasGroup', target: 'generating', actions: assign({ retries: 0, history: [], raw: null }) }, { target: 'done' }],
    },
    generating: {
      meta: { logs: 'llm.called', step: 'generate', label: 'ask the generator for questions about one group' },
      invoke: {
        src: 'generate',
        input: ({ context }) => ({ llm: context.input.llm, request: retryRequest(context.input.request(context.input.groups[context.index]!), context.history) }),
        onDone: { target: 'parsing', actions: assign({ raw: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    parsing: {
      meta: { routing: true },
      always: [
        { guard: 'retryAllowed', target: 'generating', actions: assign({ retries: ({ context }) => context.retries + 1, history: ({ context }) => [...context.history, context.raw!] }) },
        { guard: 'malformed', target: '#failed', actions: assign({ error: ({ context }) => generationError(context) }) },
        { target: 'validating' },
      ],
    },
    validating: {
      meta: { routing: true },
      always: [
        {
          target: 'selecting',
          actions: assign({
            drafts: ({ context }) => sortedOf(context).accepted,
            dropped: ({ context }) => [...context.dropped, ...sortedOf(context).dropped],
            index: ({ context }) => context.index + 1,
          }),
        },
      ],
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});
