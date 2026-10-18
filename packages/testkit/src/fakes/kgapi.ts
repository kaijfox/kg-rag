/**
 * FakeKgApi: scripted domain behaviour, real logging. It is built with core's createKgApi, so every call goes
 * through the canonical runTool, the same path the real `api` package uses.
 */
import {
  KgError,
  createKgApi,
  findSearch,
  type AnyItem,
  type BuildId,
  type Clock,
  type IdGen,
  type IngestReport,
  type KgApi,
  type KgHandlers,
  type StaleReport,
  type ToolRuntime,
} from '@kg/core';
import { InMemoryEventLog } from './eventlog';
import { FixedClock, SeqIds } from './infra';
import { ScriptedSearchService, type ScriptedHit } from './search';

export interface FakeKgApiScript {
  buildId: BuildId;
  items: readonly AnyItem[];
  /** query text -> hits */
  searches: Record<string, readonly ScriptedHit[]>;
  /** build -> member item IDs (default: every scripted item is a member of every build the fake knows) */
  members?: Record<string, readonly string[]>;
  /** returned by ingest; ingest is not_implemented when absent */
  ingestReport?: IngestReport;
  stale?: StaleReport;
}

export interface FakeKgApiParts {
  api: KgApi;
  log: InMemoryEventLog;
  runtime: ToolRuntime;
  /** switch the scripted current build (to test Rule 6 propagation) */
  setBuild(b: BuildId): BuildId;
}

export function fakeHandlers(script: FakeKgApiScript, log: InMemoryEventLog, current: { build: BuildId }): KgHandlers {
  const search = new ScriptedSearchService(script.searches, () => current.build);
  const items = new Map(script.items.map((i) => [i.id, i]));
  const labels = new Map<string, BuildId>();
  const requireSearch = (searchId: Parameters<typeof findSearch>[1]) => {
    const s = findSearch(log, searchId);
    if (!s) throw new KgError('not_found', `unknown search ${searchId}`);
    return s;
  };
  return {
    search: (ctx, r) => search.search(ctx, r),
    async getItems(ctx, r) {
      const buildId = r.buildId ?? current.build;
      const known = script.members ? Object.keys(script.members) : [script.buildId, current.build];
      if (!known.includes(buildId)) throw new KgError('not_found', `build ${buildId}`);
      const members = script.members ? new Set(script.members[buildId]) : null;
      const found = r.itemIds.flatMap((id) => (items.has(id) && (!members || members.has(id)) ? [structuredClone(items.get(id)!)] : []));
      ctx.emit('items.fetched', { itemIds: r.itemIds }, { buildId });
      return { items: found };
    },
    async feedback(ctx, r) {
      const s = requireSearch(r.searchId);
      for (const it of r.items ?? []) {
        if (!s.resultItemIds?.includes(it.itemId)) throw new KgError('invalid_input', `item ${it.itemId} is not a result of ${r.searchId}`);
      }
      const e = ctx.emit('feedback', { overall: r.overall ?? null, items: r.items ?? [], note: r.note ?? null }, { searchId: r.searchId, buildId: s.buildId });
      return { eventId: e.id };
    },
    async reportUsage(ctx, r) {
      const s = requireSearch(r.searchId);
      for (const id of r.itemIds) if (!s.resultItemIds?.includes(id)) throw new KgError('invalid_input', `item ${id} is not a result of ${r.searchId}`);
      const e = ctx.emit('usage', { itemIds: r.itemIds, account: r.account }, { searchId: r.searchId, buildId: s.buildId });
      return { eventId: e.id };
    },
    async reportOutcome(ctx, r) {
      const s = r.searchId ? requireSearch(r.searchId) : null;
      const e = ctx.emit('outcome', { success: r.success, note: r.note }, { searchId: r.searchId ?? null, buildId: s ? s.buildId : current.build });
      return { eventId: e.id };
    },
    async ingest() {
      if (!script.ingestReport) throw new KgError('not_implemented', 'FakeKgApi has no scripted ingest');
      if (script.ingestReport.buildChanged) current.build = script.ingestReport.buildId;
      return structuredClone(script.ingestReport);
    },
    async snapshotBuild(ctx, r) {
      const prev = labels.get(r.name);
      if (prev && prev !== current.build) throw new KgError('conflict', `label ${r.name} already names ${prev}`);
      labels.set(r.name, current.build);
      ctx.emit('build.labeled', { buildId: current.build, name: r.name }, { buildId: current.build });
      const stale = script.stale ?? { buildId: current.build, missingChunkIds: [], stale: false };
      if (stale.stale) ctx.emit('build.stale', { buildId: current.build, missingChunkIds: stale.missingChunkIds }, { buildId: current.build });
      return { buildId: current.build, stale };
    },
    async addNote(ctx, r) {
      return { noteId: log.addNote(ctx.sessionId, r.text).noteId };
    },
  };
}

export function fakeKgApi(script: FakeKgApiScript, o: { clock?: Clock; ids?: IdGen } = {}): FakeKgApiParts {
  const clock = o.clock ?? new FixedClock();
  const ids = o.ids ?? new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const current = { build: script.buildId };
  const runtime: ToolRuntime = { log, clock, ids, currentBuild: () => current.build };
  return {
    api: createKgApi(runtime, fakeHandlers(script, log, current)),
    log,
    runtime,
    setBuild: (b) => (current.build = b),
  };
}
