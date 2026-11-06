/** Build modules: read sources, segment into chunks, embed, replay confirmed corrections, link replaced entries. */
import { join } from 'node:path';
import {
  KgError,
  assignChunkIds,
  renderDocument,
  type ChunkRow,
  type JsonObject,
  type LinkDraft,
  type ModuleDef,
  type SourceEntry,
} from '@kg/kernel';
import { defaultAdapters, type LoadedDoc } from '../adapters';
import { expandSources } from '../adapters/sources';
import { sectionPack } from '../chunk';
import { renderChunkView } from '../chunk';
import { ArtifactStore } from '../parse/artifacts';
import { findReplacements, type Entry } from '../rules/replaces';
import { services } from '../services';

/**
 * needs the source list; adds the loaded documents and the entries whose path does not exist. A directory entry stands for
 * the files in it, found again on every run.
 */
export const readSources: ModuleDef = {
  name: 'read-sources',
  version: '2',
  needs: ['sources'],
  adds: ['docs', 'missing'],
  scope: 'per-chunk',
  async run({ state, ctx }) {
    const sv = services(ctx);
    const adapters = sv.adapters ?? defaultAdapters();
    const base = sv.baseDir ?? '.';
    const artifacts = sv.artifacts ?? new ArtifactStore({ dir: join(base, ctx.config.artifactsDir), sidecar: null });
    const { files, missing } = expandSources(state.sources as SourceEntry[], base);
    for (const m of missing) ctx.note(`source ${m} does not exist; its documents are kept`);
    const docs: LoadedDoc[] = [];
    for (const f of files) {
      const adapter = adapters.get(f.adapter);
      if (!adapter) throw new KgError('invalid_input', `unknown adapter ${f.adapter} for ${f.path}`);
      docs.push(await adapter.load({ path: f.path, docKey: f.docKey, meta: f.meta }, { parseRecipe: ctx.config.parseRecipe, artifacts }));
    }
    ctx.note(`read ${docs.length} documents from ${(state.sources as SourceEntry[]).length} sources`);
    return { patch: { docs, missing } };
  },
};

/**
 * Stops a document from being current when its source is gone: the source entry was removed from kg.json, or the entry is
 * a directory that no longer holds the file. Only a full ingest (every configured source) retires anything, and a source
 * whose path is missing keeps its documents. Retiring cuts no data: the chunks stay stored but are not current, so
 * searches no longer return them, and the document returns if its file does.
 */
export const retireMissing: ModuleDef = {
  name: 'retire-missing',
  version: '1',
  needs: ['docs', 'missing', 'sources', 'full'],
  adds: ['retired'],
  scope: 'whole-collection',
  run({ state, ctx }) {
    if (state.full !== true) return { patch: { retired: [] } };
    const entries = (state.sources as SourceEntry[]).map((s) => s.path);
    const missing = new Set(state.missing as string[]);
    const loaded = new Set((state.docs as LoadedDoc[]).map((d) => d.docKey));
    const documents: NonNullable<import('@kg/kernel').Writes['documents']> = [];
    for (const d of ctx.index.listDocuments()) {
      const source = d.meta.source;
      if (d.meta.retired === true || typeof source !== 'string') continue;
      const entryGone = !entries.includes(source);
      const fileGone = !entryGone && !missing.has(source) && !loaded.has(d.docKey);
      if (!entryGone && !fileGone) continue;
      ctx.note(`retired ${d.docKey}: ${entryGone ? 'its source was removed from the list' : 'its file is no longer in the directory'}`);
      documents.push({
        doc: { docKey: d.docKey, sourceSha256: d.sourceSha256, sourceName: d.sourceName, parseRecipe: d.parseRecipe, chunkRecipe: d.chunkRecipe, meta: { ...d.meta, retired: true } },
        chunks: [],
      });
    }
    return { patch: { retired: documents.map((x) => x.doc.docKey) }, writes: documents.length ? { documents } : {} };
  },
};

/** needs the loaded documents; stores each changed document's chunks as its new current ingest */
export const segment: ModuleDef = {
  name: 'segment',
  version: '1',
  needs: ['docs'],
  adds: ['segmented'],
  scope: 'per-chunk',
  run({ state, ctx }) {
    const documents: NonNullable<import('@kg/kernel').Writes['documents']> = [];
    const report: { docKey: string; chunks: number; unchanged: boolean }[] = [];
    for (const d of state.docs as LoadedDoc[]) {
      const chunkRecipe = d.chunkRecipe ?? ctx.config.chunkRecipe;
      if (ctx.index.documentUnchanged(d.docKey, d.sourceSha256, d.parseRecipe, chunkRecipe)) {
        report.push({ docKey: d.docKey, chunks: 0, unchanged: true });
        continue;
      }
      let rows: ChunkRow[];
      if (d.artifact) {
        rows = sectionPack(d.artifact, d.docKey, chunkRecipe).map((c, i) => {
          const view = renderChunkView(d.artifact!, c.blockRefs, c.text, 'placeholder');
          return { id: c.id, docKey: d.docKey, ordinal: i, sectionPath: c.sectionPath, occurrence: c.occurrence, text: c.text, pages: c.pages, blockRefs: c.blockRefs, meta: (view === c.text ? {} : { embedText: view }) as JsonObject };
        });
      } else if (d.pieces) {
        rows = assignChunkIds(d.docKey, d.pieces.map((p) => ({ sectionPath: p.sectionPath, text: p.text, meta: p.meta ?? {} }))).map((c, i) => ({
          id: c.id, docKey: d.docKey, ordinal: i, sectionPath: c.sectionPath, occurrence: c.occurrence, text: c.text, pages: [], blockRefs: [], meta: c.meta,
        }));
      } else throw new KgError('internal', `document ${d.docKey} has neither a parsed artifact nor pieces`);
      documents.push({ doc: { docKey: d.docKey, sourceSha256: d.sourceSha256, sourceName: d.sourceName, parseRecipe: d.parseRecipe, chunkRecipe, meta: d.meta }, chunks: rows });
      report.push({ docKey: d.docKey, chunks: rows.length, unchanged: false });
    }
    return { patch: { segmented: report }, writes: { documents } };
  },
};

/** embeds every current chunk and fact that lacks a vector in the space */
export const embedRecords: ModuleDef<{ batchSize?: number }> = {
  name: 'embed-records',
  version: '1',
  needs: ['segmented'],
  adds: ['embedded'],
  scope: 'per-chunk',
  async run({ settings, ctx }) {
    const { embedder, space } = services(ctx);
    const missing = ctx.index.recordsMissingEmbedding(space.id);
    const texts = missing.map((r) => {
      let sectionPath = r.sectionPath;
      if (r.kind !== 'chunk') {
        const item = ctx.index.getItems([r.id])[0];
        sectionPath = item ? (ctx.index.getChunks([item.sourceChunkIds[0]!])[0]?.sectionPath ?? []) : [];
      }
      return renderDocument(space, { text: r.text, sectionPath });
    });
    const rows: { recordId: string; vector: Float32Array }[] = [];
    const size = settings.batchSize ?? 32;
    for (let i = 0; i < texts.length; i += size) {
      const vectors = await embedder.embed(texts.slice(i, i + size));
      vectors.forEach((v, j) => rows.push({ recordId: missing[i + j]!.id, vector: v }));
    }
    ctx.note(`embedded ${rows.length} records`);
    return { patch: { embedded: rows.length }, writes: rows.length ? { embeddings: [{ spaceId: space.id, rows }] } : {} };
  },
};

/** replays corrections that a person confirmed (stored in the history) as links in the new index */
export const replayCorrections: ModuleDef = {
  name: 'replay-corrections',
  version: '1',
  needs: ['segmented'],
  adds: ['corrected'],
  scope: 'whole-collection',
  run({ ctx }) {
    const links: LinkDraft[] = [];
    let skipped = 0;
    for (const c of services(ctx).corrections ?? []) {
      if (c.kind === 'alias-of' && c.subject === 'name') links.push({ kind: 'alias-of', subject: 'name', fromId: c.fromKey, toId: c.toKey, note: c.note });
      else if (c.kind === 'replaces' && c.subject === 'chunk') {
        if (ctx.index.getChunks([c.fromKey, c.toKey]).length === 2) links.push({ kind: 'replaces', subject: 'chunk', fromId: c.fromKey, toId: c.toKey, note: c.note });
        else skipped++;
      }
    }
    if (skipped) ctx.note(`${skipped} confirmed replacements name chunks that no longer exist`);
    return { patch: { corrected: links.length }, writes: links.length ? { derived: { items: [], links } } : {} };
  },
};

/** links dated entries that say they replace an earlier entry (see rules/replaces.ts) */
export const linkReplaces: ModuleDef = {
  name: 'link-replaces',
  version: '1',
  needs: ['segmented'],
  adds: ['linked'],
  scope: 'whole-collection',
  run({ ctx }) {
    const entries: Entry[] = ctx.index
      .currentChunks()
      .filter((c) => typeof c.meta.entryKey === 'string')
      .map((c) => ({ id: c.id, key: c.meta.entryKey as string, date: (c.meta.date as string | null) ?? null, title: (c.meta.title as string) ?? '', text: c.text }));
    const { found, skipped } = findReplacements(entries);
    for (const s of skipped) ctx.note(`skipped ${s.entry}: ${s.reason}`, { sentence: s.sentence });
    const links: LinkDraft[] = found.map((f) => ({ kind: 'replaces', subject: 'chunk', fromId: f.newer.id, toId: f.older.id, note: f.sentence }));
    ctx.note(`${links.length} replacements found in ${entries.length} entries`);
    return { patch: { linked: links.length }, writes: links.length ? { derived: { items: [], links } } : {} };
  },
};
