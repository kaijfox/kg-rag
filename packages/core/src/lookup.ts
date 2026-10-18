/**
 * The one definition of "the build of a search" (Rule 6): feedback, usage and outcome copy the buildId of
 * the referenced search's `query` event, so they stay correct even if the current build changed since.
 */
import type { BuildId, ItemId, SearchId, SessionId } from './ids';
import type { LogReader } from './ports/log';

export interface SearchRecord {
  searchId: SearchId;
  sessionId: SessionId;
  buildId: BuildId;
  /** item IDs of the search.result event in rank order; null if the search has no result event (failed or cut off) */
  resultItemIds: ItemId[] | null;
}

export function findSearch(reader: Pick<LogReader, 'eventsBySearch'>, searchId: SearchId): SearchRecord | null {
  const evs = reader.eventsBySearch(searchId);
  const q = evs.find((e) => e.type === 'query');
  if (!q || q.buildId === null) return null;
  const r = evs.find((e) => e.type === 'search.result');
  return {
    searchId,
    sessionId: q.sessionId,
    buildId: q.buildId,
    resultItemIds: r && r.type === 'search.result' ? r.payload.items.map((i) => i.itemId) : null,
  };
}
