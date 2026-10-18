import { describe, expect, it } from 'vitest';
import { machineExecutor, machineRecipe } from '../src/machines';
import { robotCritiqueExecutor } from '../src/robot';
import { searchWith, stripRecipe } from './helpers';
import { QueryLlmFactory } from './llm';
import { KgError } from '@kg/core';

const Q = 'how does entropy relate to Carnot efficiency of a heat engine';
describe('robot3 (lighter library): critique loop', () => {
  const rec = machineRecipe('critique-loop', { model: 'm', maxRounds: 2 });
  for (const [name, llm] of [['never satisfied', { critique: Array.from({ length: 3 }, (_, i) => ({ sufficient: false, newQueries: [`Carnot cycle step ${i}`] })) }], ['satisfied at 1', { critique: [{ sufficient: true, newQueries: [] }] }]] as const) {
    it(`${name}: same events as the XState machine`, async () => {
      const a = await searchWith(machineExecutor(), rec, Q, 4, QueryLlmFactory(llm));
      const b = await searchWith(robotCritiqueExecutor({ model: 'm', maxRounds: 2, pool: 50 }), rec, Q, 4, QueryLlmFactory(llm));
      expect(b.error).toBeUndefined();
      expect(stripRecipe(b.events)).toEqual(stripRecipe(a.events));
    });
  }
  it('error from a step surfaces with its KgError code', async () => {
    const mc = (await import('@kg/testkit')).loadMiniCorpus; const m = await mc();
    m.embedder.embed = async () => { throw new KgError('upstream', 'down'); };
    const b = await searchWith(robotCritiqueExecutor({ model: 'm', maxRounds: 2, pool: 50 }), rec, Q, 4, undefined, m);
    expect((b.error as KgError).code).toBe('upstream');
  });
});
