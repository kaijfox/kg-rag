import {
  KgError,
  asDocKey,
  composeBuild,
  defaultDocKey,
  docVersionId,
  recipeId,
  recipesEqual,
  spaceId,
  type ArtifactId,
  type ChunkDraft,
  type ChunkRecipeSpec,
  type Ctx,
  type DocKey,
  type DocVersion,
  type DocVersionId,
  type IngestDocReport,
  type IngestReport,
  type ItemId,
  type ParseArtifact,
  type ParseRecipeSpec,
} from '@kg/core';
import { checkEmbedded, embeddedText, needsDecoding, plainParseRecipe, type IngestDeps, type Vector } from './deps';

/** Writes the recipes and the space the database config names; both are insert-only and content-addressed. */
export function ensureConfig(d: IngestDeps): void {
  const { store, config } = d;
  store.putRecipe(config.parseRecipe);
  store.putRecipe(plainParseRecipe(config.parseRecipe));
  store.putRecipe(config.chunkRecipe);
  store.putRecipe(config.searchRecipe);
  store.putSpace(config.space);
}

export interface DocEntry {
  kind: 'file' | 'artifact';
  path: string;
  docKey?: string;
}

export interface DocPlan {
  docKey: DocKey;
  version: Omit<DocVersion, 'createdAt'>;
  chunks: ChunkDraft[];
  previousDocVersionId: DocVersionId | null;
  unchanged: boolean;
  report: IngestDocReport;
  vectors: Vector[];
}

const parsedEvent = (ctx: Ctx, docKey: DocKey, artifactId: ArtifactId, origin: 'cache' | 'parsed' | 'imported', artifact: ParseArtifact) =>
  ctx.emit('ingest.parsed', { docKey, artifactId, origin, stats: artifact.stats });

const startedEvent = (ctx: Ctx, d: IngestDeps, entry: DocEntry, docKey: DocKey, sha256: string, parseRecipe: ParseRecipeSpec) =>
  ctx.emit('ingest.started', {
    docKey,
    source: { kind: entry.kind, path: entry.path },
    sourceSha256: sha256,
    parseRecipeId: recipeId(parseRecipe),
    chunkRecipeId: recipeId(d.config.chunkRecipe),
  });

export async function identifySource(ctx: Ctx, d: IngestDeps, entry: DocEntry): Promise<{ docKey: DocKey; sha256: string; cached: ArtifactId | null }> {
  const id = await d.parser.identify(entry.path);
  const docKey = entry.docKey !== undefined ? asDocKey(entry.docKey) : defaultDocKey(entry.path);
  const plain = plainParseRecipe(d.config.parseRecipe);
  startedEvent(ctx, d, entry, docKey, id.sha256, plain);
  return { docKey, sha256: id.sha256, cached: d.store.findArtifact(id.sha256, recipeId(plain)) };
}

export async function importArtifact(
  ctx: Ctx,
  d: IngestDeps,
  entry: DocEntry,
): Promise<{ docKey: DocKey; sha256: string; artifact: ParseArtifact; artifactId: ArtifactId }> {
  const artifact = await d.parser.readArtifact(entry.path);
  const docKey = entry.docKey !== undefined ? asDocKey(entry.docKey) : defaultDocKey(artifact.sourceName);
  startedEvent(ctx, d, entry, docKey, artifact.sourceSha256, plainParseRecipe(d.config.parseRecipe));
  const artifactId = d.store.putArtifact(artifact);
  if (!needsDecoding(d.config, artifact)) parsedEvent(ctx, docKey, artifactId, 'imported', artifact);
  return { docKey, sha256: artifact.sourceSha256, artifact, artifactId };
}

export function loadCached(ctx: Ctx, d: IngestDeps, docKey: DocKey, artifactId: ArtifactId): { artifact: ParseArtifact; artifactId: ArtifactId } {
  const artifact = d.store.getArtifact(artifactId);
  if (!artifact) throw new KgError('not_found', `cached artifact ${artifactId}`);
  if (!needsDecoding(d.config, artifact)) parsedEvent(ctx, docKey, artifactId, 'cache', artifact);
  return { artifact, artifactId };
}

export async function parseSource(
  ctx: Ctx,
  d: IngestDeps,
  entry: DocEntry,
  docKey: DocKey,
  sha256: string,
): Promise<{ artifact: ParseArtifact; artifactId: ArtifactId }> {
  const plain = plainParseRecipe(d.config.parseRecipe);
  const artifact = await d.parser.parse({ path: entry.path, docKey, sha256 }, plain);
  if (artifact.sourceSha256 !== sha256 || !recipesEqual(artifact.recipe, plain)) {
    throw new KgError('upstream', `parser returned an artifact that is not for ${entry.path} under the requested recipe`);
  }
  const artifactId = d.store.putArtifact(artifact);
  if (!needsDecoding(d.config, artifact)) parsedEvent(ctx, docKey, artifactId, 'parsed', artifact);
  return { artifact, artifactId };
}

/** Decoded artifacts are cached under the full recipe; an artifact given without its source file cannot be decoded. */
export async function decodeFormulas(
  ctx: Ctx,
  d: IngestDeps,
  entry: DocEntry,
  docKey: DocKey,
  source: ParseArtifact,
): Promise<{ artifact: ParseArtifact; artifactId: ArtifactId }> {
  const full = d.config.parseRecipe;
  const cached = d.store.findArtifact(source.sourceSha256, recipeId(full));
  if (cached) {
    const artifact = d.store.getArtifact(cached);
    if (!artifact) throw new KgError('not_found', `cached artifact ${cached}`);
    parsedEvent(ctx, docKey, cached, 'cache', artifact);
    return { artifact, artifactId: cached };
  }
  if (entry.kind === 'artifact') {
    throw new KgError('precondition', `${entry.path} is an artifact without its source file: formula decoding needs the PDF`);
  }
  if (!d.formulaDecoder) throw new KgError('precondition', 'the recipe asks for formula decoding but no formula decoder is configured');
  const decoded = await d.formulaDecoder(source, entry.path, full);
  if (decoded.sourceSha256 !== source.sourceSha256 || !recipesEqual(decoded.recipe, full)) {
    throw new KgError('upstream', `formula decoder returned an artifact that is not the decoded form of ${entry.path}`);
  }
  const artifactId = d.store.putArtifact(decoded);
  parsedEvent(ctx, docKey, artifactId, 'parsed', decoded);
  return { artifact: decoded, artifactId };
}

export function chunkDocument(ctx: Ctx, d: IngestDeps, docKey: DocKey, artifact: ParseArtifact, artifactId: ArtifactId): DocPlan {
  const chunkRecipeId = recipeId(d.config.chunkRecipe);
  const chunks = d.chunker(artifact, docKey, d.config.chunkRecipe);
  const chunkIds = chunks.map((c) => c.id);
  const version: Omit<DocVersion, 'createdAt'> = {
    id: docVersionId(docKey, artifactId, chunkRecipeId),
    docKey,
    artifactId,
    chunkRecipeId,
    chunkIds,
  };
  const existing = new Set<string>(d.store.getItems(chunkIds).map((i) => i.id));
  const previous = d.store.currentDocVersions().find((v) => v.docKey === docKey) ?? null;
  const inNew = new Set<string>(chunkIds);
  const dropped = previous ? previous.chunkIds.filter((c) => !inNew.has(c)).length : 0;
  const reused = chunkIds.filter((c) => existing.has(c)).length;
  const inserted = chunkIds.length - reused;
  ctx.emit('ingest.chunked', { docKey, docVersionId: version.id, chunkCount: chunks.length, inserted, reused, dropped });
  const unchanged = previous?.id === version.id;
  return {
    docKey,
    version,
    chunks,
    previousDocVersionId: previous?.id ?? null,
    unchanged,
    report: { docKey, docVersionId: version.id, unchanged, inserted, reused, dropped },
    vectors: [],
  };
}

/** Embeds the chunks of one document that lack a vector in the space. Nothing is written here. */
export async function embedDocument(ctx: Ctx, d: IngestDeps, plan: DocPlan, artifact: ParseArtifact): Promise<Vector[]> {
  const space = spaceId(d.config.space);
  const missing = new Set<string>(d.store.missingEmbeddings(space, plan.chunks.map((c) => c.id)));
  const todo = plan.chunks.filter((c) => missing.has(c.id));
  const t0 = ctx.clock.monotonicMs();
  const texts = todo.map((c) => embeddedText(d, artifact, c));
  const vectors = texts.length ? await d.embedder.embed(texts) : [];
  checkEmbedded(vectors, texts);
  ctx.emit('ingest.embedded', {
    docKey: plan.docKey,
    spaceId: space,
    embedded: todo.length,
    skipped: plan.chunks.length - todo.length,
    elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0),
  });
  return todo.map((c, i) => ({ itemId: c.id, vector: vectors[i]! }));
}

/** The chunks of a stored version as its chunker draws them: the items keep first-seen text and refs, the version keeps its own. */
function versionDrafts(d: IngestDeps, v: DocVersion, artifact: ParseArtifact): Map<string, ChunkDraft> {
  const recipe = d.store.getRecipe(v.chunkRecipeId);
  if (!recipe || recipe.kind !== 'chunk') throw new KgError('not_found', `chunk recipe ${v.chunkRecipeId}`);
  return new Map(d.chunker(artifact, v.docKey, recipe as unknown as ChunkRecipeSpec).map((c) => [c.id as string, c]));
}

function draftOf(drafts: Map<string, ChunkDraft>, id: ItemId): ChunkDraft {
  const draft = drafts.get(id);
  if (!draft) throw new KgError('upstream', `the chunker no longer produces chunk ${id} of its stored document version`);
  return draft;
}

/**
 * Embeds, in the configured space, every chunk of every current document this request does not touch that lacks a
 * vector there. Then names the chunks of the new build that still have no vector (empty when the build is complete).
 */
export async function embedOtherDocuments(
  ctx: Ctx,
  d: IngestDeps,
  plans: readonly DocPlan[],
): Promise<{ vectors: Vector[]; unembedded: ItemId[] }> {
  const space = spaceId(d.config.space);
  const requested = new Set<string>(plans.map((p) => p.docKey));
  const others = d.store.currentDocVersions().filter((v) => !requested.has(v.docKey));
  const vectors: Vector[] = [];
  for (const v of others) {
    const missing = d.store.missingEmbeddings(space, v.chunkIds);
    if (missing.length === 0) continue;
    const artifact = d.store.getArtifact(v.artifactId);
    if (!artifact) throw new KgError('not_found', `artifact ${v.artifactId}`);
    const t0 = ctx.clock.monotonicMs();
    const items = d.store.getItems(missing);
    const drafts = versionDrafts(d, v, artifact);
    const texts = items.map((i) => embeddedText(d, artifact, draftOf(drafts, i.id)));
    const out = await d.embedder.embed(texts);
    checkEmbedded(out, texts);
    vectors.push(...items.map((i, k) => ({ itemId: i.id, vector: out[k]! })));
    ctx.emit('ingest.embedded', {
      docKey: v.docKey,
      spaceId: space,
      embedded: items.length,
      skipped: v.chunkIds.length - items.length,
      elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0),
    });
  }
  const covered = new Set<string>([...plans.flatMap((p) => p.vectors.map((x) => x.itemId)), ...vectors.map((x) => x.itemId)]);
  const build: ItemId[] = [...plans.flatMap((p) => p.chunks.map((c) => c.id)), ...others.flatMap((v) => v.chunkIds)];
  const unembedded = d.store.missingEmbeddings(space, build).filter((id) => !covered.has(id));
  return { vectors, unembedded };
}

/**
 * The one transaction: document versions, vectors, current pointers, then the build. Announces the documents and the
 * build after the commit. Any throw inside leaves nothing of this run behind.
 */
export function commitIngest(ctx: Ctx, d: IngestDeps, plans: readonly DocPlan[], vectors: readonly Vector[]): IngestReport {
  const { store, config } = d;
  const space = spaceId(config.space);
  const previous = store.currentBuild();
  const parseRecipes = new Map<ArtifactId, ReturnType<typeof recipeId>>();
  const parseRecipeOf = (a: ArtifactId) => {
    let id = parseRecipes.get(a);
    if (!id) {
      const art = store.getArtifact(a);
      if (!art) throw new KgError('not_found', `artifact ${a}`);
      id = recipeId(art.recipe);
      parseRecipes.set(a, id);
    }
    return id;
  };
  const done = store.transaction(() => {
    for (const p of plans) store.putDocVersion(p.version, p.chunks);
    if (vectors.length > 0) store.putEmbeddings(space, vectors.map((v) => ({ itemId: v.itemId, vector: v.vector })));
    for (const p of plans) store.setCurrentDocVersion(p.docKey, p.version.id);
    const build = composeBuild({
      docVersions: store.currentDocVersions(),
      parseRecipeOf,
      spaceIds: [space],
      searchRecipeId: recipeId(config.searchRecipe),
      parentId: previous,
    });
    const existed = store.getBuild(build.id) !== null;
    const id = store.putBuild(build);
    if (store.currentBuild() !== id) store.setCurrentBuild(id);
    return { id, existed, mixedRecipes: build.manifest.mixedRecipes, itemCount: build.itemIds.length };
  });
  for (const p of plans) {
    ctx.emit('ingest.completed', { docKey: p.docKey, docVersionId: p.version.id, unchanged: p.unchanged, previousDocVersionId: p.previousDocVersionId });
  }
  const buildChanged = done.id !== previous;
  if (buildChanged) {
    ctx.emit(
      'build.created',
      { buildId: done.id, parentId: previous, mixedRecipes: done.mixedRecipes, itemCount: done.itemCount, revert: done.existed },
      { buildId: done.id },
    );
  }
  return { docs: plans.map((p) => p.report), buildId: done.id, buildChanged };
}
