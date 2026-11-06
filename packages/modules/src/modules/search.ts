/** Search modules: each reads and adds slots of one request. None writes to the index. */
import { KgError, renderQuery, type Candidate, type ModuleDef, type RecordKind } from '@kg/kernel';
import { services } from '../services';

const byScore = (a: Candidate, b: Candidate) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const embedQuery: ModuleDef = {
  name: 'embed-query',
  version: '1',
  needs: ['query'],
  adds: ['queryVector'],
  scope: 'request',
  async run({ state, ctx }) {
    const { embedder, space } = services(ctx);
    const [v] = await embedder.embed([renderQuery(space, state.query as string)]);
    if (!v) throw new KgError('upstream', 'the embedder returned no vector');
    return { patch: { queryVector: v } };
  },
};

function nearest(name: string, kinds: readonly RecordKind[]): ModuleDef<{ pool?: number }> {
  return {
    name,
    version: '1',
    needs: ['queryVector', 'k'],
    adds: ['candidates'],
    scope: 'request',
    run({ state, settings, ctx }) {
      const { space } = services(ctx);
      const k = state.k as number;
      const pool = Math.max(settings.pool ?? 50, k);
      const hits = ctx.index.knn(space.id, state.queryVector as Float32Array, pool, kinds);
      return { patch: { candidates: ctx.index.hydrate(hits) } };
    },
  };
}
export const nearestChunks = nearest('nearest-chunks', ['chunk']);
export const nearestFacts = nearest('nearest-facts', ['fact', 'summary']);
export const nearestAll = nearest('nearest-all', ['chunk', 'fact', 'summary']);

/**
 * Adds facts that share a name with the best facts. A neighbour's score is `decay` times the score of the best seed that
 * shares a name with it, so a neighbour never outranks the seed it came from.
 */
export const expandByNames: ModuleDef<{ seeds?: number; decay?: number; limit?: number }> = {
  name: 'expand-by-names',
  version: '1',
  needs: ['candidates'],
  adds: ['candidates'],
  scope: 'request',
  run({ state, settings, ctx }) {
    const cands = state.candidates as Candidate[];
    const seeds = cands.filter((c) => c.kind === 'fact' || c.kind === 'summary').slice(0, settings.seeds ?? 5);
    const decay = settings.decay ?? 0.5;
    const have = new Map(cands.map((c) => [c.id, c]));
    const seedNames = new Map(ctx.index.getItems(seeds.map((s) => s.id)).map((i) => [i.id, i.mentions.map((m) => m.name)]));
    const names = [...new Set([...seedNames.values()].flat())];
    const found = ctx.index.itemsMentioning(names, settings.limit ?? 40).filter((x) => !have.has(x.itemId));
    const score = new Map<string, number>();
    for (const f of found) {
      let best = 0;
      for (const s of seeds) if ((seedNames.get(s.id) ?? []).some((n) => f.names.includes(ctx.index.canonicalName(n)) || f.names.includes(n))) best = Math.max(best, s.score);
      score.set(f.itemId, best * decay);
    }
    const added = ctx.index.hydrate([...score.entries()].map(([id, s]) => ({ id, score: s })));
    ctx.note(`${seeds.length} seed facts, ${names.length} names, ${added.length} neighbours added`);
    return { patch: { candidates: [...cands, ...added].sort(byScore) } };
  },
};

/** Replaces each fact or summary by the chunks it cites, scored by the best record that cites the chunk. */
export const citeChunks: ModuleDef = {
  name: 'cite-chunks',
  version: '1',
  needs: ['candidates'],
  adds: ['candidates'],
  scope: 'request',
  run({ state, ctx }) {
    const best = new Map<string, number>();
    for (const c of state.candidates as Candidate[]) for (const id of c.sourceChunkIds) best.set(id, Math.max(best.get(id) ?? 0, c.score));
    return { patch: { candidates: ctx.index.hydrate([...best.entries()].map(([id, score]) => ({ id, score }))).sort(byScore) } };
  },
};

/** Drops records whose every source chunk has been replaced by a later current chunk, and facts replaced by a later fact. */
export const dropReplaced: ModuleDef = {
  name: 'drop-replaced',
  version: '1',
  needs: ['candidates'],
  adds: ['candidates'],
  scope: 'request',
  run({ state, ctx }) {
    const cands = state.candidates as Candidate[];
    const chunkIds = [...new Set(cands.flatMap((c) => c.sourceChunkIds))];
    const chunkLinks = ctx.index.linksOf(chunkIds, 'to', 'replaces').filter((l) => l.subject === 'chunk');
    const newer = new Set(ctx.index.filterCurrent(chunkLinks.map((l) => l.fromId)));
    const replacedChunks = new Set(chunkLinks.filter((l) => newer.has(l.fromId)).map((l) => l.toId));
    const itemIds = cands.filter((c) => c.kind !== 'chunk').map((c) => c.id);
    const replacedItems = new Set(ctx.index.linksOf(itemIds, 'to', 'replaces').filter((l) => l.subject === 'item').map((l) => l.toId));
    const kept = cands.filter((c) => !replacedItems.has(c.id) && !c.sourceChunkIds.every((s) => replacedChunks.has(s)));
    ctx.note(`${cands.length - kept.length} of ${cands.length} candidates are replaced by a later entry`, { dropped: cands.filter((c) => !kept.includes(c)).map((c) => c.id) });
    return { patch: { candidates: kept } };
  },
};

/** Adds the chunks next to the best chunks, scored at `decay` times the neighbour's seed. */
export const adjacentChunks: ModuleDef<{ seeds?: number; radius?: number; decay?: number }> = {
  name: 'adjacent-chunks',
  version: '1',
  needs: ['candidates'],
  adds: ['candidates'],
  scope: 'request',
  run({ state, settings, ctx }) {
    const cands = state.candidates as Candidate[];
    const have = new Set(cands.map((c) => c.id));
    const extra = new Map<string, number>();
    for (const s of cands.filter((c) => c.kind === 'chunk').slice(0, settings.seeds ?? 3))
      for (const n of ctx.index.adjacentChunks(s.id, settings.radius ?? 1)) if (!have.has(n.id)) extra.set(n.id, Math.max(extra.get(n.id) ?? 0, s.score * (settings.decay ?? 0.9)));
    const added = ctx.index.hydrate([...extra.entries()].map(([id, score]) => ({ id, score })));
    return { patch: { candidates: [...cands, ...added].sort(byScore) } };
  },
};

export const keepTopK: ModuleDef = {
  name: 'keep-top-k',
  version: '1',
  needs: ['candidates', 'k'],
  adds: ['results'],
  scope: 'request',
  run({ state }) {
    return { patch: { results: (state.candidates as Candidate[]).slice(0, state.k as number) } };
  },
};
