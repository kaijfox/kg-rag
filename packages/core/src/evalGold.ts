/**
 * orphanedGold (S4, R-28): questions whose gold chunks are not members of a build. After re-chunking, an eval
 * set pinned to old chunk IDs would otherwise read recall 0 silently (Rules 5 and 6); the eval runner must report
 * these and the design says their questions are regenerated.
 */
import { KgError } from './errors';
import type { BuildId, ChunkId } from './ids';
import type { EvalSet } from './model';
import type { CorpusStore } from './ports/store';

export interface OrphanedGold {
  questionId: string;
  /** gold chunk IDs that are not items of the build, sorted */
  missing: ChunkId[];
  /** true when no gold chunk of the question is in the build */
  allMissing: boolean;
}

export function orphanedGold(set: Pick<EvalSet, 'questions'>, store: Pick<CorpusStore, 'getBuild'>, build: BuildId): OrphanedGold[] {
  const b = store.getBuild(build);
  if (!b) throw new KgError('not_found', `build ${build}`);
  const members = new Set<string>(b.itemIds);
  return set.questions.flatMap((q) => {
    const missing = q.goldChunkIds.filter((c) => !members.has(c)).sort();
    return missing.length ? [{ questionId: q.id, missing, allMissing: missing.length === q.goldChunkIds.length }] : [];
  });
}
