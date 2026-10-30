/**
 * SqliteCorpusStore: the CorpusStore port on one SQLite file. Insert-only except the two pointers
 * (documents.current_version and the current build in db_meta); triggers in the shared schema enforce that.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  anyItemSchema,
  artifactId,
  buildId,
  canonicalJson,
  chunkId,
  docVersionId,
  embeddingSpaceSpecSchema,
  nodeId,
  parseArtifactSchema,
  recipeId,
  recipeSpecSchema,
  spaceId,
  validateSpace,
  KgError,
  type AnyItem,
  type ArtifactId,
  type Build,
  type BuildId,
  type BuildLabel,
  type BuildManifest,
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
  type NodeRef,
  type ParseArtifact,
  type Recipe,
  type RecipeId,
  type RecipeSpec,
  type Relation,
  type RunId,
  type SpaceId,
  type StaleReport,
} from '@kg/core';
import { type Db, Sql, guard, prepare } from '@kg/sqlite';
import { encodeVector, invalid, notFound } from './values';

const json = (v: unknown): string => canonicalJson(v as Json);
const parse = <T>(s: string): T => JSON.parse(s) as T;
const sortedUnique = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || xs[i - 1]! < x);
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export class SqliteCorpusStore implements CorpusStore {
  private readonly sql: Sql;

  /** Configures the connection, loads sqlite-vec and migrates the file to the current schema (idempotent). */
  constructor(db: Db, private readonly clock: Clock) {
    prepare(db);
    this.sql = new Sql(db);
  }

  // ---------------------------------------------------------------- recipes
  putRecipe(r: RecipeSpec): RecipeId {
    return guard(() => {
      const p = recipeSpecSchema.safeParse(r);
      if (!p.success) throw invalid(`bad recipe: ${p.error.issues.map((i) => i.message).join('; ')}`);
      const id = recipeId(r);
      if (!this.sql.get('SELECT 1 FROM recipes WHERE recipe_id = ?', id)) {
        this.sql.run('INSERT INTO recipes (recipe_id, kind, version, spec) VALUES (?, ?, ?, ?)', id, r.kind, r.version, json(r));
      }
      return id;
    });
  }
  getRecipe(id: RecipeId): Recipe | null {
    return guard(() => {
      const row = this.sql.get('SELECT spec FROM recipes WHERE recipe_id = ?', id);
      return row ? { ...parse<RecipeSpec>(row.spec as string), id } : null;
    });
  }

  // ---------------------------------------------------------------- parse artifacts
  putArtifact(a: ParseArtifact): ArtifactId {
    return guard(() => this.transaction(() => {
      const p = parseArtifactSchema.safeParse(a);
      if (!p.success) throw invalid(`bad artifact: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const rid = this.putRecipe(a.recipe);
      const id = artifactId(a.sourceSha256, rid);
      if (this.sql.get('SELECT 1 FROM parse_artifacts WHERE artifact_id = ?', id)) return id;
      const body = gzipSync(Buffer.from(json(a), 'utf8'));
      this.sql.run(
        'INSERT INTO parse_artifacts (artifact_id, source_sha256, recipe_id, source_name, produced_at, produced_on, stats, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, a.sourceSha256, rid, a.sourceName, a.producedAt, a.producedOn, json(a.stats), body,
      );
      return id;
    }));
  }
  getArtifact(id: ArtifactId): ParseArtifact | null {
    return guard(() => {
      const row = this.sql.get('SELECT body FROM parse_artifacts WHERE artifact_id = ?', id);
      return row ? parse<ParseArtifact>(gunzipSync(row.body as Buffer).toString('utf8')) : null;
    });
  }
  findArtifact(sourceSha256: string, parseRecipe: RecipeId): ArtifactId | null {
    return guard(() => {
      const row = this.sql.get('SELECT artifact_id FROM parse_artifacts WHERE source_sha256 = ? AND recipe_id = ?', sourceSha256, parseRecipe);
      return row ? (row.artifact_id as ArtifactId) : null;
    });
  }

  // ---------------------------------------------------------------- documents and chunks
  putDocVersion(v: Omit<DocVersion, 'createdAt'>, chunks: readonly ChunkDraft[]): { inserted: ChunkId[]; reused: ChunkId[] } {
    return guard(() => {
      if (v.id !== docVersionId(v.docKey, v.artifactId, v.chunkRecipeId)) throw invalid('doc version id does not match docVersionId(docKey, artifactId, chunkRecipeId)');
      if (v.chunkIds.length !== chunks.length || v.chunkIds.some((id, i) => id !== chunks[i]!.id)) throw invalid('v.chunkIds must equal chunks.map(c => c.id)');
      for (const c of chunks) {
        if (c.id !== chunkId(v.docKey, c.sectionPath, c.text, c.occurrence)) throw invalid(`chunk ${c.id} does not match chunkId(...)`);
      }
      if (!this.sql.get('SELECT 1 FROM parse_artifacts WHERE artifact_id = ?', v.artifactId)) throw notFound(`artifact ${v.artifactId}`);
      if (!this.sql.get('SELECT 1 FROM recipes WHERE recipe_id = ?', v.chunkRecipeId)) throw notFound(`chunk recipe ${v.chunkRecipeId}`);
      if (this.sql.get('SELECT 1 FROM doc_versions WHERE doc_version_id = ?', v.id)) {
        if (!sameList(this.chunkIdsOf(v.id), v.chunkIds)) {
          throw new KgError('immutable_violation', `doc version ${v.id} already exists with a different chunk list (chunker changed without a recipe version bump?)`);
        }
        return { inserted: [], reused: [...v.chunkIds] };
      }
      return this.transaction(() => {
        const now = this.clock.now();
        const inserted: ChunkId[] = [];
        const reused: ChunkId[] = [];
        if (!this.sql.get('SELECT 1 FROM documents WHERE doc_key = ?', v.docKey)) {
          this.sql.run('INSERT INTO documents (doc_key, current_version) VALUES (?, NULL)', v.docKey);
        }
        for (const c of chunks) {
          // the check sees chunks inserted earlier in this loop, so a repeated id inside one version counts as reused
          if (this.sql.get('SELECT 1 FROM items WHERE item_id = ?', c.id)) {
            reused.push(c.id);
            continue;
          }
          this.sql.run('INSERT INTO items (item_id, kind, text, recipe_id, meta, created_at) VALUES (?, ?, ?, NULL, ?, ?)', c.id, 'chunk', c.text, '{}', now);
          this.sql.run(
            'INSERT INTO chunks (chunk_id, doc_key, section_path, occurrence, pages, block_refs) VALUES (?, ?, ?, ?, ?, ?)',
            c.id, v.docKey, JSON.stringify(c.sectionPath), c.occurrence, JSON.stringify(c.pages), JSON.stringify(c.blockRefs),
          );
          this.sql.run('INSERT INTO item_sources (item_id, chunk_id) VALUES (?, ?)', c.id, c.id);
          inserted.push(c.id);
        }
        this.sql.run(
          'INSERT INTO doc_versions (doc_version_id, doc_key, artifact_id, chunk_recipe_id, created_at) VALUES (?, ?, ?, ?, ?)',
          v.id, v.docKey, v.artifactId, v.chunkRecipeId, now,
        );
        chunks.forEach((c, ordinal) => {
          this.sql.run(
            'INSERT INTO doc_version_chunks (doc_version_id, ordinal, chunk_id, pages, block_refs) VALUES (?, ?, ?, ?, ?)',
            v.id, ordinal, c.id, JSON.stringify(c.pages), JSON.stringify(c.blockRefs),
          );
        });
        return { inserted, reused };
      });
    });
  }
  getDocVersion(id: DocVersionId): DocVersion | null {
    return guard(() => {
      const row = this.sql.get('SELECT doc_version_id, doc_key, artifact_id, chunk_recipe_id, created_at FROM doc_versions WHERE doc_version_id = ?', id);
      if (!row) return null;
      return {
        id,
        docKey: row.doc_key as DocKey,
        artifactId: row.artifact_id as ArtifactId,
        chunkRecipeId: row.chunk_recipe_id as RecipeId,
        chunkIds: this.chunkIdsOf(id),
        createdAt: row.created_at as string,
      };
    });
  }
  currentDocVersions(): DocVersion[] {
    return guard(() => {
      const rows = this.sql.all('SELECT doc_key, current_version FROM documents WHERE current_version IS NOT NULL');
      return rows
        .map((r) => ({ docKey: r.doc_key as string, version: r.current_version as DocVersionId }))
        .sort((a, b) => (a.docKey < b.docKey ? -1 : a.docKey > b.docKey ? 1 : 0))
        .map((r) => this.getDocVersion(r.version)!);
    });
  }
  setCurrentDocVersion(docKey: DocKey, v: DocVersionId): void {
    guard(() => {
      const row = this.sql.get('SELECT doc_key FROM doc_versions WHERE doc_version_id = ?', v);
      if (!row) throw notFound(`doc version ${v}`);
      if (row.doc_key !== docKey) throw invalid(`doc version ${v} belongs to ${row.doc_key as string}, not ${docKey}`);
      this.sql.run('UPDATE documents SET current_version = ? WHERE doc_key = ?', v, docKey);
    });
  }
  private chunkIdsOf(id: DocVersionId): ChunkId[] {
    return this.sql.all('SELECT chunk_id FROM doc_version_chunks WHERE doc_version_id = ? ORDER BY ordinal', id).map((r) => r.chunk_id as ChunkId);
  }

  // ---------------------------------------------------------------- items
  putItems(items: readonly AnyItem[], nodes: readonly Node[] = []): void {
    guard(() => this.transaction(() => {
      for (const n of nodes) {
        if (n.id !== nodeId(n.name)) throw invalid(`node id ${n.id} does not match nodeId(name)`);
        const cur = this.sql.get('SELECT name FROM nodes WHERE node_id = ?', n.id);
        if (cur) {
          if (cur.name !== n.name) throw new KgError('immutable_violation', `node ${n.id} exists with different content`);
        } else {
          this.sql.run('INSERT INTO nodes (node_id, name) VALUES (?, ?)', n.id, n.name);
        }
      }
      for (const it of items) {
        if (it.kind === 'chunk') throw invalid('chunks enter only through putDocVersion');
        const p = anyItemSchema.safeParse(it);
        if (!p.success) throw invalid(`bad item ${it.id}: ${p.error.issues.map((i) => i.message).join('; ')}`);
        if (it.kind === 'summary') {
          throw new KgError('not_implemented', 'summary items are not stored yet: the shared schema has no column for a summary run id');
        }
        for (const c of it.sourceChunkIds) {
          if (!this.sql.get("SELECT 1 FROM items WHERE item_id = ? AND kind = 'chunk'", c)) throw notFound(`source chunk ${c} of ${it.id}`);
        }
        if (it.recipeId && !this.sql.get('SELECT 1 FROM recipes WHERE recipe_id = ?', it.recipeId)) throw notFound(`recipe ${it.recipeId}`);
        const seenRefs = new Set<string>();
        for (const nr of it.nodes) {
          const ref = `${nr.nodeId}\u0000${nr.surface}`;
          if (seenRefs.has(ref)) throw invalid(`relation ${it.id} lists node ${nr.nodeId} with surface "${nr.surface}" twice`);
          seenRefs.add(ref);
          if (!this.sql.get('SELECT 1 FROM nodes WHERE node_id = ?', nr.nodeId)) throw notFound(`node ${nr.nodeId}`);
        }
        if (this.sql.get('SELECT 1 FROM items WHERE item_id = ?', it.id)) {
          if (json(this.readItem(it.id)) !== json(it)) throw new KgError('immutable_violation', `item ${it.id} exists with different content`);
          continue;
        }
        this.sql.run('INSERT INTO items (item_id, kind, text, recipe_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)', it.id, it.kind, it.text, it.recipeId, json(it.meta), this.clock.now());
        for (const c of it.sourceChunkIds) this.sql.run('INSERT INTO item_sources (item_id, chunk_id) VALUES (?, ?)', it.id, c);
        for (const nr of it.nodes) {
          this.sql.run('INSERT INTO relation_nodes (item_id, node_id, surface, role) VALUES (?, ?, ?, ?)', it.id, nr.nodeId, nr.surface, nr.role);
        }
      }
    }));
  }
  getItems(ids: readonly ItemId[]): AnyItem[] {
    return guard(() => ids.flatMap((id) => {
      const it = this.readItem(id);
      return it ? [it] : [];
    }));
  }
  itemsBySourceChunk(chunkIds: readonly ChunkId[]): AnyItem[] {
    return guard(() => {
      const ids = new Set<ItemId>();
      for (const c of chunkIds) for (const r of this.sql.all('SELECT item_id FROM item_sources WHERE chunk_id = ?', c)) ids.add(r.item_id as ItemId);
      return [...ids].sort().map((id) => this.readItem(id)!);
    });
  }
  /** Reads one item from its tables; null if absent. Every call builds fresh objects. */
  private readItem(id: ItemId): AnyItem | null {
    const row = this.sql.get('SELECT kind, text, recipe_id, meta FROM items WHERE item_id = ?', id);
    if (!row) return null;
    const sourceChunkIds = this.sql.all('SELECT chunk_id FROM item_sources WHERE item_id = ?', id).map((r) => r.chunk_id as ChunkId).sort();
    const base = {
      id,
      kind: row.kind as 'chunk' | 'relation',
      text: row.text as string,
      sourceChunkIds,
      recipeId: (row.recipe_id as RecipeId | null) ?? null,
      meta: parse<Record<string, Json>>(row.meta as string),
    };
    if (base.kind === 'chunk') {
      const c = this.sql.get('SELECT doc_key, section_path, occurrence, pages, block_refs FROM chunks WHERE chunk_id = ?', id)!;
      const chunk: Chunk = {
        ...base,
        kind: 'chunk',
        id: id as ChunkId,
        recipeId: null,
        docKey: c.doc_key as DocKey,
        sectionPath: parse<string[]>(c.section_path as string),
        occurrence: c.occurrence as number,
        pages: parse<number[]>(c.pages as string),
        blockRefs: parse<string[]>(c.block_refs as string),
      };
      return chunk;
    }
    // relation_nodes has no ordinal column; rowid order is the insertion order, which is the input order (see README)
    const nodes: NodeRef[] = this.sql
      .all('SELECT node_id, surface, role FROM relation_nodes WHERE item_id = ? ORDER BY rowid', id)
      .map((r) => ({ nodeId: r.node_id as NodeId, surface: r.surface as string, role: (r.role as string | null) ?? null }));
    const rel: Relation = { ...base, kind: 'relation', id: id as Relation['id'], recipeId: base.recipeId as RecipeId, nodes };
    return rel;
  }

  // ---------------------------------------------------------------- embeddings
  putSpace(sp: EmbeddingSpaceSpec): SpaceId {
    return guard(() => {
      const p = embeddingSpaceSpecSchema.safeParse(sp);
      if (!p.success) throw invalid(`bad space: ${p.error.issues.map((i) => i.message).join('; ')}`);
      validateSpace(sp);
      const id = spaceId(sp);
      if (!this.sql.get('SELECT 1 FROM embedding_spaces WHERE space_id = ?', id)) {
        this.sql.run('INSERT INTO embedding_spaces (space_id, model, dims, spec) VALUES (?, ?, ?, ?)', id, sp.model, sp.dims, json(sp));
      }
      return id;
    });
  }
  getSpace(id: SpaceId): EmbeddingSpace | null {
    return guard(() => {
      const row = this.sql.get('SELECT spec FROM embedding_spaces WHERE space_id = ?', id);
      return row ? { ...parse<EmbeddingSpaceSpec>(row.spec as string), id } : null;
    });
  }
  missingEmbeddings(space: SpaceId, itemIds: readonly ItemId[]): ItemId[] {
    return guard(() => {
      this.spaceDims(space);
      return itemIds.filter((id) => !this.sql.get('SELECT 1 FROM embeddings WHERE space_id = ? AND item_id = ?', space, id));
    });
  }
  putEmbeddings(space: SpaceId, rows: readonly { itemId: ItemId; vector: Float32Array }[]): void {
    guard(() => this.transaction(() => {
      const dims = this.spaceDims(space);
      for (const r of rows) {
        if (!this.sql.get('SELECT 1 FROM items WHERE item_id = ?', r.itemId)) throw notFound(`item ${r.itemId}`);
        if (r.vector.length !== dims) throw invalid(`vector has ${r.vector.length} dims, space has ${dims}`);
        if (this.sql.get('SELECT 1 FROM embeddings WHERE space_id = ? AND item_id = ?', space, r.itemId)) continue;
        this.sql.run('INSERT INTO embeddings (space_id, item_id, vector) VALUES (?, ?, ?)', space, r.itemId, encodeVector(r.vector));
      }
    }));
  }
  knn(q: KnnQuery): { itemId: ItemId; score: number }[] {
    return guard(() => {
      if (!this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', q.buildId)) throw notFound(`build ${q.buildId}`);
      const dims = this.spaceDims(q.space);
      if (q.vector.length !== dims) throw invalid(`query has ${q.vector.length} dims, space has ${dims}`);
      if (!Number.isInteger(q.limit) || q.limit < 1) throw invalid('limit must be a positive integer');
      const kinds = [...new Set(q.kinds)];
      if (kinds.length === 0) return [];
      // a zero-norm vector makes vec_distance_cosine return NULL; the port scores it 0
      const rows = this.sql.all<{ item_id: string; score: number }>(
        `SELECT e.item_id AS item_id, COALESCE(1 - vec_distance_cosine(e.vector, ?), 0) AS score
           FROM build_items bi
           JOIN items i ON i.item_id = bi.item_id
           JOIN embeddings e ON e.item_id = bi.item_id AND e.space_id = ?
          WHERE bi.build_id = ? AND i.kind IN (${kinds.map(() => '?').join(', ')})
          ORDER BY score DESC, e.item_id ASC
          LIMIT ?`,
        encodeVector(q.vector), q.space, q.buildId, ...kinds, q.limit,
      );
      return rows.map((r) => ({ itemId: r.item_id as ItemId, score: r.score }));
    });
  }
  /** Dimensions of a space; not_found if absent. */
  private spaceDims(space: SpaceId): number {
    const row = this.sql.get('SELECT dims FROM embedding_spaces WHERE space_id = ?', space);
    if (!row) throw notFound(`space ${space}`);
    return row.dims as number;
  }

  // ---------------------------------------------------------------- builds
  putBuild(b: Omit<Build, 'id' | 'createdAt'>): BuildId {
    return guard(() => this.transaction(() => {
      const id = buildId(b.manifest, b.itemIds);
      if (this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', id)) return id;
      if (!sortedUnique(b.itemIds)) throw invalid('build itemIds must be sorted and unique');
      for (const it of b.itemIds) if (!this.sql.get('SELECT 1 FROM items WHERE item_id = ?', it)) throw notFound(`item ${it}`);
      for (const dv of Object.values(b.manifest.docVersions)) {
        if (!this.sql.get('SELECT 1 FROM doc_versions WHERE doc_version_id = ?', dv)) throw notFound(`doc version ${dv}`);
      }
      for (const sp of b.manifest.embeddingSpaces) this.spaceDims(sp);
      for (const r of [b.manifest.searchRecipeId, ...b.manifest.derivedRecipes]) {
        if (!this.sql.get('SELECT 1 FROM recipes WHERE recipe_id = ?', r)) throw notFound(`recipe ${r}`);
      }
      if (b.parentId !== null && !this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', b.parentId)) throw notFound(`parent build ${b.parentId}`);
      for (const sp of b.manifest.embeddingSpaces) {
        const missing = b.itemIds.filter((it) => !this.sql.get('SELECT 1 FROM embeddings WHERE space_id = ? AND item_id = ?', sp, it));
        if (missing.length) throw new KgError('precondition', `${missing.length} build items lack an embedding in space ${sp}, e.g. ${missing[0]}`);
      }
      this.sql.run(
        'INSERT INTO builds (build_id, parent_id, created_at, manifest, mixed_recipes) VALUES (?, ?, ?, ?, ?)',
        id, b.parentId, this.clock.now(), json(b.manifest), b.manifest.mixedRecipes ? 1 : 0,
      );
      for (const it of b.itemIds) this.sql.run('INSERT INTO build_items (build_id, item_id) VALUES (?, ?)', id, it);
      return id;
    }));
  }
  getBuild(id: BuildId): Build | null {
    return guard(() => {
      const row = this.sql.get('SELECT parent_id, created_at, manifest FROM builds WHERE build_id = ?', id);
      if (!row) return null;
      const itemIds = this.sql.all('SELECT item_id FROM build_items WHERE build_id = ?', id).map((r) => r.item_id as ItemId).sort();
      return {
        id,
        createdAt: row.created_at as string,
        parentId: (row.parent_id as BuildId | null) ?? null,
        manifest: parse<BuildManifest>(row.manifest as string),
        itemIds,
      };
    });
  }
  currentBuild(): BuildId | null {
    return guard(() => {
      const row = this.sql.get("SELECT value FROM db_meta WHERE key = 'current_build'");
      return row ? (row.value as BuildId) : null;
    });
  }
  setCurrentBuild(id: BuildId): void {
    guard(() => {
      if (!this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', id)) throw notFound(`build ${id}`);
      this.sql.run("INSERT INTO db_meta (key, value) VALUES ('current_build', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
    });
  }
  labelBuild(name: string, id: BuildId): BuildLabel {
    return guard(() => this.transaction(() => {
      if (!this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', id)) throw notFound(`build ${id}`);
      if (name.length === 0) throw invalid('empty label');
      const cur = this.getLabel(name);
      if (cur) {
        if (cur.buildId !== id) throw new KgError('conflict', `label ${name} already names ${cur.buildId}`);
        return cur;
      }
      const createdAt = this.clock.now();
      this.sql.run('INSERT INTO build_labels (name, build_id, created_at) VALUES (?, ?, ?)', name, id, createdAt);
      return { name, buildId: id, createdAt };
    }));
  }
  getLabel(name: string): BuildLabel | null {
    return guard(() => {
      const row = this.sql.get('SELECT build_id, created_at FROM build_labels WHERE name = ?', name);
      return row ? { name, buildId: row.build_id as BuildId, createdAt: row.created_at as string } : null;
    });
  }
  staleCheck(id: BuildId): StaleReport {
    return guard(() => {
      if (!this.sql.get('SELECT 1 FROM builds WHERE build_id = ?', id)) throw notFound(`build ${id}`);
      const current = new Set(
        this.sql
          .all('SELECT dvc.chunk_id AS chunk_id FROM documents d JOIN doc_version_chunks dvc ON dvc.doc_version_id = d.current_version WHERE d.current_version IS NOT NULL')
          .map((r) => r.chunk_id as string),
      );
      const missingChunkIds = this.sql
        .all('SELECT DISTINCT s.chunk_id AS chunk_id FROM build_items bi JOIN item_sources s ON s.item_id = bi.item_id WHERE bi.build_id = ?', id)
        .map((r) => r.chunk_id as ChunkId)
        .filter((c) => !current.has(c))
        .sort();
      return { buildId: id, missingChunkIds, stale: missingChunkIds.length > 0 };
    });
  }

  // ---------------------------------------------------------------- set-level
  putMappings(run: DerivationRun, ms: readonly Mapping[]): void {
    guard(() => this.transaction(() => {
      if (!this.sql.get('SELECT 1 FROM recipes WHERE recipe_id = ?', run.recipeId)) throw notFound(`recipe ${run.recipeId}`);
      const curRun = this.sql.get('SELECT recipe_id, input_state_hash, base_build_id, created_at FROM derivation_runs WHERE run_id = ?', run.id);
      if (curRun) {
        const stored: DerivationRun = {
          id: run.id,
          recipeId: curRun.recipe_id as RecipeId,
          inputStateHash: curRun.input_state_hash as string,
          baseBuildId: (curRun.base_build_id as BuildId | null) ?? null,
          createdAt: curRun.created_at as string,
        };
        if (json(stored) !== json(run)) throw new KgError('immutable_violation', `run ${run.id} exists with different content`);
      } else {
        this.sql.run(
          'INSERT INTO derivation_runs (run_id, recipe_id, input_state_hash, base_build_id, created_at) VALUES (?, ?, ?, ?, ?)',
          run.id, run.recipeId, run.inputStateHash, run.baseBuildId, run.createdAt,
        );
      }
      for (const m of ms) {
        if (m.runId !== run.id) throw invalid(`mapping ${m.id} names run ${m.runId}, not ${run.id}`);
        const cur = this.sql.get('SELECT kind, subject, from_id, to_id, run_id, confidence, note FROM mappings WHERE mapping_id = ?', m.id);
        if (cur) {
          const stored: Mapping = {
            id: m.id as MappingId,
            kind: cur.kind as Mapping['kind'],
            subject: cur.subject as Mapping['subject'],
            fromId: cur.from_id as Mapping['fromId'],
            toId: cur.to_id as Mapping['toId'],
            runId: cur.run_id as RunId,
            confidence: (cur.confidence as number | null) ?? null,
            note: (cur.note as string | null) ?? null,
          };
          if (json(stored) !== json(m)) throw new KgError('immutable_violation', `mapping ${m.id} exists with different content`);
          continue;
        }
        this.sql.run(
          'INSERT INTO mappings (mapping_id, kind, subject, from_id, to_id, run_id, confidence, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          m.id, m.kind, m.subject, m.fromId, m.toId, m.runId, m.confidence, m.note,
        );
      }
    }));
  }

  // ---------------------------------------------------------------- transactions
  /** Runs fn atomically; a throw undoes every write inside it. Nested calls join through savepoints. */
  transaction<T>(fn: () => T): T {
    return guard(() => this.sql.transaction(fn));
  }
}

