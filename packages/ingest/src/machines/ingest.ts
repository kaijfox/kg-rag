import { KgError, type Ctx, type IngestReport, type ItemId } from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import type { IngestDeps, Vector } from '../deps';
import { commitIngest, embedOtherDocuments, ensureConfig, type DocEntry, type DocPlan } from '../steps';
import { documentMachine, type DocOutput } from './document';

export interface IngestInput {
  ctx: Ctx;
  deps: IngestDeps;
  entries: DocEntry[];
}

export interface IngestContext {
  input: IngestInput;
  plans: DocPlan[];
  extraVectors: Vector[];
  unembedded: ItemId[];
  report: IngestReport | null;
  error: KgError | null;
}

const embedOthers = loggedActor(['ingest.embedded'], ({ ctx, deps, plans }: { ctx: Ctx; deps: IngestDeps; plans: DocPlan[] }) =>
  embedOtherDocuments(ctx, deps, plans),
);
const commit = loggedActor(['ingest.completed', 'build.created'], ({ ctx, deps, plans, vectors }: { ctx: Ctx; deps: IngestDeps; plans: DocPlan[]; vectors: Vector[] }) =>
  Promise.resolve(commitIngest(ctx, deps, plans, vectors)),
);

export const ingestMachine = setup({
  types: {
    context: {} as IngestContext,
    input: {} as IngestInput,
    output: {} as IngestReport,
  },
  actors: { document: documentMachine, embedOthers, commit },
  guards: {
    spaceMismatch: ({ context }) =>
      context.input.deps.embedder.model !== context.input.deps.config.space.model || context.input.deps.embedder.dims !== context.input.deps.config.space.dims,
    hasDocument: ({ context }) => context.plans.length < context.input.entries.length,
    documentFailed: ({ event }) => (event as unknown as { output: DocOutput }).output.error !== null,
    unembeddedLeft: ({ context }) => context.unembedded.length > 0,
  },
}).createMachine({
  id: 'ingest',
  context: ({ input }) => ({ input, plans: [], extraVectors: [], unembedded: [], report: null, error: null }),
  initial: 'preparing',
  output: ({ context }) => context.report!,
  states: {
    preparing: {
      meta: { routing: true },
      always: [
        { guard: 'spaceMismatch', target: '#failed', actions: assign({ error: () => new KgError('precondition', 'the embedder does not serve the database space (model or dims differ)') }) },
        { target: 'nextDocument', actions: ({ context }) => ensureConfig(context.input.deps) },
      ],
    },
    nextDocument: {
      meta: { routing: true },
      always: [{ guard: 'hasDocument', target: 'document' }, { target: 'extras' }],
    },
    document: {
      meta: { logs: 'ingest.started ingest.parsed ingest.chunked ingest.embedded', step: 'document', label: 'run one document' },
      invoke: {
        src: 'document',
        input: ({ context }) => ({
          ctx: context.input.ctx,
          deps: context.input.deps,
          entry: context.input.entries[context.plans.length]!,
          seen: context.plans.map((p) => p.docKey),
        }),
        onDone: [
          {
            guard: 'documentFailed',
            target: '#failed',
            actions: assign({ error: ({ event }) => (event.output as DocOutput).error! }),
          },
          {
            target: 'nextDocument',
            actions: assign({ plans: ({ context, event }) => [...context.plans, (event.output as DocOutput).plan!] }),
          },
        ],
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    extras: {
      meta: { logs: 'ingest.embedded', step: 'embed-others', label: 'embed other documents that lack vectors' },
      invoke: {
        src: 'embedOthers',
        input: ({ context }) => ({ ctx: context.input.ctx, deps: context.input.deps, plans: context.plans }),
        onDone: {
          target: 'gate',
          actions: assign({
            extraVectors: ({ event }) => event.output.vectors,
            unembedded: ({ event }) => event.output.unembedded,
          }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    gate: {
      meta: { routing: true },
      always: [
        {
          guard: 'unembeddedLeft',
          target: '#failed',
          actions: assign({ error: ({ context }) => new KgError('precondition', `${context.unembedded.length} chunks of the new build have no vector in the space`) }),
        },
        { target: 'committing' },
      ],
    },
    committing: {
      meta: { logs: 'ingest.completed build.created', step: 'commit', label: 'commit the documents and the build' },
      invoke: {
        src: 'commit',
        input: ({ context }) => ({
          ctx: context.input.ctx,
          deps: context.input.deps,
          plans: context.plans,
          vectors: [...context.plans.flatMap((p) => p.vectors), ...context.extraVectors],
        }),
        onDone: { target: 'done', actions: assign({ report: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});

