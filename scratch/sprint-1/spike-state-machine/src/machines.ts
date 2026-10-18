/**
 * DESIGN B: XState v5. Recipe = {machine, settings} + version. One machine per pipeline kind, defined in code.
 * Steps are the same plain functions as in design A, invoked as promise actors through ONE actor (`runStep`),
 * which is also the one place that logs search.step.
 */
import { assign, createActor, fromPromise, setup, toPromise } from 'xstate';
import { KgError, canonicalJson, sha256hex, type Json, type JsonObject, type SearchRecipeSpec, type SearchState, type SearchStep, type StepFactory } from '@kg/core';
import type { Executor, Run } from './service';
import { critique, decompose, fuse, truncate, vectorKnn } from './steps';

export interface Ctx { state: SearchState; round: number }
type In = { state: SearchState };

/** ---- machine kit (shared by every machine) ---- */
const runStepActor = (run: Run) =>
  fromPromise(async ({ input }: { input: { step: SearchStep; state: SearchState } }) => {
    const t0 = run.ctx.clock.monotonicMs();
    const out = await input.step.run(input.state, run.env);
    run.emitStep(out.trace, Math.max(0, run.ctx.clock.monotonicMs() - t0)); // the single logging point
    return out.state;
  });

export function define(run: Run, guards: Record<string, (c: Ctx) => boolean>) {
  const M = setup({ types: { context: {} as Ctx, input: {} as In, output: {} as SearchState }, actors: { runStep: runStepActor(run) }, guards: Object.fromEntries(Object.entries(guards).map(([k, f]) => [k, ({ context }: { context: Ctx }) => f(context)])) as Record<string, never> });
  /** invoke a step as an actor, store its new state (plus `extra`), go to `next` */
  const stage = (factory: StepFactory | ((p: JsonObject) => SearchStep), params: JsonObject | ((c: Ctx) => JsonObject), next: string, extra?: (c: Ctx) => Partial<Ctx>) => ({
    meta: { step: factory.name || 'step', params: typeof params === 'function' ? 'dynamic' : params }, // lands in machine.config -> fingerprint
    invoke: {
      src: 'runStep' as const,
      input: ({ context }: { context: Ctx }) => ({ step: factory(typeof params === 'function' ? params(context) : params), state: context.state }),
      onDone: {
        target: next,
        actions: assign(({ context, event }) => { const out = (event as unknown as { output: SearchState }).output; return { state: out, ...extra?.({ ...(context as Ctx), state: out }) }; }),
      },
    },
  });
  /** a routing state: first guard that holds wins */
  const route = (...to: { guard?: string; target: string }[]) => ({ always: to.map((t) => ({ target: t.target, ...(t.guard ? { guard: t.guard } : {}) })) });
  const make = (states: Record<string, unknown>, initial: string) =>
    M.createMachine({
      context: ({ input }) => ({ state: input.state, round: 0 }),
      initial,
      states: states as never,
      output: ({ context }) => context.state,
    });
  return { stage, route, make };
}

const num = (s: JsonObject, k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);

/** ---- the three machines ---- */
export interface MachineDef { version: string; build(settings: JsonObject, run: Run): ReturnType<ReturnType<typeof define>['make']> }
export const MACHINES: Record<string, MachineDef> = {
  /** the skeleton's vector-knn + truncate */
  'knn-truncate': {
    version: 'knn-truncate/1',
    build: (s, run) => {
      const { stage, make } = define(run, {});
      return make({ retrieve: stage(vectorKnn, { pool: num(s, 'pool', 100), kinds: ['chunk'] }, 'cut'), cut: stage(truncate, {}, 'done'), done: { type: 'final' } }, 'retrieve');
    },
  },
  /** (a) decomposition with per-subquery pools and RRF fusion */
  'decompose-fuse': {
    version: 'decompose-fuse/1',
    build: (s, run) => {
      const { stage, make } = define(run, {});
      return make({
        split: stage(decompose, { model: String(s['model']), maxSubqueries: num(s, 'maxSubqueries', 3) }, 'retrieve'),
        retrieve: stage(vectorKnn, { pool: num(s, 'pool', 50), kinds: ['chunk'], into: 'sub:{queryId}' }, 'fuse'),
        fuse: stage(fuse, (c) => ({ from: c.state.queries.map((q) => `sub:${q.id}`), rrfK: num(s, 'rrfK', 60) }), 'cut'), // pool names come from the live state
        cut: stage(truncate, {}, 'done'),
        done: { type: 'final' },
      }, 'split');
    },
  },
  /** (b) critique loop: a real bounded loop with a guard, no unrolling, no `done`-skip rule */
  'critique-loop': {
    version: 'critique-loop/1',
    build: (s, run) => {
      const maxRounds = num(s, 'maxRounds', 2);
      const { stage, route, make } = define(run, { budget: (c) => c.round < maxRounds, satisfied: (c) => c.state.done });
      return make({
        retrieve: stage(vectorKnn, { pool: num(s, 'pool', 50), kinds: ['chunk'] }, 'review'),
        review: route({ guard: 'budget', target: 'critique' }, { target: 'cut' }), // the loop guard
        critique: stage(critique, { model: String(s['model']), maxNewQueries: num(s, 'maxNewQueries', 2) }, 'verdict', (c) => ({ round: c.round + 1 })),
        verdict: route({ guard: 'satisfied', target: 'cut' }, { target: 'retrieve' }),
        cut: stage(truncate, {}, 'done'),
        done: { type: 'final' },
      }, 'retrieve');
    },
  },
};

/** Topology fingerprint: machine.config (states, targets, named guards, step types and static params; functions -> 'fn'). */
export const fingerprint = (name: string, def: MachineDef = MACHINES[name]!): string =>
  sha256hex(canonicalJson(JSON.parse(JSON.stringify(def.build({}, {} as Run).config, (_k, v) => (typeof v === 'function' ? 'fn' : v))) as Json)).slice(0, 16);

/** Recipe identity: version names the machine code; settings are data; topology pins the definition. */
export const machineRecipe = (name: string, settings: JsonObject) => ({ kind: 'search' as const, version: MACHINES[name]!.version, spec: { machine: name, settings, topology: fingerprint(name) } });

export const machineExecutor = (registry: Record<string, MachineDef> = MACHINES): Executor => async (run) => {
  const spec = run.recipe.spec as { machine?: string; settings?: JsonObject };
  const def = spec.machine ? registry[spec.machine] : undefined;
  if (!def) throw new KgError('invalid_input', `unknown search machine ${spec.machine}`);
  if (spec.machine && (run.recipe.spec as { topology?: string }).topology !== fingerprint(spec.machine, def)) throw new KgError('invalid_input', `machine ${spec.machine} no longer has the topology this recipe was made for`);
  if (def.version !== run.recipe.version) throw new KgError('invalid_input', `recipe wants ${run.recipe.version}, code is ${def.version}`);
  const actor = createActor(def.build(spec.settings ?? {}, run), { input: { state: run.state } });
  actor.start();
  return toPromise(actor);
};

/** The runner expressed as a machine, so recipes-as-data ({steps}) keep working: needed for every existing build. */
export const pipelineExecutor = (steps: Record<string, StepFactory>): Executor => async (run) => {
  const spec = (run.recipe as unknown as SearchRecipeSpec).spec.steps;
  const plan = spec.map((s) => { const f = steps[s.type]; if (!f) throw new KgError('invalid_input', `unknown step type ${s.type}`); return f(s.params); });
  const { stage, route, make } = define(run, { end: (c) => c.round >= plan.length, skip: (c) => c.state.done && spec[c.round]!.params['final'] !== true });
  const m = make({
    next: route({ guard: 'end', target: 'done' }, { guard: 'skip', target: 'skipping' }, { target: 'step' }),
    skipping: { always: { target: 'next', actions: assign(({ context }) => ({ round: (context as Ctx).round + 1 })) } },
    step: stage((p) => plan[Number(p['i'])]!, (c) => ({ i: c.round }), 'next', (c) => ({ round: c.round + 1 })),
    done: { type: 'final' },
  }, 'next');
  const actor = createActor(m, { input: { state: run.state } });
  actor.start();
  return toPromise(actor);
};

/** Machine recipes ({machine, settings}) run their machine; step-list recipes run the generic pipeline machine. */
export const anyExecutor = (steps: Record<string, StepFactory>): Executor => (run) =>
  'machine' in run.recipe.spec ? machineExecutor()(run) : pipelineExecutor(steps)(run);
