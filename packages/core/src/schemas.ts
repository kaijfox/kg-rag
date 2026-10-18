/**
 * zod schemas for shared values. Each schema is typed against its TS type so they cannot drift.
 * IDs are validated by regex at runtime and typed as their brand.
 */
import { z } from 'zod';
import { ID_PATTERNS } from './ids';
import type {
  ArtifactId,
  BuildId,
  ChunkId,
  DerivedItemId,
  DocKey,
  DocVersionId,
  EventId,
  EvalRunId,
  EvalSetId,
  ItemId,
  NodeId,
  RecipeId,
  RunId,
  SearchId,
  SessionId,
  SpaceId,
} from './ids';
import type {
  AnyItem,
  Chunk,
  EmbeddingSpaceSpec,
  FormulaDecodingSpec,
  Json,
  JsonObject,
  ParseArtifact,
  MachineMap,
  ParseRecipeSpec,
  ParseStats,
  RecipeSpec,
  Relation,
  SearchRecipeSpec,
  SearchResponse,
  SearchResult,
  Summary,
  EvalQuestion,
  EvalSet,
} from './model';
import type { QueryVariant, Seed, StepTrace } from './ports/search';
import type { RankedRef } from './scoring';

const idOf = <T extends string>(re: RegExp, what: string) =>
  z.string().regex(re, { message: `not a ${what} id` }) as unknown as z.ZodType<T, string>;

export const S = {
  chunkId: idOf<ChunkId>(ID_PATTERNS.chunk, 'chunk'),
  derivedItemId: idOf<DerivedItemId>(ID_PATTERNS.derivedItem, 'derived item'),
  itemId: idOf<ItemId>(ID_PATTERNS.item, 'item'),
  nodeId: idOf<NodeId>(ID_PATTERNS.node, 'node'),
  recipeId: idOf<RecipeId>(ID_PATTERNS.recipe, 'recipe'),
  buildId: idOf<BuildId>(ID_PATTERNS.build, 'build'),
  docVersionId: idOf<DocVersionId>(ID_PATTERNS.docVersion, 'doc version'),
  artifactId: idOf<ArtifactId>(ID_PATTERNS.artifact, 'artifact'),
  spaceId: idOf<SpaceId>(ID_PATTERNS.space, 'space'),
  evalSetId: idOf<EvalSetId>(ID_PATTERNS.evalSet, 'eval set'),
  sessionId: idOf<SessionId>(ID_PATTERNS.session, 'session'),
  searchId: idOf<SearchId>(ID_PATTERNS.search, 'search'),
  eventId: idOf<EventId>(ID_PATTERNS.event, 'event'),
  runId: idOf<RunId>(ID_PATTERNS.run, 'run'),
  evalRunId: idOf<EvalRunId>(ID_PATTERNS.evalRun, 'eval run'),
  docKey: idOf<DocKey>(ID_PATTERNS.docKey, 'docKey'),
  sha256: z.string().regex(ID_PATTERNS.sha256, { message: 'not a sha256 hex digest' }),
};

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonSchema);

const nonNegInt = z.number().int().nonnegative();
const isoTs = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, { message: 'not an ISO-8601 UTC timestamp' });
export const isoTimestampSchema = isoTs;

/** sorted ascending (JS string order), unique, non-empty */
export const sourceChunkIdsSchema = z
  .array(S.chunkId)
  .min(1, { message: 'Rule 1: sourceChunkIds must be non-empty' })
  .refine((a) => a.every((x, i) => i === 0 || a[i - 1]! < x), { message: 'sourceChunkIds must be sorted and unique' });

export const itemKindSchema = z.enum(['chunk', 'relation', 'summary']);

export const chunkSchema: z.ZodType<Chunk> = z
  .strictObject({
    id: S.chunkId,
    kind: z.literal('chunk'),
    text: z.string(),
    sourceChunkIds: sourceChunkIdsSchema,
    recipeId: z.null(),
    meta: jsonObjectSchema,
    docKey: S.docKey,
    sectionPath: z.array(z.string()),
    occurrence: nonNegInt,
    pages: z.array(z.number().int().positive()),
    blockRefs: z.array(z.string()),
  })
  .refine((c) => c.sourceChunkIds.length === 1 && c.sourceChunkIds[0] === c.id, {
    message: 'a chunk cites exactly itself',
  });

const nodeRefSchema = z.strictObject({ nodeId: S.nodeId, surface: z.string().min(1), role: z.string().nullable() });

export const relationSchema: z.ZodType<Relation> = z.strictObject({
  id: S.derivedItemId,
  kind: z.literal('relation'),
  text: z.string().min(1),
  sourceChunkIds: sourceChunkIdsSchema,
  recipeId: S.recipeId,
  meta: jsonObjectSchema,
  nodes: z.array(nodeRefSchema),
});

export const summarySchema: z.ZodType<Summary> = z.strictObject({
  id: S.derivedItemId,
  kind: z.literal('summary'),
  text: z.string().min(1),
  sourceChunkIds: sourceChunkIdsSchema,
  recipeId: S.recipeId,
  meta: jsonObjectSchema,
  memberItemIds: z.array(S.itemId),
  runId: S.runId,
});

export const anyItemSchema: z.ZodType<AnyItem> = z.union([chunkSchema, relationSchema, summarySchema]);

export const searchResultSchema: z.ZodType<SearchResult> = z.strictObject({
  itemId: S.itemId,
  kind: itemKindSchema,
  text: z.string(),
  score: z.number(),
  rank: z.number().int().positive(),
  sourceChunkIds: sourceChunkIdsSchema,
});

export const searchResponseSchema: z.ZodType<SearchResponse> = z
  .strictObject({
    searchId: S.searchId,
    buildId: S.buildId,
    stale: z.boolean(),
    items: z.array(searchResultSchema),
  })
  .refine((r) => r.items.every((it, i) => it.rank === i + 1), { message: 'ranks must be 1..n in order' });

export const rankedRefSchema: z.ZodType<RankedRef> = z.strictObject({
  itemId: S.itemId,
  score: z.number(),
  rank: z.number().int().positive(),
  queryId: z.string().nullable(),
});
export const queryVariantSchema: z.ZodType<QueryVariant> = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  origin: z.string().min(1),
  parentId: z.string().nullable(),
});
export const seedSchema: z.ZodType<Seed> = z.strictObject({
  nodeId: S.nodeId.nullable(),
  itemId: S.itemId.nullable(),
  weight: z.number(),
});
export const stepTraceSchema: z.ZodType<StepTrace> = z.strictObject({
  stepIndex: nonNegInt,
  state: z.string().min(1),
  stepType: z.string().min(1),
  params: jsonObjectSchema,
  considered: z.array(rankedRefSchema),
  output: z.array(rankedRefSchema),
  queries: z.array(queryVariantSchema).optional(),
  seeds: z.array(seedSchema).optional(),
  pools: z.record(z.string().min(1), z.array(rankedRefSchema)).optional(),
  details: jsonSchema.optional(),
  durationMs: z.number().nonnegative(),
});

export const recipeKindSchema = z.enum([
  'parse',
  'chunk',
  'embed',
  'search',
  'extract',
  'equivalence',
  'cluster',
  'summarize',
  'eval-generate',
  'eval-judge',
]);
export const recipeSpecSchema: z.ZodType<RecipeSpec> = z.strictObject({
  kind: recipeKindSchema,
  version: z.string().min(1),
  spec: jsonObjectSchema,
});

export const formulaDecodingSchema: z.ZodType<FormulaDecodingSpec> = z.strictObject({
  model: z.string().min(1),
  revision: z.string().min(1),
  prompt: z.string().min(1),
  cropMargin: z.number().min(0).max(1),
});

export const parseRecipeSchema: z.ZodType<ParseRecipeSpec> = z.strictObject({
  kind: z.literal('parse'),
  version: z.string().min(1),
  spec: z.strictObject({
    parser: z.literal('docling'),
    doclingVersion: z.string().min(1),
    options: z
      .looseObject({ do_ocr: z.boolean(), do_table_structure: z.boolean(), do_formula_enrichment: z.literal(false) })
      .catchall(jsonSchema) as unknown as z.ZodType<ParseRecipeSpec['spec']['options']>,
    formulaDecoding: formulaDecodingSchema.optional(),
  }),
});

/** A search recipe: machine name, version, settings (checked by the machine's own schema), topology pin, optional prompt digest. */
export const searchRecipeSchema: z.ZodType<SearchRecipeSpec> = z.strictObject({
  kind: z.literal('search'),
  version: z.string().min(1),
  spec: z.strictObject({
    machine: z.string().min(1),
    settings: jsonObjectSchema,
    topology: z.string().regex(/^[0-9a-f]{16}$/, { message: 'topology must be 16 lowercase hex chars' }),
    promptDigest: z.string().regex(ID_PATTERNS.sha256, { message: 'promptDigest must be a sha256 hex digest' }).optional(),
  }),
});

export const machineNodeSchema = z.strictObject({
  id: z.string().min(1),
  parent: z.string().min(1).nullable(),
  kind: z.enum(['work', 'routing', 'final']),
  label: z.string(),
  logs: z.array(z.string().min(1)),
  step: z.string().min(1).nullable(),
  loop: z.boolean(),
});
export const machineEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  event: z.enum(['done', 'error', 'always']),
  guard: z.string().min(1).nullable(),
});
export const machineMapSchema: z.ZodType<MachineMap> = z.strictObject({
  machine: z.string().min(1),
  version: z.string().min(1),
  topology: z.string().regex(/^[0-9a-f]{16}$/),
  initial: z.string().min(1),
  nodes: z.array(machineNodeSchema).min(1),
  edges: z.array(machineEdgeSchema),
});

export const parseStatsSchema: z.ZodType<ParseStats> = z.strictObject({
  pages: nonNegInt,
  chars: nonNegInt,
  charsPerPage: z.array(nonNegInt),
  undecodedFormulas: nonNegInt,
  elapsedMs: z.number().nonnegative(),
});

/** The parse artifact envelope. `document` is checked only for the DoclingDocument top-level keys the chunker needs. */
export const parseArtifactSchema: z.ZodType<ParseArtifact> = z.strictObject({
  format: z.literal('kg-parse-artifact/1'),
  sourceSha256: S.sha256,
  sourceName: z.string().min(1),
  recipe: parseRecipeSchema,
  parser: z.strictObject({ name: z.literal('docling'), version: z.string().min(1) }),
  producedAt: isoTs,
  producedOn: z.string(),
  stats: parseStatsSchema,
  document: z
    .looseObject({
      schema_name: z.literal('DoclingDocument'),
      body: z.looseObject({ children: z.array(z.unknown()) }),
      texts: z.array(z.unknown()),
      groups: z.array(z.unknown()),
      tables: z.array(z.unknown()),
      pictures: z.array(z.unknown()),
    }) as unknown as z.ZodType<JsonObject>,
});

export const embeddingSpaceSpecSchema: z.ZodType<EmbeddingSpaceSpec> = z.strictObject({
  model: z.string().min(1),
  digest: z.string().min(1),
  dims: z.number().int().positive(),
  documentTemplate: z.string().min(1),
  queryTemplate: z.string().min(1),
  formulaView: z.enum(['placeholder', 'full']),
});

export const relevanceSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const sessionKindSchema = z.enum(['agent', 'eval', 'cli', 'test']);

export const questionTypeSchema = z.enum(['single-hop', 'multi-hop', 'topic', 'exact-term']);
export const evalQuestionSchema: z.ZodType<EvalQuestion> = z.strictObject({
  id: z.string().min(1),
  type: questionTypeSchema,
  question: z.string().min(1),
  referenceAnswer: z.string(),
  goldChunkIds: sourceChunkIdsSchema,
  goldText: z.array(z.string()),
  sourceDocKeys: z.array(S.docKey),
});
export const evalSetSchema: z.ZodType<EvalSet> = z.strictObject({
  id: S.evalSetId,
  name: z.string().min(1),
  genRecipeId: S.recipeId.nullable(),
  questions: z.array(evalQuestionSchema).min(1),
});

export { nonNegInt as nonNegIntSchema };

/** 0.6.1: the judge and answerer a run records (eval.run.started, EvalRunRecord.config). */
export const evalJudgeSchema = z.strictObject({ recipeId: S.recipeId, model: z.string().min(1) });
export const evalAnswererSchema = z.strictObject({ model: z.string().min(1), promptDigest: S.sha256 });
