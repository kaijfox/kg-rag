/**
 * @kg/api: the handlers behind the KgApi tool contract. Logging is not done here: core's createKgApi (runTool)
 * writes tool.called, tool.returned and tool.failed around every handler, so a handler only emits domain events
 * through ctx.emit and returns its output.
 */
import {
  createKgApi,
  findSearch,
  KgError,
  type BuildId,
  type CorpusStore,
  type EventLog,
  type ItemId,
  type SearchId,
  type IngestService,
  type KgApi,
  type KgHandlers,
  type LogReader,
  type SearchService,
  type ToolRuntime,
} from '@kg/core';

export interface ApiDeps {
  store: CorpusStore;
  log: EventLog & LogReader;
  search: SearchService;
  ingest: IngestService;
}

export function createApiHandlers(d: ApiDeps): KgHandlers {
  const { store, log, search, ingest } = d;

  /** The build a search was run on, or not_found when the search is unknown (or has no query event). */
  const searchOrFail = (searchId: SearchId) => {
    const rec = findSearch(log, searchId);
    if (!rec) throw new KgError('not_found', `unknown search ${searchId}`);
    return rec;
  };

  const requireResultItems = (resultItemIds: ItemId[] | null, itemIds: ItemId[], searchId: SearchId) => {
    const returned = new Set<string>(resultItemIds ?? []);
    for (const id of itemIds) {
      if (!returned.has(id)) throw new KgError('invalid_input', `item ${id} was not returned by search ${searchId}`);
    }
  };

  return {
    async search(ctx, r) {
      return search.search(ctx, r);
    },

    async getItems(ctx, r) {
      const build: BuildId | null = r.buildId ?? store.currentBuild();
      if (build === null) throw new KgError('precondition', 'getItems: no current build and no buildId given');
      const b = store.getBuild(build);
      if (!b) throw new KgError('not_found', `unknown build ${build}`);
      const members = new Set<string>(b.itemIds);
      const items = store.getItems(r.itemIds).filter((i) => members.has(i.id));
      ctx.emit('items.fetched', { itemIds: r.itemIds }, { buildId: build });
      return { items };
    },

    async feedback(ctx, r) {
      const rec = searchOrFail(r.searchId);
      requireResultItems(rec.resultItemIds, (r.items ?? []).map((i) => i.itemId), r.searchId);
      const ev = ctx.emit(
        'feedback',
        { overall: r.overall ?? null, items: r.items ?? [], note: r.note ?? null },
        { searchId: r.searchId, buildId: rec.buildId },
      );
      return { eventId: ev.id };
    },

    async reportUsage(ctx, r) {
      const rec = searchOrFail(r.searchId);
      requireResultItems(rec.resultItemIds, r.itemIds, r.searchId);
      const ev = ctx.emit('usage', { itemIds: r.itemIds, account: r.account }, { searchId: r.searchId, buildId: rec.buildId });
      return { eventId: ev.id };
    },

    async reportOutcome(ctx, r) {
      if (r.searchId !== undefined) {
        const rec = searchOrFail(r.searchId);
        const ev = ctx.emit('outcome', { success: r.success, note: r.note }, { searchId: r.searchId, buildId: rec.buildId });
        return { eventId: ev.id };
      }
      const ev = ctx.emit('outcome', { success: r.success, note: r.note });
      return { eventId: ev.id };
    },

    async ingest(ctx, r) {
      return ingest.ingest(ctx, r);
    },

    async snapshotBuild(ctx, r) {
      const build = store.currentBuild();
      if (build === null) throw new KgError('precondition', 'snapshotBuild: no current build');
      store.labelBuild(r.name, build);
      ctx.emit('build.labeled', { buildId: build, name: r.name }, { buildId: build });
      const stale = store.staleCheck(build);
      if (stale.stale) ctx.emit('build.stale', { buildId: build, missingChunkIds: stale.missingChunkIds }, { buildId: build });
      return { buildId: build, stale };
    },

    async addNote(ctx, r) {
      const note = log.addNote(ctx.sessionId, r.text);
      return { noteId: note.noteId };
    },
  };
}

/** The full tool surface: a KgApi whose every method goes through core's logging path. */
export function createApi(rt: ToolRuntime, d: ApiDeps): KgApi {
  return createKgApi(rt, createApiHandlers(d));
}
