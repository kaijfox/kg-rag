import { describe, expect, it } from 'vitest';
import { KgError, type EvalQuestion, type EvalSet } from '@kg/core';
import { evalFixture } from '@kg/testkit';
import { allGoldAtK, recallAtK, retrievalMetrics, judgeMeans, type RankedSource } from '../src/index';

type Retrieval = { itemId: string; kind: RankedSource['kind']; sourceChunkIds: string[]; rank: number };
const set = evalFixture<EvalSet>('mini-set');
const retrievals = evalFixture<{ retrievals: Record<string, Retrieval[]> }>('retrievals').retrievals;
const expected = evalFixture<{
  ks: number[];
  perQuestion: Record<string, { recall: Record<string, number>; allGold: Record<string, number>; withSummaries: Record<string, number> }>;
  overall: { recall: Record<string, number>; withSummaries: Record<string, number> };
  byType: Record<string, { n: number; recall: Record<string, number>; allGold: Record<string, number> }>;
  judge: { byCondition: Record<string, number>; ceilingGapByType: Record<string, number> };
}>('expected-metrics');
const verdicts = evalFixture<{ questionId: string; condition: string; score: number }[]>('judge-verdicts');

const ranked = (id: string): RankedSource[] => retrievals[id]!.sort((a, b) => a.rank - b.rank);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9);

describe('retrieval metrics against the hand-computed expectations', () => {
  const m = retrievalMetrics(set.questions, (id) => ranked(id), expected.ks);

  it('per question recall, allGold and withSummaries match expected-metrics.json', () => {
    for (const [id, exp] of Object.entries(expected.perQuestion)) {
      for (const k of expected.ks) {
        close(m.perQuestion[id]!.recall[String(k)]!, exp.recall[String(k)]!);
        close(m.perQuestion[id]!.allGold[String(k)]!, exp.allGold[String(k)]!);
        close(m.perQuestion[id]!.withSummaries[String(k)]!, exp.withSummaries[String(k)]!);
      }
    }
  });

  it('overall recall and withSummaries match', () => {
    for (const k of expected.ks) {
      close(m.overall.recall[String(k)]!, expected.overall.recall[String(k)]!);
      close(m.overall.withSummaries[String(k)]!, expected.overall.withSummaries[String(k)]!);
    }
  });

  it('by type matches for the keys the fixture names', () => {
    for (const [t, exp] of Object.entries(expected.byType)) {
      expect(m.byType[t]!.n).toBe(exp.n);
      for (const [k, v] of Object.entries(exp.recall)) close(m.byType[t]!.recall[k]!, v);
      for (const [k, v] of Object.entries(exp.allGold)) close(m.byType[t]!.allGold[k]!, v);
    }
  });

  it('judge means by condition and the ceiling gap by type match', () => {
    const means = judgeMeans(verdicts.map((v) => ({ condition: v.condition, score: v.score })));
    for (const [c, v] of Object.entries(expected.judge.byCondition)) close(means[c]!, v);
    const byType = (c: string) => {
      const out: Record<string, number> = {};
      for (const t of ['single-hop', 'multi-hop', 'topic']) {
        const qs = set.questions.filter((x) => x.type === t).map((x) => x.id);
        const xs = verdicts.filter((v) => v.condition === c && qs.includes(v.questionId)).map((v) => v.score);
        out[t] = xs.reduce((a, b) => a + b, 0) / xs.length;
      }
      return out;
    };
    const gold = byType('gold');
    const retr = byType('retrieved');
    for (const [t, v] of Object.entries(expected.judge.ceilingGapByType)) close(gold[t]! - retr[t]!, v);
  });
});

describe('the recall definition', () => {
  const gold = { goldChunkIds: ['a', 'b'] } as EvalQuestion;

  it('counts unique gold chunks, never items: a duplicate source does not add recall', () => {
    const r: RankedSource[] = [
      { kind: 'chunk', sourceChunkIds: ['a'] },
      { kind: 'chunk', sourceChunkIds: ['a'] },
    ];
    expect(recallAtK(gold, r, 2)).toBe(0.5);
  });

  it('summary sources do not count unless asked', () => {
    const r: RankedSource[] = [{ kind: 'summary', sourceChunkIds: ['a', 'b'] }];
    expect(recallAtK(gold, r, 1)).toBe(0);
    expect(recallAtK(gold, r, 1, { withSummaries: true })).toBe(1);
    expect(allGoldAtK(gold, r, 1, { withSummaries: true })).toBe(1);
  });

  it('only ranks 1..k count: a gold chunk at rank k+1 is not covered at k', () => {
    const r: RankedSource[] = [
      { kind: 'chunk', sourceChunkIds: ['x'] },
      { kind: 'chunk', sourceChunkIds: ['a'] },
      { kind: 'chunk', sourceChunkIds: ['b'] },
    ];
    expect(recallAtK(gold, r, 1)).toBe(0);
    expect(recallAtK(gold, r, 2)).toBe(0.5);
    expect(recallAtK(gold, r, 3)).toBe(1);
    expect(allGoldAtK(gold, r, 2)).toBe(0);
    expect(allGoldAtK(gold, r, 3)).toBe(1);
  });

  it('a gold chunk listed twice counts once: recall is over unique gold chunks', () => {
    const twice = { goldChunkIds: ['a', 'a', 'b'] } as EvalQuestion;
    expect(recallAtK(twice, [{ kind: 'chunk', sourceChunkIds: ['a'] }], 1)).toBe(0.5);
    expect(allGoldAtK(twice, [{ kind: 'chunk', sourceChunkIds: ['a', 'b'] }], 1)).toBe(1);
  });

  it('one item can cover several gold chunks', () => {
    expect(recallAtK(gold, [{ kind: 'relation', sourceChunkIds: ['a', 'b'] }], 1)).toBe(1);
  });

  it('a question without gold has no recall (an error, not a zero)', () => {
    expect(() => recallAtK({ goldChunkIds: [] }, [], 1)).toThrow(KgError);
  });
});

describe('retrievalMetrics skips questions without gold', () => {
  const q = (id: string, type: EvalQuestion['type'], goldChunkIds: string[]) => ({ id, type, goldChunkIds }) as EvalQuestion;
  const questions = [q('g1', 'single-hop', ['a']), q('none', 'topic', []), q('g2', 'single-hop', ['b'])];
  const rankedBy = (id: string): RankedSource[] => {
    if (id === 'none') throw new Error('a question without gold must not be ranked');
    return [{ kind: 'chunk', sourceChunkIds: [id === 'g1' ? 'a' : 'x'] }];
  };

  it('leaves them out of per-question rows, the overall mean and the types', () => {
    const m = retrievalMetrics(questions, rankedBy, [1]);
    expect(Object.keys(m.perQuestion)).toEqual(['g1', 'g2']);
    expect(m.overall.recall).toEqual({ '1': 0.5 });
    expect(Object.keys(m.byType)).toEqual(['single-hop']);
    expect(m.byType['single-hop']!.n).toBe(2);
  });

  it('a question missing from the ranked lists is an error from the caller, not a zero', () => {
    expect(() => retrievalMetrics([q('g1', 'single-hop', ['a'])], () => undefined as never, [1])).toThrow();
  });
});

describe('judgeMeans', () => {
  it('averages per condition', () => {
    expect(judgeMeans([{ condition: 'a', score: 1 }, { condition: 'a', score: 0 }, { condition: 'b', score: 0.5 }])).toEqual({ a: 0.5, b: 0.5 });
  });
});
