import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Kg, KgError, l2normalize, type Embedder, type Llm, type LlmRequest } from '@kg/kernel';
import { createRegistry, ingest } from '@kg/modules';
import { allGoldAtK, askParsed, evalSetId, generateQuestions, judge, parseGenerationReply, parseJudgeReply, pickGroups, recallAtK, retrievalMetrics, reusesWording, runEval, type EvalSet } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const FIXTURE = resolve(__dirname, '../../modules/test/fixtures/log.md');

function embedder(): Embedder {
  return {
    model: 'fake', dims: 64,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(64);
        for (const w of t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
          let h = 7;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % 64]! += 1;
        }
        return l2normalize(v);
      });
    },
  };
}

type Script = (r: LlmRequest, n: number) => string;
function llm(script: Script): Llm & { calls: number } {
  const l = { calls: 0, async complete(r: LlmRequest) { l.calls++; return { text: script(r, l.calls), model: r.model, inputTokens: 1, outputTokens: 1 }; } };
  return l;
}

async function setup(model: Llm) {
  const dir = mkdtempSync(join(tmpdir(), 'kg-eval-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'kg.json'), JSON.stringify({ space: { model: 'fake', digest: 'fake', dims: 64, documentTemplate: '{text}', queryTemplate: '{query}' }, sources: [{ path: FIXTURE, docKey: 'decisions', adapter: 'decision-log' }] }));
  const kg = Kg.open(dir, { registry: createRegistry(), services: { embedder: embedder(), llm: model } });
  await ingest(kg);
  return kg;
}

const q = (id: string, gold: string[]) => ({ id, type: 'single-hop' as const, question: 'x', referenceAnswer: 'y', goldChunkIds: gold, goldText: [], sourceDocKeys: [] });
const chunk = (id: string, text: string) => ({ id, docKey: 'd', ordinal: 0, sectionPath: ['S'], occurrence: 0, text, pages: [], blockRefs: [], meta: {} });

describe('metrics', () => {
  it('counts each gold chunk once, through the chunks that facts cite, and leaves summaries out unless asked', () => {
    const ranked = [{ id: 'f', kind: 'fact' as const, sourceChunkIds: ['a', 'b'] }, { id: 's', kind: 'summary' as const, sourceChunkIds: ['c'] }, { id: 'a', kind: 'chunk' as const, sourceChunkIds: ['a'] }];
    expect(recallAtK(q('1', ['a', 'b', 'c']), ranked, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(q('1', ['a', 'b', 'c']), ranked, 3, { withSummaries: true })).toBe(1);
    expect(allGoldAtK(q('1', ['a', 'b']), ranked, 1)).toBe(1);
    expect(() => recallAtK(q('1', []), ranked, 1)).toThrow(KgError);
    const m = retrievalMetrics([q('1', ['a']), { ...q('2', ['z']), type: 'topic' }], (id) => (id === '1' ? ranked : []), [1, 3]);
    expect(m.overall.recall).toEqual({ '1': 0.5, '3': 0.5 });
    expect(m.byType.topic!.recall['3']).toBe(0);
  });
});

describe('parsing and retries', () => {
  it('accepts exactly the requested shape', () => {
    expect(parseJudgeReply('{"score":0.5,"rationale":"partly"}')).toEqual({ score: 0.5, rationale: 'partly' });
    expect(() => parseJudgeReply('{"score":0.7,"rationale":"x"}')).toThrow(/0, 0.5 or 1/);
    expect(() => parseJudgeReply('{"score":1,"rationale":"x","extra":1}')).toThrow(/unknown keys/);
    expect(() => parseGenerationReply('{"questions":[{"question":"q","referenceAnswer":"a","type":"multi-hop","uses":[0]}]}', 'multi-hop', 2)).toThrow(/needs 2/);
  });
  it('asks again after a malformed reply with the bad reply and a corrective instruction, and gives up after the budget', async () => {
    const seen: LlmRequest[] = [];
    const m = llm((r, n) => (seen.push(r), n < 3 ? 'nonsense' : '{"score":1,"rationale":"same facts"}'));
    const v = await judge(m, 'q', 'ref', 'ans');
    expect(v.score).toBe(1);
    expect(seen[1]!.messages.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(seen[2]!.messages).toHaveLength(5);
    await expect(askParsed(llm(() => 'bad'), seen[0]!, parseJudgeReply, 2)).rejects.toThrow(/not JSON/);
  });
});

describe('generation', () => {
  it('drops a repeated question and a question that copies passage wording, and records a group that stays malformed', async () => {
    const chunks = [chunk('ch_a', 'The partition function sums the Boltzmann weights over all microstates of the system.'), chunk('ch_b', 'Free energy is minimised at equilibrium for a system at fixed temperature.')];
    const replies: Record<string, string> = {
      Boltzmann: JSON.stringify({ questions: [{ question: 'What does the partition function sum the Boltzmann weights over?', referenceAnswer: 'All microstates.', type: 'single-hop' }] }),
      'Free energy': JSON.stringify({ questions: [{ question: 'Which quantity reaches a minimum when a thermal system settles?', referenceAnswer: 'The free energy.', type: 'single-hop' }] }),
    };
    const m = llm((r) => Object.entries(replies).find(([k]) => r.messages[0]!.content.includes(k))?.[1] ?? 'garbage');
    const { drafts, dropped } = await generateQuestions(m, chunks, [{ type: 'single-hop', chunkIds: ['ch_a'] }, { type: 'single-hop', chunkIds: ['ch_b'] }, { type: 'single-hop', chunkIds: ['ch_b'] }]);
    expect(drafts.map((d) => d.goldChunkIds)).toEqual([['ch_b']]);
    expect(dropped.map((d) => d.reason).sort()).toEqual(['duplicate', 'wording-copy']);
    expect(reusesWording('sums the Boltzmann weights over', [chunks[0]!.text])).toBe(true);
    const bad = await generateQuestions(llm(() => 'garbage'), chunks, [{ type: 'single-hop', chunkIds: ['ch_a'] }]);
    expect(bad.dropped).toMatchObject([{ reason: 'failed' }]);
  });
  it('picks reproducible groups: single chunks, adjacent pairs, and sections of three to six', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...chunk(`ch_${i}`, 'x'.repeat(400)), docKey: 'D', ordinal: i, sectionPath: [i < 6 ? 'A' : 'B'] }));
    const a = pickGroups(rows, { seed: 1, single: 3, multi: 2, topic: 2 });
    expect(pickGroups(rows, { seed: 1, single: 3, multi: 2, topic: 2 })).toEqual(a);
    expect(a.filter((g) => g.type === 'single-hop')).toHaveLength(3);
    for (const g of a.filter((g) => g.type === 'multi-hop')) expect(Math.abs(Number(g.chunkIds[0]!.slice(3)) - Number(g.chunkIds[1]!.slice(3)))).toBe(1);
    expect(a.filter((g) => g.type === 'topic').every((g) => g.chunkIds.length === 6)).toBe(true);
  });
});

describe('a run', () => {
  const answerer = (fail?: string): Script => (r) => {
    if (r.purpose === 'eval-answer') {
      if (fail && r.messages[0]!.content.includes(fail)) throw new KgError('upstream', 'model unreachable');
      return 'The store is SQLite.';
    }
    return '{"score":1,"rationale":"same facts"}';
  };

  it('scores recall and answers under each condition, stores every result in the history, and goes on after one failure', async () => {
    const m = llm(answerer('failing question'));
    const kg = await setup(m);
    const sqlite = kg.index.currentChunks().find((c) => c.text.startsWith('## 2026-04-02: Store is SQLite'))!;
    const questions = [
      { ...q('a', [sqlite.id]), question: 'what is the project store now', referenceAnswer: 'SQLite', goldText: [sqlite.text] },
      { ...q('b', [sqlite.id]), question: 'a failing question about the store', referenceAnswer: 'SQLite', goldText: [sqlite.text] },
    ];
    const set: EvalSet = { id: evalSetId(questions), name: 't', genRecipeId: null, questions };
    const { runId, summary } = await runEval(kg, set, { conditions: ['no-context', 'gold', 'retrieved', 'current-state'], ks: [1, 5] });
    const s = summary as { byCondition: Record<string, { scored: number; failed: number; judge: number; retrieval?: { overall: { recall: Record<string, number> } } }>; failures: unknown[] };
    expect(s.byCondition['gold']).toMatchObject({ scored: 1, failed: 1, judge: 1 });
    expect(s.failures).toHaveLength(4);
    expect(s.byCondition['retrieved']!.retrieval!.overall.recall['5']).toBe(1);
    expect(s.byCondition['current-state']!.retrieval!.overall.recall['1']).toBe(1);
    const rows = kg.history.evalResults(runId);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.condition === 'retrieved')!.retrieved![0]).toMatch(/^ch_/);
    expect(kg.history.evalRuns()[0]).toMatchObject({ runId, indexId: kg.index.indexId });
    expect(kg.history.eventsOfType('eval.question.failed')).toHaveLength(4);
    kg.close();
  });

  it('reports questions whose gold chunk is not in the index, and refuses an unknown condition', async () => {
    const kg = await setup(llm(answerer()));
    const set: EvalSet = { id: 'qs_x', name: 't', genRecipeId: null, questions: [{ ...q('z', ['ch_aaaaaaaaaaaaaaaaaaaa']), question: 'store', goldText: ['x'] }] };
    const { summary } = await runEval(kg, set, { conditions: ['gold'], ks: [1] });
    expect((summary as { orphaned: unknown[] }).orphaned).toEqual([{ questionId: 'z', missing: ['ch_aaaaaaaaaaaaaaaaaaaa'], allMissing: true }]);
    await expect(runEval(kg, set, { conditions: ['nonsense'], ks: [1] })).rejects.toThrow(/unknown condition/);
    kg.close();
  });
});
