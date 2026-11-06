/**
 * The index: everything a rebuild can recreate. Documents, chunks, derived items (facts and summaries) with their
 * source chunks and the names they mention, links, and embeddings. One SQLite file.
 *
 * A chunk is current when its ingest number equals its document's. Derived items are never edited; a module version
 * that changes produces new items, and `deleteMadeBy` removes the old ones when a rebuild redoes one module.
 */
import { KgError } from './errors';
import { ID_PATTERNS, canonicalJson, itemId, linkId, normName, spaceId, type Json, type JsonObject } from './ids';
import { Sql, openDb, type SqlValue } from './sqlite';
import type {
  Candidate,
  ChunkRow,
  DerivedItem,
  DerivedItemDraft,
  DocumentRow,
  EmbeddingSpace,
  EmbeddingSpaceSpec,
  LinkDraft,
  LinkRow,
  RecordKind,
} from './types';

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE documents (
  doc_key TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, source_name TEXT NOT NULL,
  parse_recipe TEXT NOT NULL, chunk_recipe TEXT NOT NULL,
  ingest_no INTEGER NOT NULL, ingested_at TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}');

CREATE TABLE chunks (
  chunk_id TEXT PRIMARY KEY, doc_key TEXT NOT NULL REFERENCES documents(doc_key),
  ordinal INTEGER NOT NULL, section_path TEXT NOT NULL, occurrence INTEGER NOT NULL, text TEXT NOT NULL,
  pages TEXT NOT NULL, block_refs TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', ingest_no INTEGER NOT NULL);
CREATE INDEX chunks_by_doc ON chunks(doc_key, ordinal);

CREATE TABLE items (
  item_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('fact', 'summary')),
  text TEXT NOT NULL CHECK (length(text) > 0), made_by TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX items_by_maker ON items(made_by);

CREATE TABLE item_sources (
  item_id TEXT NOT NULL REFERENCES items(item_id), chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id),
  PRIMARY KEY (item_id, chunk_id));
CREATE INDEX item_sources_by_chunk ON item_sources(chunk_id);

CREATE TABLE mentions (
  item_id TEXT NOT NULL REFERENCES items(item_id), name TEXT NOT NULL, surface TEXT NOT NULL, role TEXT,
  PRIMARY KEY (item_id, name, surface));
CREATE INDEX mentions_by_name ON mentions(name);

CREATE TABLE links (
  link_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('replaces', 'alias-of')),
  subject TEXT NOT NULL CHECK (subject IN ('item', 'chunk', 'name')),
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, made_by TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
  CHECK (from_id <> to_id));
CREATE INDEX links_by_from ON links(from_id);
CREATE INDEX links_by_to ON links(to_id);

CREATE TABLE embedding_spaces (space_id TEXT PRIMARY KEY, spec TEXT NOT NULL);
CREATE TABLE embeddings (
  space_id TEXT NOT NULL REFERENCES embedding_spaces(space_id), record_id TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (space_id, record_id));

CREATE TRIGGER items_insert_only BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'items are insert-only'); END;
CREATE TRIGGER item_sources_insert_only BEFORE UPDATE ON item_sources BEGIN SELECT RAISE(ABORT, 'item_sources are insert-only'); END;
CREATE TRIGGER mentions_insert_only BEFORE UPDATE ON mentions BEGIN SELECT RAISE(ABORT, 'mentions are insert-only'); END;
CREATE TRIGGER links_insert_only BEFORE UPDATE ON links BEGIN SELECT RAISE(ABORT, 'links are insert-only'); END;
`;

const CURRENT = `JOIN documents d ON d.doc_key = c.doc_key AND d.ingest_no = c.ingest_no`;
const parse = <T>(s: string): T => JSON.parse(s) as T;
const vecBlob = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

type ChunkR = { chunk_id: string; doc_key: string; ordinal: number; section_path: string; occurrence: number; text: string; pages: string; block_refs: string; meta: string };
const toChunk = (r: ChunkR): ChunkRow => ({
  id: r.chunk_id,
  docKey: r.doc_key,
  ordinal: r.ordinal,
  sectionPath: parse<string[]>(r.section_path),
  occurrence: r.occurrence,
  text: r.text,
  pages: parse<number[]>(r.pages),
  blockRefs: parse<string[]>(r.block_refs),
  meta: parse<JsonObject>(r.meta),
});

/** What modules may read. The runner, not a module, writes. */
export interface IndexReader {
  readonly indexId: string;
  getSpace(id: string): EmbeddingSpace | null;
  listDocuments(): DocumentRow[];
  getDocument(docKey: string): DocumentRow | null;
  documentUnchanged(docKey: string, sourceSha256: string, parseRecipe: JsonObject, chunkRecipe: JsonObject): boolean;
  /** the subset of these chunk IDs that belong to a document's current ingest */
  filterCurrent(chunkIds: readonly string[]): string[];
  getChunks(ids: readonly string[]): ChunkRow[];
  currentChunks(): ChunkRow[];
  /** current chunks of one document within `radius` positions of the chunk, in reading order, the chunk included */
  adjacentChunks(chunkId: string, radius: number): ChunkRow[];
  knn(space: string, query: Float32Array, k: number, kinds: readonly RecordKind[]): { id: string; kind: RecordKind; score: number }[];
  /** current chunks and items with no vector in the space; a chunk's text is the text to embed (its placeholder view) */
  recordsMissingEmbedding(space: string): { id: string; kind: RecordKind; text: string; sectionPath: string[] }[];
  getItems(ids: readonly string[]): DerivedItem[];
  /** IDs of current chunks that already have at least one derived item made by `madeBy` */
  chunksDoneBy(madeBy: string): Set<string>;
  /** items that mention any of the names (aliases are resolved first), most mentions first */
  itemsMentioning(names: readonly string[], limit?: number): { itemId: string; names: string[] }[];
  linksOf(ids: readonly string[], direction: 'from' | 'to' | 'either', kind?: LinkRow['kind']): LinkRow[];
  /** the canonical name for an alias, or the name itself */
  canonicalName(name: string): string;
  hydrate(scored: readonly { id: string; score: number }[]): Candidate[];
}

export class IndexStore implements IndexReader {
  private constructor(
    private readonly sql: Sql,
    readonly indexId: string,
    readonly path: string,
  ) {}

  /** Opens (creating if needed) an index file. A new file gets `indexId` (or "ix_unknown"). */
  static open(path: string, o: { indexId?: string } = {}): IndexStore {
    const sql = new Sql(openDb(path, [SCHEMA], { vec: true }));
    const have = sql.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'index_id'`)?.value;
    const indexId = have ?? o.indexId ?? 'ix_unknown';
    if (!have) sql.run(`INSERT INTO meta (key, value) VALUES ('index_id', ?)`, indexId);
    return new IndexStore(sql, indexId, path);
  }

  close(): void {
    this.sql.close();
  }

  /** Copies this index to a new file under a new ID (VACUUM INTO), and opens the copy. Used to redo one module's output. */
  copyAs(path: string, newIndexId: string): IndexStore {
    this.sql.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    const copy = new Sql(openDb(path, [SCHEMA], { vec: true }));
    copy.run(`UPDATE meta SET value = ? WHERE key = 'index_id'`, newIndexId);
    copy.close();
    return IndexStore.open(path);
  }

  // ---------------------------------------------------------------- spaces

  putSpace(spec: EmbeddingSpaceSpec): EmbeddingSpace {
    const id = spaceId(spec as unknown as Json);
    this.sql.run(`INSERT OR IGNORE INTO embedding_spaces (space_id, spec) VALUES (?, ?)`, id, canonicalJson(spec as unknown as Json));
    return { ...spec, id };
  }
  getSpace(id: string): EmbeddingSpace | null {
    const r = this.sql.get<{ spec: string }>(`SELECT spec FROM embedding_spaces WHERE space_id = ?`, id);
    return r ? { ...parse<EmbeddingSpaceSpec>(r.spec), id } : null;
  }

  // ---------------------------------------------------------------- documents and chunks

  listDocuments(): DocumentRow[] {
    return this.sql.all<Record<string, string | number>>(`SELECT * FROM documents ORDER BY doc_key`).map(toDoc);
  }
  getDocument(docKey: string): DocumentRow | null {
    const r = this.sql.get<Record<string, string | number>>(`SELECT * FROM documents WHERE doc_key = ?`, docKey);
    return r ? toDoc(r) : null;
  }

  /** True when the stored document has this source hash and these recipes, so loading it again would change nothing. */
  documentUnchanged(docKey: string, sourceSha256: string, parseRecipe: JsonObject, chunkRecipe: JsonObject): boolean {
    const d = this.getDocument(docKey);
    return d !== null && d.sourceSha256 === sourceSha256 && canonicalJson(d.parseRecipe) === canonicalJson(parseRecipe) && canonicalJson(d.chunkRecipe) === canonicalJson(chunkRecipe);
  }

  /**
   * Stores one document's chunks as its new current ingest. A chunk already stored (same ID) keeps its row and moves to
   * the new ingest; a chunk of the previous ingest that is absent now stays stored but stops being current.
   */
  commitDocument(
    doc: Omit<DocumentRow, 'ingestNo' | 'ingestedAt'>,
    chunks: readonly ChunkRow[],
    now: string,
  ): { ingestNo: number; inserted: number; reused: number; dropped: number } {
    return this.sql.transaction(() => {
      const before = this.getDocument(doc.docKey);
      const ingestNo = (before?.ingestNo ?? 0) + 1;
      const previous = new Set(
        this.sql.all<{ chunk_id: string }>(`SELECT chunk_id FROM chunks WHERE doc_key = ? AND ingest_no = ?`, doc.docKey, before?.ingestNo ?? -1).map((r) => r.chunk_id),
      );
      this.sql.run(
        `INSERT INTO documents (doc_key, source_sha256, source_name, parse_recipe, chunk_recipe, ingest_no, ingested_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(doc_key) DO UPDATE SET source_sha256 = excluded.source_sha256, source_name = excluded.source_name,
           parse_recipe = excluded.parse_recipe, chunk_recipe = excluded.chunk_recipe, ingest_no = excluded.ingest_no,
           ingested_at = excluded.ingested_at, meta = excluded.meta`,
        doc.docKey, doc.sourceSha256, doc.sourceName, canonicalJson(doc.parseRecipe), canonicalJson(doc.chunkRecipe), ingestNo, now, canonicalJson(doc.meta),
      );
      let inserted = 0;
      let reused = 0;
      const seen = new Set<string>();
      for (const c of chunks) {
        if (!ID_PATTERNS.chunk.test(c.id)) throw new KgError('invalid_input', `bad chunk id ${c.id}`);
        if (seen.has(c.id)) throw new KgError('invalid_input', `duplicate chunk id ${c.id} in one document`);
        seen.add(c.id);
        const exists = this.sql.get(`SELECT 1 AS x FROM chunks WHERE chunk_id = ?`, c.id);
        if (exists) {
          reused++;
          this.sql.run(`UPDATE chunks SET ordinal = ?, ingest_no = ? WHERE chunk_id = ?`, c.ordinal, ingestNo, c.id);
        } else {
          inserted++;
          this.sql.run(
            `INSERT INTO chunks (chunk_id, doc_key, ordinal, section_path, occurrence, text, pages, block_refs, meta, ingest_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            c.id, c.docKey, c.ordinal, JSON.stringify(c.sectionPath), c.occurrence, c.text, JSON.stringify(c.pages), JSON.stringify(c.blockRefs), canonicalJson(c.meta), ingestNo,
          );
        }
      }
      return { ingestNo, inserted, reused, dropped: [...previous].filter((id) => !seen.has(id)).length };
    });
  }

  filterCurrent(chunkIds: readonly string[]): string[] {
    if (chunkIds.length === 0) return [];
    const rows = this.sql.all<{ chunk_id: string }>(`SELECT c.chunk_id FROM chunks c ${CURRENT} WHERE c.chunk_id IN (${chunkIds.map(() => '?').join(',')})`, ...chunkIds);
    const ok = new Set(rows.map((r) => r.chunk_id));
    return chunkIds.filter((c) => ok.has(c));
  }

  getChunks(ids: readonly string[]): ChunkRow[] {
    if (ids.length === 0) return [];
    const rows = this.sql.all<ChunkR>(`SELECT * FROM chunks WHERE chunk_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    const by = new Map(rows.map((r) => [r.chunk_id, toChunk(r)]));
    return ids.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
  }

  currentChunks(): ChunkRow[] {
    return this.sql.all<ChunkR>(`SELECT c.* FROM chunks c ${CURRENT} ORDER BY c.doc_key, c.ordinal`).map(toChunk);
  }

  adjacentChunks(chunkId: string, radius: number): ChunkRow[] {
    const me = this.sql.get<{ doc_key: string; ordinal: number }>(`SELECT c.doc_key, c.ordinal FROM chunks c ${CURRENT} WHERE c.chunk_id = ?`, chunkId);
    if (!me) return [];
    return this.sql
      .all<ChunkR>(
        `SELECT c.* FROM chunks c ${CURRENT} WHERE c.doc_key = ? AND c.ordinal BETWEEN ? AND ? ORDER BY c.ordinal`,
        me.doc_key, me.ordinal - radius, me.ordinal + radius,
      )
      .map(toChunk);
  }

  // ---------------------------------------------------------------- embeddings

  putEmbeddings(space: string, rows: readonly { recordId: string; vector: Float32Array }[]): void {
    const spec = this.getSpace(space);
    if (!spec) throw new KgError('not_found', `embedding space ${space}`);
    this.sql.transaction(() => {
      for (const r of rows) {
        if (r.vector.length !== spec.dims) throw new KgError('invalid_input', `vector for ${r.recordId} has ${r.vector.length} dims, space has ${spec.dims}`);
        this.sql.run(`INSERT OR REPLACE INTO embeddings (space_id, record_id, vector) VALUES (?, ?, ?)`, space, r.recordId, vecBlob(r.vector));
      }
    });
  }

  /** Current chunks and current items that have no vector in the space, with what an embedder needs. */
  recordsMissingEmbedding(space: string): { id: string; kind: RecordKind; text: string; sectionPath: string[] }[] {
    const chunks = this.sql
      .all<ChunkR>(`SELECT c.* FROM chunks c ${CURRENT} WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.space_id = ? AND e.record_id = c.chunk_id) ORDER BY c.doc_key, c.ordinal`, space)
      // the text that is embedded may differ from the stored text (a chunk's formula placeholder view)
      .map((r) => ({ id: r.chunk_id, kind: 'chunk' as RecordKind, text: (parse<JsonObject>(r.meta).embedText as string | undefined) ?? r.text, sectionPath: parse<string[]>(r.section_path) }));
    const items = this.sql
      .all<{ item_id: string; kind: string; text: string }>(
        `SELECT i.item_id, i.kind, i.text FROM items i WHERE ${ITEM_IS_CURRENT} AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.space_id = ? AND e.record_id = i.item_id) ORDER BY i.item_id`,
        space,
      )
      .map((r) => ({ id: r.item_id, kind: r.kind as RecordKind, text: r.text, sectionPath: [] as string[] }));
    return [...chunks, ...items];
  }

  knn(space: string, query: Float32Array, k: number, kinds: readonly RecordKind[]): { id: string; kind: RecordKind; score: number }[] {
    const q = vecBlob(query);
    const out: { id: string; kind: RecordKind; score: number }[] = [];
    if (kinds.includes('chunk')) {
      for (const r of this.sql.all<{ id: string; score: number }>(
        `SELECT e.record_id AS id, COALESCE(1 - vec_distance_cosine(e.vector, ?), 0) AS score
         FROM embeddings e JOIN chunks c ON c.chunk_id = e.record_id ${CURRENT}
         WHERE e.space_id = ? ORDER BY score DESC, id LIMIT ?`,
        q, space, k,
      ))
        out.push({ id: r.id, kind: 'chunk', score: r.score });
    }
    const itemKinds = kinds.filter((x) => x !== 'chunk');
    if (itemKinds.length > 0) {
      for (const r of this.sql.all<{ id: string; kind: string; score: number }>(
        `SELECT e.record_id AS id, i.kind AS kind, COALESCE(1 - vec_distance_cosine(e.vector, ?), 0) AS score
         FROM embeddings e JOIN items i ON i.item_id = e.record_id
         WHERE e.space_id = ? AND i.kind IN (${itemKinds.map(() => '?').join(',')}) AND ${ITEM_IS_CURRENT}
         ORDER BY score DESC, id LIMIT ?`,
        q, space, ...itemKinds, k,
      ))
        out.push({ id: r.id, kind: r.kind as RecordKind, score: r.score });
    }
    return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, k);
  }

  // ---------------------------------------------------------------- derived items and links

  /**
   * Stores derived items and links made by one module version, in one transaction. An item with no source chunk, a source
   * that is not stored, or an unusable mention is refused with `invalid_input` and nothing is written.
   * Storing an item that exists (same ID) changes nothing.
   */
  commitDerived(madeBy: string, items: readonly DerivedItemDraft[], links: readonly LinkDraft[], now: string): { itemIds: string[]; linkIds: string[]; newItems: number } {
    return this.sql.transaction(() => {
      const itemIds: string[] = [];
      let newItems = 0;
      for (const d of items) {
        if (d.sourceChunkIds.length === 0) throw new KgError('invalid_input', `a ${d.kind} must cite at least one chunk: ${JSON.stringify(d.text.slice(0, 60))}`);
        if (d.text.trim() === '') throw new KgError('invalid_input', 'a derived item needs text');
        const sources = [...new Set(d.sourceChunkIds)].sort();
        for (const c of sources) if (!this.sql.get(`SELECT 1 AS x FROM chunks WHERE chunk_id = ?`, c)) throw new KgError('not_found', `source chunk ${c}`);
        const id = itemId(d.kind, madeBy, sources, d.text);
        itemIds.push(id);
        if (this.sql.get(`SELECT 1 AS x FROM items WHERE item_id = ?`, id)) continue;
        newItems++;
        this.sql.run(`INSERT INTO items (item_id, kind, text, made_by, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`, id, d.kind, d.text, madeBy, canonicalJson(d.meta ?? {}), now);
        for (const c of sources) this.sql.run(`INSERT INTO item_sources (item_id, chunk_id) VALUES (?, ?)`, id, c);
        for (const m of d.mentions) {
          const name = normName(m.surface);
          if (name === '') throw new KgError('invalid_input', `mention ${JSON.stringify(m.surface)} normalises to an empty name`);
          this.sql.run(`INSERT OR IGNORE INTO mentions (item_id, name, surface, role) VALUES (?, ?, ?, ?)`, id, name, m.surface, m.role ?? null);
        }
      }
      const linkIds: string[] = [];
      for (const l of links) {
        if (l.fromId === l.toId) throw new KgError('invalid_input', 'a link must join two different records');
        if (l.kind === 'alias-of' && l.subject !== 'name') throw new KgError('invalid_input', 'alias-of joins names');
        if (l.kind === 'replaces' && l.subject === 'name') throw new KgError('invalid_input', 'replaces joins items or chunks');
        const from = l.subject === 'name' ? normName(l.fromId) : l.fromId;
        const to = l.subject === 'name' ? normName(l.toId) : l.toId;
        if (from === '' || to === '') throw new KgError('invalid_input', 'link name normalises to empty');
        if (l.subject === 'item') for (const x of [from, to]) if (!this.sql.get(`SELECT 1 AS y FROM items WHERE item_id = ?`, x)) throw new KgError('not_found', `item ${x}`);
        if (l.subject === 'chunk') for (const x of [from, to]) if (!this.sql.get(`SELECT 1 AS y FROM chunks WHERE chunk_id = ?`, x)) throw new KgError('not_found', `chunk ${x}`);
        const id = linkId(l.kind, l.subject, from, to, madeBy);
        linkIds.push(id);
        this.sql.run(`INSERT OR IGNORE INTO links (link_id, kind, subject, from_id, to_id, made_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, l.kind, l.subject, from, to, madeBy, l.note ?? null, now);
      }
      return { itemIds, linkIds, newItems };
    });
  }

  /** Removes everything one module version made (items, their sources, mentions and vectors, and its links). */
  deleteMadeBy(madeBy: string): { items: number; links: number } {
    return this.sql.transaction(() => {
      const ids = this.sql.all<{ item_id: string }>(`SELECT item_id FROM items WHERE made_by = ?`, madeBy).map((r) => r.item_id);
      for (const id of ids) {
        this.sql.run(`DELETE FROM embeddings WHERE record_id = ?`, id);
        this.sql.run(`DELETE FROM mentions WHERE item_id = ?`, id);
        this.sql.run(`DELETE FROM item_sources WHERE item_id = ?`, id);
        this.sql.run(`DELETE FROM links WHERE (subject = 'item' AND (from_id = ? OR to_id = ?))`, id, id);
        this.sql.run(`DELETE FROM items WHERE item_id = ?`, id);
      }
      const links = this.sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM links WHERE made_by = ?`, madeBy)[0]!.n;
      this.sql.run(`DELETE FROM links WHERE made_by = ?`, madeBy);
      return { items: ids.length, links };
    });
  }

  getItems(ids: readonly string[]): DerivedItem[] {
    if (ids.length === 0) return [];
    const ph = ids.map(() => '?').join(',');
    const rows = this.sql.all<{ item_id: string; kind: string; text: string; made_by: string; meta: string }>(`SELECT * FROM items WHERE item_id IN (${ph})`, ...ids);
    const sources = this.sql.all<{ item_id: string; chunk_id: string }>(`SELECT item_id, chunk_id FROM item_sources WHERE item_id IN (${ph}) ORDER BY chunk_id`, ...ids);
    const mentions = this.sql.all<{ item_id: string; name: string; surface: string; role: string | null }>(`SELECT * FROM mentions WHERE item_id IN (${ph}) ORDER BY name, surface`, ...ids);
    const by = new Map(
      rows.map((r) => [
        r.item_id,
        {
          id: r.item_id,
          kind: r.kind as DerivedItem['kind'],
          text: r.text,
          madeBy: r.made_by,
          sourceChunkIds: sources.filter((s) => s.item_id === r.item_id).map((s) => s.chunk_id),
          mentions: mentions.filter((m) => m.item_id === r.item_id).map((m) => ({ name: m.name, surface: m.surface, role: m.role })),
          meta: parse<JsonObject>(r.meta),
        } satisfies DerivedItem,
      ]),
    );
    return ids.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
  }

  /** Every derived item and its maker, by the chunk it cites. Used to compare two indexes built from the same sources. */
  itemsByChunk(): Map<string, { id: string; kind: string; text: string; madeBy: string }[]> {
    const out = new Map<string, { id: string; kind: string; text: string; madeBy: string }[]>();
    for (const r of this.sql.all<{ chunk_id: string; item_id: string; kind: string; text: string; made_by: string }>(
      `SELECT s.chunk_id, i.item_id, i.kind, i.text, i.made_by FROM item_sources s JOIN items i ON i.item_id = s.item_id ORDER BY s.chunk_id, i.item_id`,
    ))
      out.set(r.chunk_id, [...(out.get(r.chunk_id) ?? []), { id: r.item_id, kind: r.kind, text: r.text, madeBy: r.made_by }]);
    return out;
  }

  chunksDoneBy(madeBy: string): Set<string> {
    return new Set(
      this.sql.all<{ chunk_id: string }>(`SELECT DISTINCT s.chunk_id FROM item_sources s JOIN items i ON i.item_id = s.item_id WHERE i.made_by = ?`, madeBy).map((r) => r.chunk_id),
    );
  }

  itemsMentioning(names: readonly string[], limit = 200): { itemId: string; names: string[] }[] {
    const norm = [...new Set(names.map((n) => this.canonicalName(n)).filter((n) => n !== ''))];
    if (norm.length === 0) return [];
    // every name that is an alias of one of these also counts
    const aliases = this.sql.all<{ from_id: string }>(
      `SELECT from_id FROM links WHERE kind = 'alias-of' AND to_id IN (${norm.map(() => '?').join(',')})`,
      ...norm,
    );
    const all = [...new Set([...norm, ...aliases.map((a) => a.from_id)])];
    const rows = this.sql.all<{ item_id: string; name: string }>(
      `SELECT m.item_id, m.name FROM mentions m JOIN items i ON i.item_id = m.item_id WHERE m.name IN (${all.map(() => '?').join(',')}) AND ${ITEM_IS_CURRENT.replace(/\bi\./g, 'i.')}`,
      ...all,
    );
    const by = new Map<string, Set<string>>();
    for (const r of rows) by.set(r.item_id, (by.get(r.item_id) ?? new Set()).add(r.name));
    return [...by.entries()]
      .map(([itemId, set]) => ({ itemId, names: [...set].sort() }))
      .sort((a, b) => b.names.length - a.names.length || (a.itemId < b.itemId ? -1 : 1))
      .slice(0, limit);
  }

  linksOf(ids: readonly string[], direction: 'from' | 'to' | 'either', kind?: LinkRow['kind']): LinkRow[] {
    if (ids.length === 0) return [];
    const ph = ids.map(() => '?').join(',');
    const where = direction === 'from' ? `from_id IN (${ph})` : direction === 'to' ? `to_id IN (${ph})` : `(from_id IN (${ph}) OR to_id IN (${ph}))`;
    const params: SqlValue[] = direction === 'either' ? [...ids, ...ids] : [...ids];
    if (kind) params.push(kind);
    return this.sql
      .all<{ link_id: string; kind: string; subject: string; from_id: string; to_id: string; made_by: string; note: string | null; created_at: string }>(
        `SELECT * FROM links WHERE ${where}${kind ? ' AND kind = ?' : ''} ORDER BY link_id`,
        ...params,
      )
      .map((r) => ({ id: r.link_id, kind: r.kind as LinkRow['kind'], subject: r.subject as LinkRow['subject'], fromId: r.from_id, toId: r.to_id, madeBy: r.made_by, note: r.note, createdAt: r.created_at }));
  }

  canonicalName(name: string): string {
    let n = normName(name);
    for (let i = 0; i < 8; i++) {
      const r = this.sql.get<{ to_id: string }>(`SELECT to_id FROM links WHERE kind = 'alias-of' AND subject = 'name' AND from_id = ? ORDER BY link_id LIMIT 1`, n);
      if (!r || r.to_id === n) break;
      n = r.to_id;
    }
    return n;
  }

  /** Items that no current chunk supports any more: the stale check. */
  staleItems(): string[] {
    return this.sql.all<{ item_id: string }>(`SELECT i.item_id FROM items i WHERE NOT (${ITEM_IS_CURRENT}) ORDER BY i.item_id`).map((r) => r.item_id);
  }

  hydrate(scored: readonly { id: string; score: number }[]): Candidate[] {
    const chunkIds = scored.filter((s) => s.id.startsWith('ch_')).map((s) => s.id);
    const itemIds = scored.filter((s) => s.id.startsWith('it_')).map((s) => s.id);
    const chunks = new Map(this.getChunks(chunkIds).map((c) => [c.id, c]));
    const items = new Map(this.getItems(itemIds).map((i) => [i.id, i]));
    return scored.flatMap((s): Candidate[] => {
      const c = chunks.get(s.id);
      if (c) return [{ id: c.id, kind: 'chunk', text: c.text, score: s.score, sourceChunkIds: [c.id], docKey: c.docKey, sectionPath: c.sectionPath, meta: c.meta }];
      const i = items.get(s.id);
      if (i) return [{ id: i.id, kind: i.kind, text: i.text, score: s.score, sourceChunkIds: i.sourceChunkIds, meta: i.meta }];
      return [];
    });
  }

  stats(): { documents: number; currentChunks: number; facts: number; summaries: number; mentions: number; links: number; embeddings: number; staleItems: number } {
    const n = (sql: string) => this.sql.get<{ n: number }>(sql)!.n;
    return {
      documents: n(`SELECT COUNT(*) AS n FROM documents`),
      currentChunks: n(`SELECT COUNT(*) AS n FROM chunks c ${CURRENT}`),
      facts: n(`SELECT COUNT(*) AS n FROM items WHERE kind = 'fact'`),
      summaries: n(`SELECT COUNT(*) AS n FROM items WHERE kind = 'summary'`),
      mentions: n(`SELECT COUNT(*) AS n FROM mentions`),
      links: n(`SELECT COUNT(*) AS n FROM links`),
      embeddings: n(`SELECT COUNT(*) AS n FROM embeddings`),
      staleItems: this.staleItems().length,
    };
  }

  /** Rule audit: derived items with no source, sources that are missing, mentions or links that point nowhere. Empty means clean. */
  audit(): string[] {
    const problems: string[] = [];
    const count = (sql: string) => this.sql.get<{ n: number }>(sql)!.n;
    const noSource = count(`SELECT COUNT(*) AS n FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_sources s WHERE s.item_id = i.item_id)`);
    if (noSource) problems.push(`${noSource} derived items cite no chunk`);
    const orphanMentions = count(`SELECT COUNT(*) AS n FROM mentions m WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = m.item_id)`);
    if (orphanMentions) problems.push(`${orphanMentions} mentions of missing items`);
    const badLinks = count(`SELECT COUNT(*) AS n FROM links l WHERE l.subject = 'item' AND (NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = l.from_id) OR NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = l.to_id))`);
    if (badLinks) problems.push(`${badLinks} links to missing items`);
    return problems;
  }
}

const ITEM_IS_CURRENT = `EXISTS (SELECT 1 FROM item_sources s JOIN chunks c ON c.chunk_id = s.chunk_id JOIN documents d ON d.doc_key = c.doc_key AND d.ingest_no = c.ingest_no WHERE s.item_id = i.item_id)`;

function toDoc(r: Record<string, string | number>): DocumentRow {
  return {
    docKey: r.doc_key as string,
    sourceSha256: r.source_sha256 as string,
    sourceName: r.source_name as string,
    parseRecipe: parse<JsonObject>(r.parse_recipe as string),
    chunkRecipe: parse<JsonObject>(r.chunk_recipe as string),
    ingestNo: r.ingest_no as number,
    ingestedAt: r.ingested_at as string,
    meta: parse<JsonObject>(r.meta as string),
  };
}
