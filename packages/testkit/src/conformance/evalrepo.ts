import { expect } from 'vitest';
import type { BuildId, EvalRepo, EvalResultRecord, EvalRunId, EvalRunRecord, EvalSetId, SessionId } from '@kg/core';
import { expectKgError, type Suite } from './harness';

const RUN: EvalRunRecord = {
  runId: 'er_00000000000000000000000001' as EvalRunId,
  evalSetId: 'qs_aaaaaaaaaaaaaaaaaaaa' as EvalSetId,
  evalSetSha256: 'a'.repeat(64),
  buildId: 'bd_aaaaaaaaaaaaaaaaaaaa' as BuildId,
  sessionId: 'se_00000000000000000000000001' as SessionId,
  config: { k: [1, 5, 10] },
  createdAt: '2026-10-17T12:00:00.000Z',
};
const res = (questionId: string, condition: string, judgeScore: number | null = null): EvalResultRecord => ({
  runId: RUN.runId,
  questionId,
  condition,
  searchId: null,
  retrieved: null,
  recall: null,
  answer: null,
  judgeScore,
  judgeRaw: null,
});

export function evalRepoConformance(make: () => EvalRepo): Suite {
  return {
    name: 'evalRepoConformance',
    cases: [
      {
        name: 'putRun is idempotent and getRun round-trips',
        run() {
          const r = make();
          r.putRun(RUN);
          r.putRun(structuredClone(RUN));
          expect(r.getRun(RUN.runId)).toEqual(RUN);
          expect(r.getRun('er_00000000000000000000000009' as EvalRunId)).toBeNull();
        },
      },
      {
        name: 'putRun with the same id and different content is a conflict',
        async run() {
          const r = make();
          r.putRun(RUN);
          await expectKgError(() => r.putRun({ ...RUN, config: { k: [1] } }), 'conflict');
        },
      },
      {
        name: 'putResult needs an existing run (not_found)',
        async run() {
          await expectKgError(() => make().putResult(res('q1', 'retrieved')), 'not_found');
        },
      },
      {
        name: 'results are insert-only: identical repeat is a no-op, different content is a conflict',
        async run() {
          const r = make();
          r.putRun(RUN);
          r.putResult(res('q1', 'retrieved', 0.5));
          r.putResult(res('q1', 'retrieved', 0.5));
          await expectKgError(() => r.putResult(res('q1', 'retrieved', 1)), 'conflict');
          expect(r.results(RUN.runId)).toEqual([res('q1', 'retrieved', 0.5)]);
        },
      },
      {
        name: 'results are sorted by questionId, then condition',
        run() {
          const r = make();
          r.putRun(RUN);
          for (const [q, c] of [['q2', 'gold'], ['q1', 'retrieved'], ['q1', 'gold'], ['q10', 'no-context']] as const) r.putResult(res(q, c));
          expect(r.results(RUN.runId).map((x) => `${x.questionId}/${x.condition}`)).toEqual(['q1/gold', 'q1/retrieved', 'q10/no-context', 'q2/gold']);
        },
      },
    ],
  };
}
