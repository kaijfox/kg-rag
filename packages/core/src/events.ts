/**
 * Event catalog. Every payload is a strict zod schema; EventLog.append rejects anything else.
 *
 * Envelope rules (checked by validateEventDraft):
 * - BUILD_REQUIRED types need a non-null envelope buildId (Rule 6: an event whose payload names items or
 *   a build-dependent ranking records the build). Whenever a payload has a buildId (build.*, eval.run.started)
 *   it must equal the envelope buildId.
 * - SEARCH_REQUIRED types need a non-null envelope searchId. The search ID lives on the envelope only.
 * - pipeline.started / pipeline.finished: required tags depend on payload.pipeline, see PIPELINE_BUILD_REQUIRED below.
 * - session.started is written only by EventLog.openSession.
 */
import { z } from 'zod';
import { KgError } from './errors';
import type { BuildId, EventId, SearchId, SessionId } from './ids';
import {
  S,
  jsonObjectSchema,
  jsonSchema,
  parseStatsSchema,
  relevanceSchema,
  sessionKindSchema,
  stepTraceSchema,
  itemKindSchema,
  sourceChunkIdsSchema,
  nonNegIntSchema,
  isoTimestampSchema,
  evalJudgeSchema,
  evalAnswererSchema,
} from './schemas';

const errorCodeSchema = z.enum([
  'invalid_input',
  'invalid_event',
  'not_found',
  'immutable_violation',
  'conflict',
  'precondition',
  'upstream',
  'not_implemented',
  'internal',
]);
const ms = z.number().nonnegative();
const pipelineKindSchema = z.enum(['search', 'ingest', 'eval-run', 'eval-generate']);

export const PAYLOADS = {
  'session.started': z.strictObject({ kind: sessionKindSchema, label: z.string().nullable(), meta: jsonObjectSchema }),
  'tool.called': z.strictObject({ tool: z.string().min(1), input: jsonSchema }),
  'tool.returned': z.strictObject({ tool: z.string().min(1), summary: jsonSchema, durationMs: ms }),
  'tool.failed': z.strictObject({
    tool: z.string().min(1),
    error: z.strictObject({ code: errorCodeSchema, message: z.string() }),
    durationMs: ms,
  }),
  'ingest.started': z.strictObject({
    docKey: S.docKey,
    source: z.strictObject({ kind: z.enum(['file', 'artifact']), path: z.string() }),
    sourceSha256: S.sha256,
    /**
     * 0.6.1: the plain parse recipe (without formula decoding) that the parse cache is keyed by, also for imported
     * artifacts and for runs that decode formulas (the decoded artifact is cached under the full recipe).
     */
    parseRecipeId: S.recipeId,
    chunkRecipeId: S.recipeId,
  }),
  'ingest.parsed': z.strictObject({
    docKey: S.docKey,
    artifactId: S.artifactId,
    /** parsed now, found in the store by (sha256, recipe), or imported from an artifact file */
    origin: z.enum(['parsed', 'cache', 'imported']),
    stats: parseStatsSchema,
  }),
  'ingest.chunked': z.strictObject({
    docKey: S.docKey,
    docVersionId: S.docVersionId,
    chunkCount: nonNegIntSchema,
    inserted: nonNegIntSchema,
    reused: nonNegIntSchema,
    dropped: nonNegIntSchema,
  }),
  'ingest.embedded': z.strictObject({
    docKey: S.docKey,
    spaceId: S.spaceId,
    embedded: nonNegIntSchema,
    skipped: nonNegIntSchema,
    elapsedMs: ms,
  }),
  'ingest.completed': z.strictObject({
    docKey: S.docKey,
    docVersionId: S.docVersionId,
    unchanged: z.boolean(),
    /**
     * The document's current version before this ingest (null: none). 0.4.0 (A5/A6): with `docVersionId` it gives the
     * old and new value of the `documents.current_version` pointer. Optional only so logs written before 0.4.0 still
     * validate; every 0.4.0 ingest sets it. Equals `docVersionId` when `unchanged`.
     */
    previousDocVersionId: S.docVersionId.nullable().optional(),
  }),
  'build.created': z.strictObject({
    buildId: S.buildId,
    parentId: S.buildId.nullable(),
    mixedRecipes: z.boolean(),
    itemCount: nonNegIntSchema,
    /**
     * true when the current build moved to a build that already existed (a revert, e.g. re-ingesting old content):
     * `parentId` is then the previous current build, which differs from the stored first-seen `builds.parent_id`.
     * 0.4.0 (A5/A6). Optional (absent = false) so earlier logs validate; 0.4.0 ingest always sets it.
     */
    revert: z.boolean().optional(),
  }),
  'build.labeled': z.strictObject({ buildId: S.buildId, name: z.string().min(1) }),
  'build.stale': z.strictObject({ buildId: S.buildId, missingChunkIds: z.array(S.chunkId) }),
  query: z.strictObject({ query: z.string(), k: z.number().int().positive(), searchRecipeId: S.recipeId }),
  /**
   * 0.5.0: written only by the pipeline runner, first after `query` (search) or after `tool.called` (ingest, eval).
   * `machine`/`version`/`topology` name the machine whose map the viewer draws; `recipeId` is the recipe it runs
   * (null for pipelines that have none, e.g. ingest).
   */
  'pipeline.started': z.strictObject({
    pipeline: pipelineKindSchema,
    machine: z.string().min(1),
    version: z.string().min(1),
    topology: z.string().regex(/^[0-9a-f]{16}$/),
    recipeId: S.recipeId.nullable(),
  }),
  /**
   * 0.5.0: the last pipeline event, before `search.result` or the tool's return. `state` is the final state the
   * machine reached (for a failed run, the state that failed or `failed`); `error` is set when status is failed.
   * 0.6.1: a work state that fails may have logged no step (no `search.step`, no domain event), so `state` can name
   * a state with no visit in the log; readers must not require a step for the failed state.
   */
  'pipeline.finished': z.strictObject({
    pipeline: pipelineKindSchema,
    status: z.enum(['done', 'failed']),
    state: z.string().min(1),
    error: z.strictObject({ code: errorCodeSchema, message: z.string() }).optional(),
  }),
  'search.step': z.strictObject({ trace: stepTraceSchema }),
  'search.result': z.strictObject({
    items: z.array(
      z.strictObject({
        itemId: S.itemId,
        kind: itemKindSchema,
        rank: z.number().int().positive(),
        score: z.number(),
        sourceChunkIds: sourceChunkIdsSchema,
      }),
    ),
    stale: z.boolean(),
  }),
  'items.fetched': z.strictObject({ itemIds: z.array(S.itemId) }),
  feedback: z.strictObject({
    overall: relevanceSchema.nullable(),
    items: z.array(z.strictObject({ itemId: S.itemId, relevance: relevanceSchema })),
    note: z.string().nullable(),
  }),
  usage: z.strictObject({ itemIds: z.array(S.itemId).min(1), account: z.string() }),
  outcome: z.strictObject({ success: z.boolean().nullable(), note: z.string() }),
  'llm.called': z.strictObject({
    purpose: z.string().min(1),
    model: z.string().min(1),
    requestSha256: S.sha256,
    responseSha256: S.sha256,
    inputTokens: nonNegIntSchema,
    outputTokens: nonNegIntSchema,
    durationMs: ms,
  }),
  'eval.run.started': z.strictObject({
    runId: S.evalRunId,
    /** the build the run is pinned to; must equal the envelope buildId */
    buildId: S.buildId,
    evalSetId: S.evalSetId,
    evalSetSha256: S.sha256,
    conditions: z.array(z.string().min(1)).min(1),
    ks: z.array(z.number().int().positive()).min(1),
    /**
     * 0.5.0: search recipe per retrieved condition name, when the run compares several. Absent = every retrieved
     * condition uses the build's default search recipe.
     */
    searchRecipes: z.record(z.string().min(1), S.recipeId).optional(),
    /**
     * 0.6.1 (Rule 4: scores are derived items and name their recipe): the judge and answerer of this run. Optional to
     * parse, so older logs stay valid; always written by the runner.
     */
    judge: evalJudgeSchema.optional(),
    answerer: evalAnswererSchema.optional(),
  }),
  'eval.question.scored': z.strictObject({
    runId: S.evalRunId,
    questionId: z.string().min(1),
    condition: z.string().min(1),
    recall: z.record(z.string(), z.number().min(0).max(1)).nullable(),
    judgeScore: z.number().min(0).max(1).nullable(),
  }),
  'eval.run.completed': z.strictObject({ runId: S.evalRunId, summary: jsonSchema }),
} as const;

export type EventType = keyof typeof PAYLOADS;
export const EVENT_TYPES = Object.keys(PAYLOADS) as EventType[];
export type EventPayloads = { [T in EventType]: z.infer<(typeof PAYLOADS)[T]> };

export const BUILD_REQUIRED: ReadonlySet<EventType> = new Set<EventType>([
  'build.created',
  'build.labeled',
  'build.stale',
  'query',
  'search.step',
  'search.result',
  'items.fetched',
  'feedback',
  'usage',
  'eval.run.started',
  'eval.question.scored',
  'eval.run.completed',
]);
export const SEARCH_REQUIRED: ReadonlySet<EventType> = new Set<EventType>([
  'query',
  'search.step',
  'search.result',
  'feedback',
  'usage',
]);

interface DraftBase {
  sessionId: SessionId;
  buildId: BuildId | null;
  searchId: SearchId | null;
  /** the tool.called event that caused this one; for tool.called: the enclosing tool.called of the same session (nested call) or null */
  parentId: EventId | null;
}
interface EnvelopeBase extends DraftBase {
  id: EventId;
  /** per session, contiguous from 1 */
  seq: number;
  ts: string;
  schemaVersion: 1;
}
export type EventDraft<T extends EventType = EventType> = {
  [K in T]: DraftBase & { type: K; payload: EventPayloads[K] };
}[T];
export type EventEnvelope<T extends EventType = EventType> = {
  [K in T]: EnvelopeBase & { type: K; payload: EventPayloads[K] };
}[T];

const draftBaseShape = {
  sessionId: S.sessionId,
  buildId: S.buildId.nullable(),
  searchId: S.searchId.nullable(),
  parentId: S.eventId.nullable(),
};

/**
 * pipeline.started / pipeline.finished envelope rules (0.5.0), decided by payload.pipeline:
 * - search: buildId and searchId both required (the search is pinned to a build and has a search id);
 * - eval-run: buildId required (the run is pinned to a build); searchId not required;
 * - ingest, eval-generate: buildId and searchId both optional (the first ingest runs before any build exists;
 *   eval-set generation is not build-pinned).
 */
const PIPELINE_BUILD_REQUIRED: ReadonlySet<string> = new Set(['search', 'eval-run']);

function envelopeRules(e: { type: EventType; buildId: string | null; searchId: string | null; payload: unknown }, ctx: z.RefinementCtx): void {
  if (BUILD_REQUIRED.has(e.type) && e.buildId === null) {
    ctx.addIssue({ code: 'custom', path: ['buildId'], message: `Rule 6: ${e.type} requires a buildId` });
  }
  if (e.type === 'pipeline.started' || e.type === 'pipeline.finished') {
    const kind = (e.payload as { pipeline?: string } | null)?.pipeline ?? '';
    if (PIPELINE_BUILD_REQUIRED.has(kind) && e.buildId === null) {
      ctx.addIssue({ code: 'custom', path: ['buildId'], message: `${e.type} for a ${kind} pipeline requires a buildId` });
    }
    if (kind === 'search' && e.searchId === null) {
      ctx.addIssue({ code: 'custom', path: ['searchId'], message: `${e.type} for a search pipeline requires a searchId` });
    }
  }
  const pb = (e.payload as { buildId?: string } | null)?.buildId;
  if (pb !== undefined && pb !== e.buildId) {
    ctx.addIssue({ code: 'custom', path: ['buildId'], message: `${e.type}: envelope buildId must equal payload.buildId` });
  }
  if (SEARCH_REQUIRED.has(e.type) && e.searchId === null) {
    ctx.addIssue({ code: 'custom', path: ['searchId'], message: `${e.type} requires a searchId` });
  }
}

const draftVariants = EVENT_TYPES.map((t) => z.strictObject({ ...draftBaseShape, type: z.literal(t), payload: PAYLOADS[t] }));
export const eventDraftSchema = z
  .discriminatedUnion('type', draftVariants as unknown as [(typeof draftVariants)[number], ...(typeof draftVariants)[number][]])
  .superRefine((e, ctx) => envelopeRules(e as never, ctx));

const envelopeVariants = EVENT_TYPES.map((t) =>
  z.strictObject({
    ...draftBaseShape,
    id: S.eventId,
    seq: z.number().int().positive(),
    ts: isoTimestampSchema,
    schemaVersion: z.literal(1),
    type: z.literal(t),
    payload: PAYLOADS[t],
  }),
);
export const eventEnvelopeSchema = z
  .discriminatedUnion(
    'type',
    envelopeVariants as unknown as [(typeof envelopeVariants)[number], ...(typeof envelopeVariants)[number][]],
  )
  .superRefine((e, ctx) => envelopeRules(e as never, ctx));

function fail(what: string, err: z.ZodError): never {
  const msg = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  throw new KgError('invalid_event', `${what}: ${msg}`);
}

/** Throws KgError('invalid_event') unless d is a valid draft. Rejects session.started (openSession only). */
export function validateEventDraft(d: unknown): EventDraft {
  const r = eventDraftSchema.safeParse(d);
  if (!r.success) fail('invalid event draft', r.error);
  if (r.data.type === 'session.started') throw new KgError('invalid_event', 'session.started is written only by openSession');
  return r.data as EventDraft;
}

/** Validates a stored or recorded envelope (fixtures, JSONL logs). */
export function validateEventEnvelope(e: unknown): EventEnvelope {
  const r = eventEnvelopeSchema.safeParse(e);
  if (!r.success) fail('invalid event envelope', r.error);
  return r.data as EventEnvelope;
}
