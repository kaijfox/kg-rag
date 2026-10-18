import { KgError, type JudgeVerdict, type Llm, type LlmRequest } from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import { parseJudgeReply } from '../prompts/parse';
import { retryRequest } from './retry';

export interface JudgeInput {
  llm: Llm;
  request: LlmRequest;
  /** malformed replies that are asked again before the run fails */
  retryBudget: number;
}

export interface JudgeContext {
  input: JudgeInput;
  retries: number;
  /** the malformed replies so far; each is shown to the model again with a corrective instruction */
  history: string[];
  raw: string | null;
  verdict: JudgeVerdict | null;
  error: KgError | null;
}

export interface JudgeOutput {
  verdict: JudgeVerdict | null;
  error: KgError | null;
}

/** The parse error of a reply, or null when the reply is a valid judge reply. */
export function replyError(raw: string | null): KgError | null {
  if (raw === null) return null;
  try {
    parseJudgeReply(raw);
    return null;
  } catch (e) {
    return e instanceof KgError ? e : new KgError('internal', String(e));
  }
}

const call = loggedActor(['llm.called'], async ({ llm, request }: { llm: Llm; request: LlmRequest }) => (await llm.complete(request)).text);

/** Judge: ask the model for a score, parse it strictly, and ask again (up to the retry budget) when the reply is malformed. */
export const judgeMachine = setup({
  types: {
    context: {} as JudgeContext,
    input: {} as JudgeInput,
    output: {} as JudgeOutput,
  },
  actors: { call },
  guards: {
    malformed: ({ context }) => replyError(context.raw) !== null,
    retryAllowed: ({ context }) => replyError(context.raw) !== null && context.retries < context.input.retryBudget,
  },
}).createMachine({
  id: 'judge',
  context: ({ input }) => ({ input, retries: 0, history: [], raw: null, verdict: null, error: null }),
  initial: 'calling',
  output: ({ context }) => ({ verdict: context.verdict, error: context.error }),
  states: {
    calling: {
      meta: { logs: 'llm.called', step: 'judge-call', label: 'ask the judge' },
      invoke: {
        src: 'call',
        input: ({ context }) => ({ llm: context.input.llm, request: retryRequest(context.input.request, context.history) }),
        onDone: { target: 'parsing', actions: assign({ raw: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    parsing: {
      meta: { routing: true },
      always: [
        { guard: 'retryAllowed', target: 'calling', actions: assign({ retries: ({ context }) => context.retries + 1, history: ({ context }) => [...context.history, context.raw!] }) },
        { guard: 'malformed', target: '#failed', actions: assign({ error: ({ context }) => replyError(context.raw) }) },
        { target: 'done', actions: assign({ verdict: ({ context }) => ({ ...parseJudgeReply(context.raw!), raw: context.raw! }) as JudgeVerdict }) },
      ],
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});
