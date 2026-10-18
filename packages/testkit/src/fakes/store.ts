/**
 * InMemoryCorpusStore: a faithful in-memory CorpusStore (passes corpusStoreConformance). Returns copies so
 * callers cannot mutate stored state. Transactions snapshot the whole state and restore it on throw.
 */
import {
  KgError,
  anyItemSchema,
  artifactId,
  canonicalJson,
  chunkId,
  cosineScore,
  docVersionId,
  embeddingSpaceSpecSchema,
  nodeId,
  parseArtifactSchema,
  recipeId,
  recipeSpecSchema,
  sortCandidates,
  spaceId,
  validateSpace,
  buildId as computeBuildId,
  type AnyItem,
  type ArtifactId,
  type Build,
  type BuildId,
  type BuildLabel,
  type Chunk,
  type ChunkDraft,
  type ChunkId,
  type Clock,
  type CorpusStore,
  type DerivationRun,
  type DocKey,
  type DocVersion,
  type DocVersionId,
  type EmbeddingSpace,
  type EmbeddingSpaceSpec,
  type ItemId,
  type Json,
  type KnnQuery,
  type Mapping,
  type MappingId,
  type Node,
  type NodeId,
  type ParseArtifact,
  type Recipe,
  type RecipeId,
  type RecipeSpec,
  type RunId,
  type SpaceId,
  type StaleReport,
} from '@kg/core';
import { FixedClock } from './infra';

export interface StoreState {
  recipes: Map<RecipeId, Recipe>;
  artifacts: Map<ArtifactId, ParseArtifact>;
  artifactIndex: Map<string, ArtifactId>;
  documents: Map<DocKey, DocVersionId | null>;
  docVersions: Map<DocVersionId, DocVersion>;
  docVersionProvenance: Map<DocVersionId, { pages: number[]; blockRefs: string[] }[]>;
  items: Map<ItemId, AnyItem>;
  sourceIndex: Map<ChunkId, Set<ItemId>>;
  nodes: Map<NodeId, Node>;
  spaces: Map<SpaceId, EmbeddingSpace>;
  embeddings: Map<SpaceId, Map<ItemId, Float32Array>>;
  builds: Map<BuildId, Build>;
  buildItems: Map<BuildId, Set<ItemId>>;
  labels: Map<string, BuildLabel>;
  currentBuild: BuildId | null;
  runs: Map<RunId, DerivationRun>;
  mappings: Map<MappingId, Mapping>;
}

const emptyState = (): StoreState => ({
  recipes: new Map(),
  artifacts: new Map(),
  artifactIndex: new Map(),
  documents: new Map(),
  docVersions: new Map(),
  docVersionProvenance: new Map(),
  items: new Map(),
  sourceIndex: new Map(),
  nodes: new Map(),
  spaces: new Map(),
  embeddings: new Map(),
  builds: new Map(),
  buildItems: new Map(),
  labels: new Map(),
  currentBuild: null,
  runs: new Map(),
  mappings: new Map(),
});

const copy = <T>(x: T): T => structuredClone(x);
const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
const isSortedUnique = (xs: readonly string[]) => xs.every((x, i) => i === 0 || xs[i - 1]! < x);

export class InMemoryCorpusStore implements CorpusStore {
  protected s: StoreState = emptyState();
  private txDepth = 0;
  constructor(protected readonly clock: Clock = new FixedClock()) {}

  // ---------------------------------------------------------------- recipes
  putRecipe(r: RecipeSpec): RecipeId {
    const p = recipeSpecSchema.safeParse(r);
    if (!p.success) throw new KgError('invalid_input', `bad recipe: ${p.error.issues.map((i) => i.message).join('; ')}`);
    const id = recipeId(r);
    if (!this.s.recipes.has(id)) this.s.recipes.set(id, { ...copy(r), id });
    return id;
  }
  getRecipe(id: RecipeId): Recipe | null {
    const r = this.s.recipes.get(id);
    return r ? copy(r) : null;
  }

  // ---------------------------------------------------------------- artifacts
  putArtifact(a: ParseArtifact): ArtifactId {
    const p = parseArtifactSchema.safeParse(a);
    if (!p.success) throw new KgError('invalid_input', `bad artifact: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const rid = this.putRecipe(a.recipe);
    const id = artifactId(a.sourceSha256, rid);
    if (!this.s.artifacts.has(id)) {
      this.s.artifacts.set(id, copy(a));
      this.s.artifactIndex.set(`${a.sourceSha256}|${rid}`, id);
    }
    return id;
  }
  getArtifact(id: ArtifactId): ParseArtifact | null {
    const a = this.s.artifacts.get(id);
    return a ? copy(a) : null;
  }
  findArtifact(sourceSha256: string, parseRecipe: RecipeId): ArtifactId | null {
    return this.s.artifactIndex.get(`${sourceSha256}|${parseRecipe}`) ?? null;
  }

  // ---------------------------------------------------------------- documents
  putDocVersion(v: Omit<DocVersion, 'createdAt'>, chunks: readonly ChunkDraft[]): { inserted: ChunkId[]; reused: ChunkId[] } {
    if (v.id !== docVersionId(v.docKey, v.artifactId, v.chunkRecipeId)) throw new KgError('invalid_input', 'doc version id does not match docVersionId(docKey, artifactId, chunkRecipeId)');
    if (v.chunkIds.length !== chunks.length || v.chunkIds.some((id, i) => id !== chunks[i]!.id)) throw new KgError('invalid_input', 'v.chunkIds must equal chunks.map(c => c.id)');
    for (const c of chunks) {
      if (c.id !== chunkId(v.docKey, c.sectionPath, c.text, c.occurrence)) throw new KgError('invalid_input', `chunk ${c.id} does not match chunkId(...)`);
    }
    if (!this.s.artifacts.has(v.artifactId)) throw new KgError('not_found', `artifact ${v.artifactId}`);
    if (!this.s.recipes.has(v.chunkRecipeId)) throw new KgError('not_found', `chunk recipe ${v.chunkRecipeId}`);
    if (this.s.docVersions.has(v.id)) return { inserted: [], reused: [...v.chunkIds] };

    return this.transaction(() => {
      const inserted: ChunkId[] = [];
      const reused: ChunkId[] = [];
      for (const c of chunks) {
        if (this.s.items.has(c.id) || inserted.includes(c.id)) {
          reused.push(c.id);
          continue;
        }
        const item: Chunk = {
          id: c.id,
          kind: 'chunk',
          text: c.text,
          sourceChunkIds: [c.id],
          recipeId: null,
          meta: {},
          docKey: v.docKey,
          sectionPath: [...c.sectionPath],
          occurrence: c.occurrence,
          pages: [...c.pages],
          blockRefs: [...c.blockRefs],
        };
        this.s.items.set(c.id, item);
        this.index(item);
        inserted.push(c.id);
      }
      if (!this.s.documents.has(v.docKey)) this.s.documents.set(v.docKey, null);
      this.s.docVersions.set(v.id, { ...copy(v), createdAt: this.clock.now() });
      this.s.docVersionProvenance.set(
        v.id,
        chunks.map((c) => ({ pages: [...c.pages], blockRefs: [...c.blockRefs] })),
      );
      return { inserted, reused };
    });
  }
  getDocVersion(id: DocVersionId): DocVersion | null {
    const v = this.s.docVersions.get(id);
    return v ? copy(v) : null;
  }
  currentDocVersions(): DocVersion[] {
    return [...this.s.documents.entries()]
      .filter((e): e is [DocKey, DocVersionId] => e[1] !== null)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, id]) => copy(this.s.docVersions.get(id)!));
  }
  setCurrentDocVersion(docKey: DocKey, v: DocVersionId): void {
    const dv = this.s.docVersions.get(v);
    if (!dv) throw new KgError('not_found', `doc version ${v}`);
    if (dv.docKey !== docKey) throw new KgError('invalid_input', `doc version ${v} belongs to ${dv.docKey}, not ${docKey}`);
    this.s.documents.set(docKey, v);
  }

  // ---------------------------------------------------------------- items
  protected index(item: AnyItem): void {
    for (const c of item.sourceChunkIds) {
      let set = this.s.sourceIndex.get(c);
      if (!set) this.s.sourceIndex.set(c, (set = new Set()));
      set.add(item.id);
    }
  }
  putItems(items: readonly AnyItem[], nodes: readonly Node[] = []): void {
    this.transaction(() => {
      for (const n of nodes) {
        if (n.id !== nodeId(n.name)) throw new KgError('invalid_input', `node id ${n.id} does not match nodeId(name)`);
        const cur = this.s.nodes.get(n.id);
        if (cur && !same(cur, n)) throw new KgError('immutable_violation', `node ${n.id} exists with different content`);
        if (!cur) this.s.nodes.set(n.id, copy(n));
      }
      for (const it of items) {
        if (it.kind === 'chunk') throw new KgError('invalid_input', 'chunks enter only through putDocVersion');
        const p = anyItemSchema.safeParse(it);
        if (!p.success) throw new KgError('invalid_input', `bad item ${it.id}: ${p.error.issues.map((i) => i.message).join('; ')}`);
        for (const c of it.sourceChunkIds) {
          if (this.s.items.get(c)?.kind !== 'chunk') throw new KgError('not_found', `source chunk ${c} of ${it.id}`);
        }
        if (it.recipeId && !this.s.recipes.has(it.recipeId)) throw new KgError('not_found', `recipe ${it.recipeId}`);
        if (it.kind === 'relation') {
          for (const nr of it.nodes) if (!this.s.nodes.has(nr.nodeId)) throw new KgError('not_found', `node ${nr.nodeId}`);
        }
        const cur = this.s.items.get(it.id);
        if (cur) {
          if (!same(cur, it)) throw new KgError('immutable_violation', `item ${it.id} exists with different content`);
          continue;
        }
        this.s.items.set(it.id, copy(it));
        this.index(it);
      }
    });
  }
  getItems(ids: readonly ItemId[]): AnyItem[] {
    return ids.flatMap((id) => {
      const it = this.s.items.get(id);
      return it ? [copy(it)] : [];
    });
  }
  itemsBySourceChunk(chunkIds: readonly ChunkId[]): AnyItem[] {
    const ids = new Set<ItemId>();
    for (const c of chunkIds) for (const id of this.s.sourceIndex.get(c) ?? []) ids.add(id);
    return [...ids].sort().map((id) => copy(this.s.items.get(id)!));
  }

  // ---------------------------------------------------------------- embeddings
  putSpace(sp: EmbeddingSpaceSpec): SpaceId {
    const p = embeddingSpaceSpecSchema.safeParse(sp);
    if (!p.success) throw new KgError('invalid_input', `bad space: ${p.error.issues.map((i) => i.message).join('; ')}`);
    validateSpace(sp);
    const id = spaceId(sp);
    if (!this.s.spaces.has(id)) {
      this.s.spaces.set(id, { ...copy(sp), id });
      this.s.embeddings.set(id, new Map());
    }
    return id;
  }
  getSpace(id: SpaceId): EmbeddingSpace | null {
    const sp = this.s.spaces.get(id);
    return sp ? copy(sp) : null;
  }
  missingEmbeddings(space: SpaceId, itemIds: readonly ItemId[]): ItemId[] {
    const m = this.s.embeddings.get(space);
    if (!m) throw new KgError('not_found', `space ${space}`);
    return itemIds.filter((id) => !m.has(id));
  }
  putEmbeddings(space: SpaceId, rows: readonly { itemId: ItemId; vector: Float32Array }[]): void {
    const sp = this.s.spaces.get(space);
    if (!sp) throw new KgError('not_found', `space ${space}`);
    this.transaction(() => {
      const m = this.s.embeddings.get(space)!;
      for (const r of rows) {
        if (!this.s.items.has(r.itemId)) throw new KgError('not_found', `item ${r.itemId}`);
        if (r.vector.length !== sp.dims) throw new KgError('invalid_input', `vector has ${r.vector.length} dims, space has ${sp.dims}`);
        if (!m.has(r.itemId)) m.set(r.itemId, Float32Array.from(r.vector));
      }
    });
  }
  knn(q: KnnQuery): { itemId: ItemId; score: number }[] {
    const items = this.s.buildItems.get(q.buildId);
    if (!items) throw new KgError('not_found', `build ${q.buildId}`);
    const sp = this.s.spaces.get(q.space);
    if (!sp) throw new KgError('not_found', `space ${q.space}`);
    if (q.vector.length !== sp.dims) throw new KgError('invalid_input', `query has ${q.vector.length} dims, space has ${sp.dims}`);
    if (!Number.isInteger(q.limit) || q.limit < 1) throw new KgError('invalid_input', 'limit must be a positive integer');
    return this.scoreAll(q, this.candidateIds(q, items)).slice(0, q.limit);
  }
  protected candidateIds(q: KnnQuery, buildItems: Set<ItemId>): ItemId[] {
    const kinds = new Set(q.kinds);
    return [...buildItems].filter((id) => kinds.has(this.s.items.get(id)!.kind));
  }
  protected scoreAll(q: KnnQuery, ids: ItemId[]): { itemId: ItemId; score: number }[] {
    const m = this.s.embeddings.get(q.space)!;
    const scored: { itemId: ItemId; score: number }[] = [];
    for (const id of ids) {
      const v = m.get(id);
      if (v) scored.push({ itemId: id, score: cosineScore(q.vector, v) });
    }
    return sortCandidates(scored);
  }

  // ---------------------------------------------------------------- builds
  putBuild(b: Omit<Build, 'id' | 'createdAt'>): BuildId {
    const id = computeBuildId(b.manifest, b.itemIds);
    if (this.s.builds.has(id)) return id;
    if (!isSortedUnique(b.itemIds)) throw new KgError('invalid_input', 'build itemIds must be sorted and unique');
    for (const it of b.itemIds) if (!this.s.items.has(it)) throw new KgError('not_found', `item ${it}`);
    for (const dv of Object.values(b.manifest.docVersions)) if (!this.s.docVersions.has(dv)) throw new KgError('not_found', `doc version ${dv}`);
    for (const sp of b.manifest.embeddingSpaces) if (!this.s.spaces.has(sp)) throw new KgError('not_found', `space ${sp}`);
    for (const r of [b.manifest.searchRecipeId, ...b.manifest.derivedRecipes]) if (!this.s.recipes.has(r)) throw new KgError('not_found', `recipe ${r}`);
    if (b.parentId !== null && !this.s.builds.has(b.parentId)) throw new KgError('not_found', `parent build ${b.parentId}`);
    for (const sp of b.manifest.embeddingSpaces) {
      const m = this.s.embeddings.get(sp)!;
      const missing = b.itemIds.filter((it) => !m.has(it));
      if (missing.length) throw new KgError('precondition', `${missing.length} build items lack an embedding in space ${sp}, e.g. ${missing[0]}`);
    }
    this.s.builds.set(id, { ...copy(b), id, createdAt: this.clock.now() });
    this.s.buildItems.set(id, new Set(b.itemIds));
    return id;
  }
  getBuild(id: BuildId): Build | null {
    const b = this.s.builds.get(id);
    return b ? copy(b) : null;
  }
  currentBuild(): BuildId | null {
    return this.s.currentBuild;
  }
  setCurrentBuild(id: BuildId): void {
    if (!this.s.builds.has(id)) throw new KgError('not_found', `build ${id}`);
    this.s.currentBuild = id;
  }
  labelBuild(name: string, id: BuildId): BuildLabel {
    if (!this.s.builds.has(id)) throw new KgError('not_found', `build ${id}`);
    if (name.length === 0) throw new KgError('invalid_input', 'empty label');
    const cur = this.s.labels.get(name);
    if (cur) {
      if (cur.buildId !== id) throw new KgError('conflict', `label ${name} already names ${cur.buildId}`);
      return copy(cur);
    }
    const l: BuildLabel = { name, buildId: id, createdAt: this.clock.now() };
    this.s.labels.set(name, l);
    return copy(l);
  }
  getLabel(name: string): BuildLabel | null {
    const l = this.s.labels.get(name);
    return l ? copy(l) : null;
  }
  staleCheck(id: BuildId): StaleReport {
    const items = this.s.buildItems.get(id);
    if (!items) throw new KgError('not_found', `build ${id}`);
    const current = new Set<ChunkId>();
    for (const dv of this.currentDocVersions()) for (const c of dv.chunkIds) current.add(c);
    const missing = new Set<ChunkId>();
    for (const it of items) for (const c of this.s.items.get(it)!.sourceChunkIds) if (!current.has(c)) missing.add(c);
    const missingChunkIds = [...missing].sort();
    return { buildId: id, missingChunkIds, stale: missingChunkIds.length > 0 };
  }

  // ---------------------------------------------------------------- set-level
  putMappings(run: DerivationRun, ms: readonly Mapping[]): void {
    this.transaction(() => {
      if (!this.s.recipes.has(run.recipeId)) throw new KgError('not_found', `recipe ${run.recipeId}`);
      const cur = this.s.runs.get(run.id);
      if (cur && !same(cur, run)) throw new KgError('immutable_violation', `run ${run.id} exists with different content`);
      if (!cur) this.s.runs.set(run.id, copy(run));
      for (const m of ms) {
        if (m.runId !== run.id) throw new KgError('invalid_input', `mapping ${m.id} names run ${m.runId}, not ${run.id}`);
        const c = this.s.mappings.get(m.id);
        if (c && !same(c, m)) throw new KgError('immutable_violation', `mapping ${m.id} exists with different content`);
        if (!c) this.s.mappings.set(m.id, copy(m));
      }
    });
  }

  // ---------------------------------------------------------------- transactions
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    const snapshot = structuredClone(this.s);
    this.txDepth++;
    try {
      return fn();
    } catch (e) {
      this.s = snapshot;
      throw e;
    } finally {
      this.txDepth--;
    }
  }
}
