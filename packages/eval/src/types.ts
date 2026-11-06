import type { RecordKind } from '@kg/kernel';

export type QuestionType = 'single-hop' | 'multi-hop' | 'topic' | 'exact-term';

export type EvalQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  referenceAnswer: string;
  /** unique, sorted */
  goldChunkIds: string[];
  /** gold passages verbatim, so a cross-corpus run needs no access to the source index */
  goldText: string[];
  sourceDocKeys: string[];
};
/** Stored as JSON; id = evalSetId(questions). */
export type EvalSet = { id: string; name: string; genRecipeId: string | null; questions: EvalQuestion[] };
export type QuestionDraft = Omit<EvalQuestion, 'id'>;
export type JudgeVerdict = { score: number; rationale: string; raw: string };

/** A ranked result as the metrics see it: the kind and the source chunks of one record, in rank order. */
export interface RankedSource {
  id: string;
  kind: RecordKind;
  sourceChunkIds: readonly string[];
}
