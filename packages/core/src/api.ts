/**
 * KgApi: the tool contract. MCP exposes TOOLS one to one; eval calls the same KgApi with a session of
 * kind 'eval', so agent and eval traffic write identical events.
 */
import { z } from 'zod';
import type { BuildId, EventId, ItemId, SearchId, SessionId } from './ids';
import type { AnyItem, Json, JsonObject, Relevance, SearchResponse, SessionKind, StaleReport } from './model';
import type { SearchRequest } from './ports/search';
import type { IngestReport, IngestRequest } from './ports/ingest';
import { S, anyItemSchema, jsonObjectSchema, relevanceSchema, searchResponseSchema, sessionKindSchema } from './schemas';

export interface FeedbackRequest {
  searchId: SearchId;
  /** relevance of the result list as a whole */
  overall?: Relevance;
  /** per-item relevance; each itemId must be among the search's results */
  items?: { itemId: ItemId; relevance: Relevance }[];
  note?: string;
}

export interface KgApi {
  /** Not a tool: opens a session (EventLog.openSession writes session.started). */
  openSession(r: { kind: SessionKind; label?: string; meta?: JsonObject }): Promise<{ sessionId: SessionId }>;
  search(s: SessionId, r: SearchRequest): Promise<SearchResponse>;
  /**
   * Items by ID, restricted to members of the build (r.buildId, default the current build): non-members and
   * unknown IDs are omitted; an unknown build is not_found. items.fetched records the requested IDs and that build.
   */
  getItems(s: SessionId, r: { itemIds: ItemId[]; buildId?: BuildId }): Promise<{ items: AnyItem[] }>;
  /** Rule 6: the feedback event carries the build of the referenced search. not_found on unknown searchId. */
  feedback(s: SessionId, r: FeedbackRequest): Promise<{ eventId: EventId }>;
  reportUsage(s: SessionId, r: { searchId: SearchId; itemIds: ItemId[]; account: string }): Promise<{ eventId: EventId }>;
  reportOutcome(s: SessionId, r: { searchId?: SearchId; success: boolean | null; note: string }): Promise<{ eventId: EventId }>;
  ingest(s: SessionId, r: IngestRequest): Promise<IngestReport>;
  /** Labels the current build with an insert-only name and reports staleness (build.labeled, build.stale if stale). */
  snapshotBuild(s: SessionId, r: { name: string }): Promise<{ buildId: BuildId; stale: StaleReport }>;
  addNote(s: SessionId, r: { text: string }): Promise<{ noteId: number }>;
}

export type ToolName = Exclude<keyof KgApi, 'openSession'>;
export type ToolInput<K extends ToolName> = Parameters<KgApi[K]>[1];
export type ToolOutput<K extends ToolName> = Awaited<ReturnType<KgApi[K]>>;

export interface ToolDef<I, O> {
  /** MCP tool name */
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** what tool.returned records; small, never the full output */
  summarize(o: O): Json;
}

const staleReportSchema: z.ZodType<StaleReport> = z.strictObject({
  buildId: S.buildId,
  missingChunkIds: z.array(S.chunkId),
  stale: z.boolean(),
});
const pathRef = z.strictObject({ path: z.string().min(1), docKey: z.string().min(1).optional() });
const ingestRequestSchema: z.ZodType<IngestRequest> = z
  .strictObject({ sources: z.array(pathRef).min(1).optional(), artifacts: z.array(pathRef).min(1).optional() })
  .refine((r) => (r.sources === undefined) !== (r.artifacts === undefined), {
    message: 'give exactly one of sources or artifacts',
  });
const ingestReportSchema: z.ZodType<IngestReport> = z.strictObject({
  docs: z.array(
    z.strictObject({
      docKey: S.docKey,
      docVersionId: S.docVersionId,
      unchanged: z.boolean(),
      inserted: z.number().int().nonnegative(),
      reused: z.number().int().nonnegative(),
      dropped: z.number().int().nonnegative(),
    }),
  ),
  buildId: S.buildId,
  buildChanged: z.boolean(),
});
const eventIdOut = z.strictObject({ eventId: S.eventId });

export const MAX_K = 100;

export const TOOLS: { [K in ToolName]: ToolDef<ToolInput<K>, ToolOutput<K>> } = {
  search: {
    name: 'search',
    description: 'Similarity search over the current build. Returns ranked items with source chunk IDs and a searchId for feedback.',
    input: z.strictObject({
      query: z.string().min(1),
      k: z.number().int().min(1).max(MAX_K),
      searchRecipeId: S.recipeId.optional(),
      buildId: S.buildId.optional(),
    }),
    output: searchResponseSchema,
    summarize: (o) => ({ searchId: o.searchId, buildId: o.buildId, n: o.items.length, top: o.items.slice(0, 3).map((i) => i.itemId) }),
  },
  getItems: {
    name: 'get_items',
    description: 'Fetch items (chunks, later relations and summaries) by ID.',
    input: z.strictObject({ itemIds: z.array(S.itemId).min(1).max(MAX_K), buildId: S.buildId.optional() }),
    output: z.strictObject({ items: z.array(anyItemSchema) }),
    summarize: (o) => ({ n: o.items.length }),
  },
  feedback: {
    name: 'feedback',
    description: 'Rate a search: overall and/or per item, 0 = not relevant, 1 = partly, 2 = relevant, with an optional note.',
    input: z
      .strictObject({
        searchId: S.searchId,
        overall: relevanceSchema.optional(),
        items: z.array(z.strictObject({ itemId: S.itemId, relevance: relevanceSchema })).min(1).optional(),
        note: z.string().optional(),
      })
      .refine((r) => r.overall !== undefined || r.items !== undefined, { message: 'give overall and/or items' }),
    output: eventIdOut,
    summarize: (o) => ({ eventId: o.eventId }),
  },
  reportUsage: {
    name: 'report_usage',
    description: "Report which items of a search were used and how (the agent's post hoc account).",
    input: z.strictObject({ searchId: S.searchId, itemIds: z.array(S.itemId).min(1), account: z.string() }),
    output: eventIdOut,
    summarize: (o) => ({ eventId: o.eventId }),
  },
  reportOutcome: {
    name: 'report_outcome',
    description: 'Report whether the solution that used retrieved information worked.',
    input: z.strictObject({ searchId: S.searchId.optional(), success: z.boolean().nullable(), note: z.string() }),
    output: eventIdOut,
    summarize: (o) => ({ eventId: o.eventId }),
  },
  ingest: {
    name: 'ingest',
    description: 'Ingest source files (parsed with the database parse recipe) or parse artifacts produced elsewhere.',
    input: ingestRequestSchema,
    output: ingestReportSchema,
    summarize: (o) => ({ buildId: o.buildId, buildChanged: o.buildChanged, docs: o.docs.length }),
  },
  snapshotBuild: {
    name: 'snapshot_build',
    description: 'Give the current build a permanent name and report whether it is stale.',
    input: z.strictObject({ name: z.string().min(1).max(200) }),
    output: z.strictObject({ buildId: S.buildId, stale: staleReportSchema }),
    summarize: (o) => ({ buildId: o.buildId, stale: o.stale.stale }),
  },
  addNote: {
    name: 'add_note',
    description: 'Attach a free-text note to the current session.',
    input: z.strictObject({ text: z.string().min(1) }),
    output: z.strictObject({ noteId: z.number().int().positive() }),
    summarize: (o) => ({ noteId: o.noteId }),
  },
};

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export const openSessionSchema = z.strictObject({
  kind: sessionKindSchema,
  label: z.string().optional(),
  meta: jsonObjectSchema.optional(),
});
