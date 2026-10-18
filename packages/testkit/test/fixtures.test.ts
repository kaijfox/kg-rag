/** Fixture integrity: fixtures are valid, mutually consistent, and the hand-computed numbers re-check. */
import { describe, expect, it } from 'vitest';
import { asDocKey, chunkId, evalSetId, evalSetSchema, parseArtifactSchema, type Json } from '@kg/core';
import {
  InMemoryEventLog,
  MINI_DOCS,
  machineLogConformance,
  machineMapFixture,
  runSuite,
  REAL_SLICES,
  evalFixture,
  logFixture,
  miniArtifact,
  miniExpected,
  miniLabels,
  realArtifact,
  REFERENCE_ANSWERER,
  REFERENCE_JUDGE,
  searchQueries,
} from '../src/all';

describe('mini-corpus', () => {
  it('artifacts validate and labels match core chunkId of the expected chunks', () => {
    const labels = miniLabels();
    for (const v of [1, 2] as const)
      for (const d of MINI_DOCS) {
        expect(parseArtifactSchema.safeParse(miniArtifact(v, d)).success).toBe(true);
        for (const c of miniExpected(v)[d]) {
          expect(labels[c.label]).toBe(chunkId(asDocKey(d), c.sectionPath, c.text, c.occurrence));
          expect(c.text.length).toBe(c.chars);
        }
      }
  });
});

describe('docling-real', () => {
  it('real slices validate as parse artifacts (docling 2.140.0, OCR off)', () => {
    for (const s of REAL_SLICES) {
      const a = realArtifact(s);
      expect(parseArtifactSchema.safeParse(a).success).toBe(true);
      expect(a.recipe.spec.options.do_ocr).toBe(false);
    }
  });
});

describe('search', () => {
  it('queries name existing chunk labels', () => {
    const labels = miniLabels();
    for (const q of searchQueries()) for (const l of [...q.expectedTop, ...(q.mustNotAppear ?? [])]) expect(labels[l], `${q.id}: ${l}`).toBeDefined();
  });
});

describe('logs', () => {
  it('every recorded event validates and sessions load with contiguous seq', () => {
    for (const n of ['session-agent', 'session-eval', 'session-live-partial'] as const) {
      const evs = logFixture(n);
      const log = InMemoryEventLog.fromEnvelopes(evs);
      expect(log.events(evs[0]!.sessionId).length).toBe(evs.length);
      expect(log.events(evs[0]!.sessionId, 5, 3).map((e) => e.seq)).toEqual([6, 7, 8]);
    }
  });
  it('agent log has 3 searches with steps, item and overall feedback, a tool.failed, usage, outcome', () => {
    const t = logFixture('session-agent').map((e) => e.type);
    expect(t.filter((x) => x === 'query').length).toBe(3);
    expect(t.filter((x) => x === 'search.step').length).toBe(6);
    expect(t.filter((x) => x === 'feedback').length).toBe(3);
    for (const x of ['tool.failed', 'usage', 'outcome', 'build.created'] as const) expect(t).toContain(x);
  });
  it('eval log wraps nested searches in one eval_run tool call with llm.called per question', () => {
    const evs = logFixture('session-eval');
    expect(evs.filter((e) => e.type === 'tool.called').map((e) => (e.payload as { tool: string }).tool)).toEqual(['eval_run', 'search', 'search']);
    expect(evs.filter((e) => e.type === 'llm.called').length).toBe(2);
    const calls = evs.filter((e) => e.type === 'tool.called');
    expect(calls.slice(1).map((e) => e.parentId)).toEqual([calls[0]!.id, calls[0]!.id]); // P-3 nesting
    const started = evs.find((e) => e.type === 'eval.run.started')!;
    expect((started.payload as { buildId: string }).buildId).toBe(started.buildId);
    expect(started.payload).toMatchObject({ judge: REFERENCE_JUDGE, answerer: REFERENCE_ANSWERER });
    expect(evs.at(-1)!.type).toBe('tool.returned');
  });
  it('the live-partial log stops after a search.step, before that search has a result', () => {
    const evs = logFixture('session-live-partial');
    const last = evs.at(-1)!;
    expect(last.type).toBe('search.step');
    expect(evs.some((e) => e.type === 'search.result' && e.searchId === last.searchId)).toBe(false);
  });
});

describe('logs: pipeline bracket (contract 0.6.0)', () => {
  it('every whole search in the recorded logs is bracketed by pipeline events, and each bracket follows the similarity map', async () => {
    let checked = 0;
    for (const n of ['session-agent', 'session-eval', 'session-live-partial'] as const) {
      const evs = logFixture(n);
      for (const q of evs.filter((e) => e.type === 'query')) {
        const run = evs.filter((e) => e.searchId === q.searchId || e.id === q.parentId || (e.type === 'tool.returned' && e.parentId === q.parentId));
        const types = run.map((e) => e.type);
        if (!types.includes('search.result')) {
          expect(types, `${n}: partial search ${q.searchId}`).not.toContain('pipeline.finished');
          continue;
        }
        expect(types.filter((t) => t === 'pipeline.started'), `${n}: ${q.searchId}`).toHaveLength(1);
        expect(types.filter((t) => t === 'pipeline.finished'), `${n}: ${q.searchId}`).toHaveLength(1);
        const r = await runSuite(machineLogConformance(() => machineMapFixture(), () => run.filter((e) => /^(session\.|tool\.|pipeline\.|query$|search\.)/.test(e.type))));
        expect(r.failed, `${n}: ${q.searchId}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(6); // 3 agent + 2 eval + 1 live-partial
  });
});

describe('eval', () => {
  type Item = { itemId: string; kind: string; sourceChunkIds: string[]; rank: number };
  const set = evalFixture<{ id: string; questions: { id: string; type: string; goldChunkIds: string[]; goldText: string[] }[] }>('mini-set');
  const retr = evalFixture<{ retrievals: Record<string, Item[]> }>('retrievals').retrievals;
  const exp = evalFixture<{ perQuestion: Record<string, { recall: Record<string, number>; withSummaries: Record<string, number>; allGold: Record<string, number> }>; overall: { recall: Record<string, number>; withSummaries: Record<string, number> }; byType: Record<string, { recall: Record<string, number> }>; judge: { byCondition: Record<string, number> } }>('expected-metrics');

  it('the eval set validates and its id is core evalSetId(questions)', () => {
    expect(evalSetSchema.safeParse(set).success).toBe(true);
    expect(set.id).toBe(evalSetId(set.questions as unknown as Json));
  });
  it('a second, independent computation agrees with the hand-computed metrics', () => {
    const cover = (items: Item[], k: number, withSummaries: boolean) => new Set(items.filter((i) => i.rank <= k && (withSummaries || i.kind !== 'summary')).flatMap((i) => i.sourceChunkIds));
    const recall = (q: (typeof set.questions)[number], k: number, ws: boolean) => {
      const c = cover(retr[q.id]!, k, ws);
      return q.goldChunkIds.filter((g) => c.has(g)).length / q.goldChunkIds.length;
    };
    for (const k of [1, 3, 5]) {
      for (const q of set.questions) {
        expect(recall(q, k, false), `${q.id}@${k}`).toBeCloseTo(exp.perQuestion[q.id]!.recall[k]!, 9);
        expect(recall(q, k, true), `${q.id}@${k} with summaries`).toBeCloseTo(exp.perQuestion[q.id]!.withSummaries[k]!, 9);
      }
      const mean = (qs: typeof set.questions, ws = false) => qs.reduce((s, q) => s + recall(q, k, ws), 0) / qs.length;
      expect(mean(set.questions)).toBeCloseTo(exp.overall.recall[k]!, 9);
      expect(mean(set.questions, true)).toBeCloseTo(exp.overall.withSummaries[k]!, 9);
      for (const [t, v] of Object.entries(exp.byType)) expect(mean(set.questions.filter((q) => q.type === t))).toBeCloseTo(v.recall[k]!, 9);
    }
    const verdicts = evalFixture<{ condition: string; score: number }[]>('judge-verdicts');
    for (const [c, m] of Object.entries(exp.judge.byCondition)) {
      const xs = verdicts.filter((v) => v.condition === c);
      expect(xs.reduce((s, v) => s + v.score, 0) / xs.length).toBeCloseTo(m, 9);
    }
  });
});
