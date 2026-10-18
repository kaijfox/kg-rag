/** SKELETON KgApi handlers (replaced by the Phase 2 `api` package). Logging is not here: createKgApi/runTool own it. */
import {
  KgError,
  findSearch,
  type CorpusStore,
  type EventLog,
  type IngestService,
  type KgHandlers,
  type LogReader,
  type SearchId,
  type SearchService,
} from '@kg/core';

export function createApiHandlers(d: { store: CorpusStore; log: EventLog & LogReader; search: SearchService; ingest: IngestService }): KgHandlers {
  const searchOf = (id: SearchId) => {
    const s = findSearch(d.log, id);
    if (!s) throw new KgError('not_found', `unknown search ${id}`);
    return s;
  };
  const current = () => {
    const b = d.store.currentBuild();
    if (!b) throw new KgError('precondition', 'no build: ingest something first');
    return b;
  };
  return {
    search: (ctx, r) => d.search.search(ctx, r),
    async getItems(ctx, r) {
      const buildId = r.buildId ?? current();
      const build = d.store.getBuild(buildId);
      if (!build) throw new KgError('not_found', `build ${buildId}`);
      const members = new Set<string>(build.itemIds);
      const items = d.store.getItems(r.itemIds.filter((id) => members.has(id)));
      ctx.emit('items.fetched', { itemIds: r.itemIds }, { buildId });
      return { items };
    },
    async feedback(ctx, r) {
      const s = searchOf(r.searchId);
      for (const it of r.items ?? []) if (!s.resultItemIds?.includes(it.itemId)) throw new KgError('invalid_input', `item ${it.itemId} is not a result of ${r.searchId}`);
      const e = ctx.emit('feedback', { overall: r.overall ?? null, items: r.items ?? [], note: r.note ?? null }, { searchId: r.searchId, buildId: s.buildId });
      return { eventId: e.id };
    },
    async reportUsage(ctx, r) {
      const s = searchOf(r.searchId);
      for (const id of r.itemIds) if (!s.resultItemIds?.includes(id)) throw new KgError('invalid_input', `item ${id} is not a result of ${r.searchId}`);
      const e = ctx.emit('usage', { itemIds: r.itemIds, account: r.account }, { searchId: r.searchId, buildId: s.buildId });
      return { eventId: e.id };
    },
    async reportOutcome(ctx, r) {
      const s = r.searchId ? searchOf(r.searchId) : null;
      const e = ctx.emit('outcome', { success: r.success, note: r.note }, { searchId: r.searchId ?? null, buildId: s ? s.buildId : d.store.currentBuild() });
      return { eventId: e.id };
    },
    ingest: (ctx, r) => d.ingest.ingest(ctx, r),
    async snapshotBuild(ctx, r) {
      const buildId = current();
      d.store.labelBuild(r.name, buildId);
      ctx.emit('build.labeled', { buildId, name: r.name }, { buildId });
      const stale = d.store.staleCheck(buildId);
      if (stale.stale) ctx.emit('build.stale', { buildId, missingChunkIds: stale.missingChunkIds }, { buildId });
      return { buildId, stale };
    },
    async addNote(ctx, r) {
      return { noteId: d.log.addNote(ctx.sessionId, r.text).noteId };
    },
  };
}
