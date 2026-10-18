import { describe, expect, it } from 'vitest';
import type { RecipeSpec } from '@kg/core';
import { STEPS } from '../src/steps';
import { machineExecutor, machineRecipe } from '../src/machines';
import { runnerLoopExecutor } from '../src/runner-loop';
import { searchWith, stripRecipe } from './helpers';
import { QueryLlmFactory } from './llm';

const Q = 'how does entropy relate to Carnot efficiency of a heat engine';
const knn = { type: 'vector-knn', params: { pool: 50, kinds: ['chunk'] } };
const loopRecipe = (max: number): RecipeSpec => ({ kind: 'search', version: 'critique-loop-data/1', spec: { steps: [knn, { type: 'repeat', params: { max, steps: [{ type: 'critique', params: { model: 'm', maxNewQueries: 2 } }, knn] } }, { type: 'truncate', params: {} }] } });

describe('A+: runner with a `repeat` construct == machine loop', () => {
  for (const [name, llm] of [['never satisfied', { critique: Array.from({ length: 4 }, (_, i) => ({ sufficient: false, newQueries: [`Carnot cycle step ${i}`] })) }], ['satisfied at 1', { critique: [{ sufficient: true, newQueries: [] }] }]] as const) {
    it(name, async () => {
      const a = await searchWith(runnerLoopExecutor(STEPS), loopRecipe(2), Q, 4, QueryLlmFactory(llm));
      const b = await searchWith(machineExecutor(), machineRecipe('critique-loop', { model: 'm', maxRounds: 2 }), Q, 4, QueryLlmFactory(llm));
      expect(a.error).toBeUndefined();
      expect(a.res!.items).toEqual(b.res!.items);
      expect(a.steps.map((t) => [t.stepType, t.considered, t.output])).toEqual(b.steps.map((t) => [t.stepType, t.considered, t.output]));
      void stripRecipe;
    });
  }
});
