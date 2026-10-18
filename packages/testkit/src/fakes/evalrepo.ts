import { KgError, canonicalJson, type EvalRepo, type EvalResultRecord, type EvalRunId, type EvalRunRecord, type Json } from '@kg/core';

const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);

export class InMemoryEvalRepo implements EvalRepo {
  protected runs = new Map<EvalRunId, EvalRunRecord>();
  protected res = new Map<EvalRunId, Map<string, EvalResultRecord>>();
  putRun(r: EvalRunRecord): void {
    const cur = this.runs.get(r.runId);
    if (cur && !same(cur, r)) throw new KgError('conflict', `eval run ${r.runId} exists with different content`);
    if (!cur) {
      this.runs.set(r.runId, structuredClone(r));
      this.res.set(r.runId, new Map());
    }
  }
  putResult(r: EvalResultRecord): void {
    const m = this.res.get(r.runId);
    if (!m) throw new KgError('not_found', `eval run ${r.runId}`);
    const key = `${r.questionId}\u001f${r.condition}`;
    const cur = m.get(key);
    if (cur && !same(cur, r)) throw new KgError('conflict', `result ${r.questionId}/${r.condition} exists with different content`);
    if (!cur) m.set(key, structuredClone(r));
  }
  getRun(runId: EvalRunId): EvalRunRecord | null {
    const r = this.runs.get(runId);
    return r ? structuredClone(r) : null;
  }
  results(runId: EvalRunId): EvalResultRecord[] {
    return [...(this.res.get(runId)?.values() ?? [])]
      .sort((a, b) => (a.questionId !== b.questionId ? (a.questionId < b.questionId ? -1 : 1) : a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : 0))
      .map((r) => structuredClone(r));
  }
}
