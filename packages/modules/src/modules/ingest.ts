/** Build modules: read sources, segment into chunks, embed, replay confirmed corrections, link replaced entries. */
import { isAbsolute, join } from 'node:path';
import {
  KgError,
  assignChunkIds,
  renderDocument,
  type ChunkRow,
  type JsonObject,
  type LinkDraft,
  type ModuleDef,
  type SourceEntry,
  defaultDocKey,
} from '@kg/kernel';
import { adapterFor, defaultAdapters, type LoadedDoc } from '../adapters';
import { sectionPack } from '../chunk';
import { renderChunkView } from '../chunk';
import { ArtifactStore } from '../parse/artifacts';
import { findReplacements, type Entry } from '../rules/replaces';
import { services } from '../services';

/** needs the source list; adds the loaded documents */
export const readSources: ModuleDef = {
  name: 'read-sources',
  version: '1',
  needs: ['sources'],
  adds: ['docs'],
  scope: 'per-chunk',
  async run({ state, ctx }) {
    const sv = services(ctx);
    const adapters = sv.adapters ?? defaultAdapters();
    const artifacts = sv.artifacts ?? new ArtifactStore({ dir: join(sv.baseDir ?? '.', ctx.config.artifactsDir), sidecar: null });
    const docs: LoadedDoc[] = [];
    for (const s of state.sources as SourceEntry[]) {
      const path = isAbsolute(s.path) ? s.path : join(sv.baseDir ?? '.', s.path);
      const adapterName = s.adapter ?? adapterFor(s.path);
      const adapter = adapters.get(adapterName);
      if (!adapter) throw new KgError('invalid_input', `unknown adapter ${adapterName} for ${s.path}`);
      const docKey = s.docKey ?? defaultDocKey(s.path);
      docs.push(await adapter.load({ path, docKey, meta: (s.meta ?? {}) as JsonObject }, { parseRecipe: ctx.config.parseRecipe, artifacts }));
      ctx.note(`read ${s.path}`, { adapter: adapterName, docKey });
    }
    return { patch: { docs } };
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
