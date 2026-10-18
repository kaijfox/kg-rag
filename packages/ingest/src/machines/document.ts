import { KgError, type ArtifactId, type DocKey, type ParseArtifact } from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import type { IngestDeps, Vector } from '../deps';
import { needsDecoding } from '../deps';
import {
  chunkDocument,
  decodeFormulas,
  embedDocument,
  importArtifact,
  identifySource,
  loadCached,
  parseSource,
  type DocEntry,
  type DocPlan,
} from '../steps';

export interface DocInput {
  ctx: import('@kg/core').Ctx;
  deps: IngestDeps;
  entry: DocEntry;
  /** docKeys already processed by this request */
  seen: readonly DocKey[];
}

export interface DocContext {
  input: DocInput;
  docKey: DocKey | null;
  sha256: string | null;
  cached: ArtifactId | null;
  artifact: ParseArtifact | null;
  artifactId: ArtifactId | null;
  plan: DocPlan | null;
  error: KgError | null;
}

export interface DocOutput {
  plan: DocPlan | null;
  error: KgError | null;
}

const identify = loggedActor(['ingest.started'], ({ doc }: { doc: DocInput }) => identifySource(doc.ctx, doc.deps, doc.entry));
const importFile = loggedActor(['ingest.started', 'ingest.parsed'], ({ doc }: { doc: DocInput }) => importArtifact(doc.ctx, doc.deps, doc.entry));
const loadArtifact = loggedActor(['ingest.parsed'], ({ doc, docKey, artifactId }: { doc: DocInput; docKey: DocKey; artifactId: ArtifactId }) =>
  Promise.resolve(loadCached(doc.ctx, doc.deps, docKey, artifactId)),
);
const parse = loggedActor(['ingest.parsed'], ({ doc, docKey, sha256 }: { doc: DocInput; docKey: DocKey; sha256: string }) =>
  parseSource(doc.ctx, doc.deps, doc.entry, docKey, sha256),
);
const decode = loggedActor(['ingest.parsed'], ({ doc, docKey, artifact }: { doc: DocInput; docKey: DocKey; artifact: ParseArtifact }) =>
  decodeFormulas(doc.ctx, doc.deps, doc.entry, docKey, artifact),
);
const chunk = loggedActor(['ingest.chunked'], ({ doc, docKey, artifact, artifactId }: { doc: DocInput; docKey: DocKey; artifact: ParseArtifact; artifactId: ArtifactId }) =>
  Promise.resolve(chunkDocument(doc.ctx, doc.deps, docKey, artifact, artifactId)),
);
const embed = loggedActor(['ingest.embedded'], ({ doc, plan, artifact }: { doc: DocInput; plan: DocPlan; artifact: ParseArtifact }): Promise<Vector[]> =>
  embedDocument(doc.ctx, doc.deps, plan, artifact),
);


export const documentMachine = setup({
  types: {
    context: {} as DocContext,
    input: {} as DocInput,
    output: {} as DocOutput,
  },
  actors: { identify, importFile, loadArtifact, parse, decode, chunk, embed },
  guards: {
    isFile: ({ context }) => context.input.entry.kind === 'file',
    duplicate: ({ context }) => context.docKey !== null && context.input.seen.includes(context.docKey),
    cached: ({ context }) => context.cached !== null,
    needsDecoding: ({ context }) => context.artifact !== null && needsDecoding(context.input.deps.config, context.artifact),
  },
}).createMachine({
  id: 'document',
  context: ({ input }) => ({ input, docKey: null, sha256: null, cached: null, artifact: null, artifactId: null, plan: null, error: null }),
  initial: 'route',
  output: ({ context }) => ({ plan: context.plan, error: context.error }),
  states: {
    route: {
      meta: { routing: true },
      always: [{ guard: 'isFile', target: 'identifying' }, { target: 'importing' }],
    },
    identifying: {
      meta: { logs: 'ingest.started', step: 'identify', label: 'hash the source, find its cached artifact' },
      invoke: {
        src: 'identify',
        input: ({ context }) => ({ doc: context.input }),
        onDone: {
          target: 'checkDuplicate',
          actions: assign({
            docKey: ({ event }) => event.output.docKey,
            sha256: ({ event }) => event.output.sha256,
            cached: ({ event }) => event.output.cached,
          }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    importing: {
      meta: { logs: 'ingest.started ingest.parsed', step: 'read-artifact', label: 'read a parse artifact file' },
      invoke: {
        src: 'importFile',
        input: ({ context }) => ({ doc: context.input }),
        onDone: {
          target: 'checkDuplicate',
          actions: assign({
            docKey: ({ event }) => event.output.docKey,
            sha256: ({ event }) => event.output.sha256,
            artifact: ({ event }) => event.output.artifact,
            artifactId: ({ event }) => event.output.artifactId,
          }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    checkDuplicate: {
      meta: { routing: true },
      always: [
        { guard: 'duplicate', target: '#failed', actions: assign({ error: ({ context }) => new KgError('invalid_input', `docKey ${context.docKey} is named twice in one request`) }) },
        { guard: 'isFile', target: 'lookup' },
        { target: 'afterParse' },
      ],
    },
    lookup: {
      meta: { routing: true },
      always: [{ guard: 'cached', target: 'reading' }, { target: 'parsing' }],
    },
    reading: {
      meta: { logs: 'ingest.parsed', step: 'load-artifact', label: 'load the cached parse artifact' },
      invoke: {
        src: 'loadArtifact',
        input: ({ context }) => ({ doc: context.input, docKey: context.docKey!, artifactId: context.cached! }),
        onDone: {
          target: 'afterParse',
          actions: assign({ artifact: ({ event }) => event.output.artifact, artifactId: ({ event }) => event.output.artifactId }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    parsing: {
      meta: { logs: 'ingest.parsed', step: 'parse', label: 'parse the source file' },
      invoke: {
        src: 'parse',
        input: ({ context }) => ({ doc: context.input, docKey: context.docKey!, sha256: context.sha256! }),
        onDone: {
          target: 'afterParse',
          actions: assign({ artifact: ({ event }) => event.output.artifact, artifactId: ({ event }) => event.output.artifactId }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    afterParse: {
      meta: { routing: true },
      always: [{ guard: 'needsDecoding', target: 'decoding' }, { target: 'chunking' }],
    },
    decoding: {
      meta: { logs: 'ingest.parsed', step: 'decode-formulas', label: 'decode display formulas' },
      invoke: {
        src: 'decode',
        input: ({ context }) => ({ doc: context.input, docKey: context.docKey!, artifact: context.artifact! }),
        onDone: {
          target: 'chunking',
          actions: assign({ artifact: ({ event }) => event.output.artifact, artifactId: ({ event }) => event.output.artifactId }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    chunking: {
      meta: { logs: 'ingest.chunked', step: 'chunk', label: 'chunk the artifact and count the changes' },
      invoke: {
        src: 'chunk',
        input: ({ context }) => ({ doc: context.input, docKey: context.docKey!, artifact: context.artifact!, artifactId: context.artifactId! }),
        onDone: { target: 'embedding', actions: assign({ plan: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    embedding: {
      meta: { logs: 'ingest.embedded', step: 'embed', label: 'embed the chunks that lack a vector' },
      invoke: {
        src: 'embed',
        input: ({ context }) => ({ doc: context.input, plan: context.plan!, artifact: context.artifact! }),
        onDone: { target: 'done', actions: assign({ plan: ({ context, event }) => ({ ...context.plan!, vectors: event.output }) }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    done: { type: 'final' },
    failed: {
      id: 'failed',
      type: 'final',
    },
  },
});
