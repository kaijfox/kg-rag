/**
 * machineMapConformance and machineLogConformance (contract 0.6.1: option steps, declared-events case). The map is the plain-data drawing of a
 * pipeline machine (core model.ts MachineMap, checked by core machineMap.ts); the log suite checks that one run's
 * events follow that map. Nothing here runs a machine: both suites only read data.
 */
import { expect } from 'vitest';
import { validateMachineMap, type EventEnvelope, type MachineMap, type MachineNode } from '@kg/core';
import type { Suite } from './harness';

/** Every node reachable from `start` by following moves (forward), start included. */
function forward(map: MachineMap, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const e of map.edges) {
      if (e.from === n && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

/** Every node from which `target` can be reached by following moves, target included. */
function backward(map: MachineMap, target: string): Set<string> {
  const seen = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const e of map.edges) {
      if (e.to === n && !seen.has(e.from)) {
        seen.add(e.from);
        queue.push(e.from);
      }
    }
  }
  return seen;
}

/**
 * True when `to` is reached from `from` by one or more moves whose intermediate nodes are all routing nodes. With
 * from === to this is true only when a loop returns to the state through routing nodes.
 */
function reachesThroughRouting(map: MachineMap, byId: Map<string, MachineNode>, from: string, to: string): boolean {
  const succ = (id: string) => map.edges.filter((e) => e.from === id).map((e) => e.to);
  const seen = new Set<string>();
  const queue = succ(from);
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    if (byId.get(n)?.kind === 'routing') queue.push(...succ(n));
  }
  return false;
}

export function machineMapConformance(getMap: () => MachineMap): Suite {
  return {
    name: 'machineMapConformance',
    cases: [
      {
        name: 'validateMachineMap finds no problems',
        run() {
          expect(validateMachineMap(getMap())).toEqual([]);
        },
      },
      {
        name: 'the initial state exists',
        run() {
          const m = getMap();
          expect(m.nodes.map((n) => n.id)).toContain(m.initial);
        },
      },
      {
        name: 'exactly one final state with id done and one with id failed',
        run() {
          const finals = getMap().nodes.filter((n) => n.kind === 'final').map((n) => n.id);
          expect(finals.filter((id) => id === 'done'), 'final states named done').toHaveLength(1);
          expect(finals.filter((id) => id === 'failed'), 'final states named failed').toHaveLength(1);
        },
      },
      {
        name: 'every work node has a non-null step and at least one log entry',
        run() {
          for (const n of getMap().nodes.filter((x) => x.kind === 'work')) {
            expect(n.step, `work node ${n.id} has no step`).not.toBeNull();
            expect(n.logs.length, `work node ${n.id} logs nothing`).toBeGreaterThan(0);
          }
        },
      },
      {
        name: 'every routing node has at least one outgoing move, and every outgoing move of a routing node is always',
        run() {
          const m = getMap();
          for (const n of m.nodes.filter((x) => x.kind === 'routing')) {
            const out = m.edges.filter((e) => e.from === n.id);
            expect(out.length, `routing node ${n.id} has no outgoing move`).toBeGreaterThan(0);
            for (const e of out) expect(e.event, `routing node ${n.id} moves on ${e.event}`).toBe('always');
          }
        },
      },
      {
        name: "every work node has an 'error' move to failed",
        run() {
          const m = getMap();
          for (const n of m.nodes.filter((x) => x.kind === 'work')) {
            expect(m.edges.some((e) => e.from === n.id && e.event === 'error' && e.to === 'failed'), `work node ${n.id}`).toBe(true);
          }
        },
      },
      {
        name: 'every non-final node is reachable from the initial state and can reach done',
        run() {
          const m = getMap();
          const fromInitial = forward(m, m.initial);
          const toDone = backward(m, 'done');
          for (const n of m.nodes.filter((x) => x.kind !== 'final')) {
            expect(fromInitial.has(n.id), `node ${n.id} is not reachable from ${m.initial}`).toBe(true);
            expect(toDone.has(n.id), `node ${n.id} cannot reach done`).toBe(true);
          }
        },
      },
    ],
  };
}

export interface MachineLogOptions {
  /** true (default): the run has search.step events and their states are checked against the map; false for machines that log no steps (ingest, eval) */
  steps: boolean;
}

/**
 * Event types that belong to no machine state: the session and tool envelope, the pipeline bracket, the search
 * `query` that opens a search, and `search.result`, which the search service writes after `pipeline.finished`.
 */
const isEnvelopeType = (t: string) => t.startsWith('session.') || t.startsWith('tool.') || t.startsWith('pipeline.') || t === 'query' || t === 'search.result';

export function machineLogConformance(getMap: () => MachineMap, getEvents: () => EventEnvelope[], options: Partial<MachineLogOptions> = {}): Suite {
  const expectSteps = options.steps ?? true;
  const pipelineEvents = (evs: EventEnvelope[]) => evs.filter((e) => e.type.startsWith('pipeline.'));
  const steps = (evs: EventEnvelope[]) => evs.filter((e): e is EventEnvelope<'search.step'> => e.type === 'search.step');
  return {
    name: 'machineLogConformance',
    cases: [
      {
        name: 'the first pipeline event is pipeline.started and the last is pipeline.finished',
        run() {
          const p = pipelineEvents(getEvents());
          expect(p.length, 'pipeline events in the run').toBeGreaterThan(1);
          expect(p[0]!.type).toBe('pipeline.started');
          expect(p.at(-1)!.type).toBe('pipeline.finished');
        },
      },
      {
        name: "pipeline.started's topology equals map.topology",
        run() {
          const m = getMap();
          const started = pipelineEvents(getEvents()).find((e): e is EventEnvelope<'pipeline.started'> => e.type === 'pipeline.started');
          expect(started, 'pipeline.started in the run').toBeDefined();
          expect(started!.payload.topology).toBe(m.topology);
        },
      },
      {
        name: 'every non-envelope event type in the run is declared in the logs of some work node of the map',
        run() {
          const declared = new Set(getMap().nodes.filter((n) => n.kind === 'work').flatMap((n) => n.logs));
          const types = new Set(getEvents().map((e) => e.type).filter((t) => !isEnvelopeType(t)));
          for (const t of types) expect(declared.has(t), `event type ${t} is logged by no work node of the map`).toBe(true);
        },
      },
      ...(expectSteps ? [
      {
        name: 'every search.step trace.state is the id of a work node in the map',
        run() {
          const m = getMap();
          const work = new Set(m.nodes.filter((n) => n.kind === 'work').map((n) => n.id));
          const st = steps(getEvents());
          expect(st.length, 'search.step events in the run').toBeGreaterThan(0);
          for (const s of st) expect(work.has(s.payload.trace.state), `step ${s.payload.trace.stepIndex} is in state ${s.payload.trace.state}`).toBe(true);
        },
      },
      {
        name: 'the step states follow moves of the map: the first is the initial state or reachable from it, and each next state is reached from the previous through routing nodes only (a repeat needs a loop)',
        run() {
          const m = getMap();
          const byId = new Map(m.nodes.map((n) => [n.id, n]));
          const states = steps(getEvents()).map((s) => s.payload.trace.state);
          expect(states[0] === m.initial || reachesThroughRouting(m, byId, m.initial, states[0]!), `first state ${states[0]}`).toBe(true);
          for (let i = 1; i < states.length; i++) {
            const [a, b] = [states[i - 1]!, states[i]!];
            expect(reachesThroughRouting(m, byId, a, b), `step ${i}: ${a} -> ${b} is not a move of the map`).toBe(true);
          }
        },
      },
      ] : []),
    ],
  };
}
