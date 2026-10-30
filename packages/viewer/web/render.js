// @ts-check
/**
 * Pure rendering functions, shared by the page (loaded as a module) and the tests. No DOM access and no imports.
 *
 * The renderers return a small tree, not HTML text: `{ tag, cls?, data?, kids }`, where a kid is a string (text),
 * a tree, or null. The page turns a tree into DOM nodes (`build` in app.js) with createElement and textContent, so
 * a log value can never become markup. Everything here is derived from the event log and an immutable MachineMap.
 *
 * @typedef {import('@kg/core').MachineMap} MachineMap
 * @typedef {import('@kg/core').EventEnvelope} EventEnvelope
 * @typedef {{ label: string; text: string } | null} ItemInfo
 * @typedef {{ tag: string; cls?: string; data?: Record<string, string>; kids: any[] }} Tree
 * A kid is text, a tree, a list of kids (flattened by h), or nothing. Typed loosely: TypeScript rejects the recursion.
 * @typedef {any} Kid
 * @typedef {{ start: EventEnvelope; events: EventEnvelope[] }} Run
 */

/**
 * @param {string} tag
 * @param {{ cls?: string; data?: Record<string, string> }} [props]
 * @param {...any} kids
 * @returns {Tree}
 */
export function h(tag, props = {}, ...kids) {
  return { tag, ...props, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
}

/** The text of a tree, for tests and for measuring. @param {Kid} k @returns {string} */
export function textOf(k) {
  if (k === null || k === undefined || k === false) return '';
  if (typeof k === 'string') return k;
  return k.kids.map(textOf).join('');
}

const ITEM_ID = /\b(?:ch|rl|sm)_[a-z0-9]{20}\b/g;

/**
 * Compact text of a JSON value for a row: item IDs inside it become their labels when `itemInfo` knows them.
 * @param {unknown} v @param {(id: string) => ItemInfo} itemInfo @param {number} [n]
 */
function jsonText(v, itemInfo, n = 160) {
  const s = (typeof v === 'string' ? v : JSON.stringify(v) ?? '').replace(ITEM_ID, (id) => itemInfo(id)?.label ?? id);
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

/** @param {unknown} x @param {number} [d] */
const num = (x, d = 3) => (typeof x === 'number' ? x.toFixed(d) : '-');

/** @param {string} id @param {(id: string) => ItemInfo} itemInfo */
function itemTree(id, itemInfo) {
  const info = itemInfo(id);
  return h('span', { cls: 'item', data: { item: id } }, info ? info.label : id);
}

/**
 * @param {{ rank: number; score: number; itemId: string }[]} refs
 * @param {(id: string) => ItemInfo} itemInfo
 * @param {number} limit
 * @returns {Kid[]}
 */
function refKids(refs, itemInfo, limit) {
  if (refs.length === 0) return [h('span', { cls: 'muted' }, 'none')];
  return refs.slice(0, limit).flatMap((r, i) => [
    i > 0 ? ' ' : null,
    h('span', { cls: 'cand' }, `${r.rank}. `, itemTree(r.itemId, itemInfo), ' ', h('span', { cls: 'score' }, num(r.score))),
  ]);
}

/**
 * One event as a row tree. Item IDs show the label from `itemInfo` when it knows the item, the raw ID otherwise.
 * Expandable details stay on the same row.
 * @param {EventEnvelope} e
 * @param {(id: string) => ItemInfo} [itemInfo]
 * @returns {Tree}
 */
export function eventTree(e, itemInfo = () => null) {
  return h('div', { cls: `ev ${e.type}`, data: { seq: String(e.seq) } }, h('span', { cls: 'seq' }, `#${e.seq}`), ' ', h('span', { cls: 'type' }, e.type), ' ', rowKids(e, itemInfo));
}

/**
 * The timeline rows, one tree per event, in order.
 * @param {EventEnvelope[]} events
 * @param {(id: string) => ItemInfo} [itemInfo]
 * @returns {Tree[]}
 */
export function renderTimeline(events, itemInfo = () => null) {
  return events.map((e) => eventTree(e, itemInfo));
}

/** @param {EventEnvelope} e @param {(id: string) => ItemInfo} itemInfo @returns {Kid[]} */
function rowKids(e, itemInfo) {
  /** @type {any} */
  const p = e.payload;
  switch (e.type) {
    case 'session.started':
      return [p.kind, p.label ? ` ${p.label}` : null];
    case 'tool.called':
      return [h('b', {}, p.tool), ' ', jsonText(p.input, itemInfo), e.parentId ? [' ', h('span', { cls: 'muted' }, '(nested)')] : null];
    case 'tool.returned':
      return [h('b', {}, p.tool), ` returned in ${num(p.durationMs, 1)} ms `, jsonText(p.summary, itemInfo, 120)];
    case 'tool.failed':
      return [h('b', {}, p.tool), ' ', h('span', { cls: 'error' }, p.error.code), ` ${p.error.message}`];
    case 'query':
      return [`"${p.query}" k=${p.k}`];
    case 'pipeline.started':
      return [`${p.pipeline} pipeline ${p.machine}@${p.version}`];
    case 'pipeline.finished':
      return [
        `${p.pipeline} pipeline ${p.status} at `,
        p.state,
        p.error ? [' ', h('span', { cls: 'error' }, p.error.code), ` ${p.error.message}`] : null,
      ];
    case 'search.step': {
      const t = p.trace;
      const pools = Object.keys(t.pools ?? {}).map((name) =>
        h('details', { cls: 'pool' }, h('summary', {}, `pools: ${name} (${t.pools[name].length})`), ...refKids(t.pools[name], itemInfo, Infinity)),
      );
      return [
        `step ${t.stepIndex} `,
        h('span', { cls: 'state' }, t.state),
        ` ${t.stepType}: ${t.considered.length} considered, ${t.output.length} output `,
        h('span', { cls: 'muted' }, `${num(t.durationMs, 1)} ms`),
        ' ',
        h('span', { cls: 'top' }, ...refKids(t.output, itemInfo, 5)),
        ' ',
        h('details', { cls: 'considered' }, h('summary', {}, 'all considered'), ...refKids(t.considered, itemInfo, Infinity)),
        ...pools.flatMap((x) => [' ', x]),
      ];
    }
    case 'search.result':
      return [
        `${p.items.length} items`,
        p.stale ? [' ', h('span', { cls: 'error' }, 'stale')] : null,
        ' ',
        ...refKids(
          p.items.map((/** @type {any} */ i) => ({ rank: i.rank, score: i.score, itemId: i.itemId })),
          itemInfo,
          Infinity,
        ),
      ];
    case 'ingest.started':
      return [`${p.docKey} from ${p.source.path}`];
    case 'ingest.parsed':
      return [`${p.docKey} parsed (${p.origin}), ${p.stats.pages} pages`];
    case 'ingest.chunked':
      return [`${p.docKey} chunked: ${p.chunkCount} chunks, ${p.inserted} new, ${p.reused} reused, ${p.dropped} dropped`];
    case 'ingest.embedded':
      return [`${p.docKey} embedded: ${p.embedded} new, ${p.skipped} skipped`];
    case 'ingest.completed':
      return [`${p.docKey} completed${p.unchanged ? ' (unchanged)' : ''}`];
    case 'build.created':
      return [`build ${p.buildId}: ${p.itemCount} items${p.revert ? ' (revert)' : ''}`];
    case 'build.labeled':
      return [`build ${p.buildId} labeled ${p.name}`];
    case 'build.stale':
      return [`build ${p.buildId} stale: ${p.missingChunkIds.length} missing chunks`];
    case 'items.fetched':
      return p.itemIds.flatMap((/** @type {string} */ id, /** @type {number} */ i) => [i > 0 ? ' ' : null, itemTree(id, itemInfo)]);
    case 'feedback':
      return [
        `overall ${p.overall == null ? '-' : p.overall}, ${p.items.length} item ratings`,
        p.note ? [' ', h('span', { cls: 'muted' }, p.note)] : null,
      ];
    case 'usage':
      return [`${p.itemIds.length} items used by ${p.account}`];
    case 'outcome':
      return [`success ${p.success === null ? 'unknown' : p.success} `, h('span', { cls: 'muted' }, p.note)];
    case 'llm.called':
      return [`${p.purpose} ${p.model}: ${p.inputTokens}/${p.outputTokens} tokens, ${num(p.durationMs, 1)} ms`];
    case 'eval.run.started':
      return [`run ${p.runId} on build ${p.buildId}: ${p.conditions.join(', ')}`];
    case 'eval.question.scored':
      return [`${p.questionId} ${p.condition}: judge ${num(p.judgeScore, 2)}`];
    case 'eval.run.completed':
      return [`run ${p.runId} completed`];
    default:
      return [jsonText(p, itemInfo)];
  }
}

/**
 * The states a run logged, in order: a search.step maps to its trace.state; any other event maps to the first node
 * whose `logs` contains its type. Events that map to no node are skipped.
 * @param {MachineMap} map
 * @param {EventEnvelope[]} events
 * @returns {string[]}
 */
function loggedStates(map, events) {
  const ids = new Set(map.nodes.map((n) => n.id));
  /** @type {Map<string, string>} */
  const nodeOfType = new Map();
  for (const n of map.nodes) for (const t of n.logs) if (!nodeOfType.has(t)) nodeOfType.set(t, n.id);
  /** @type {string[]} */
  const out = [];
  for (const e of events) {
    if (e.type === 'search.step') {
      const s = /** @type {any} */ (e.payload).trace.state;
      if (ids.has(s)) out.push(s);
    } else {
      const id = nodeOfType.get(e.type);
      if (id !== undefined) out.push(id);
    }
  }
  return out;
}

/**
 * Splits a session's events into pipeline runs: each run starts at a pipeline.started and ends at its
 * pipeline.finished (or before the next pipeline.started, or at the end of the list while the run is live).
 * @param {EventEnvelope[]} events
 * @returns {Run[]}
 */
export function runsOf(events) {
  /** @type {Run[]} */
  const runs = [];
  /** @type {Run | null} */
  let open = null;
  for (const e of events) {
    if (e.type === 'pipeline.started') {
      if (open) runs.push(open);
      open = { start: e, events: [e] };
      continue;
    }
    if (!open) continue;
    open.events.push(e);
    if (e.type === 'pipeline.finished') {
      runs.push(open);
      open = null;
    }
  }
  if (open) runs.push(open);
  return runs;
}

/**
 * The Mermaid text (stateDiagram-v2) of one run, drawn from what the log records. Only states the run logged are
 * drawn, each with its visit count; an edge is drawn only between two drawn states, so no unlogged state is guessed.
 * The stop state (of a failed run) and the final state are marked. Returns null when the run cannot be drawn: no
 * pipeline.started, another machine, version or topology, a step in a state the map does not have, or nothing logged.
 * The caller then shows the flat timeline.
 * @param {MachineMap | null | undefined} map
 * @param {EventEnvelope[]} run
 * @returns {string | null}
 */
export function diagramOf(map, run) {
  if (!map) return null;
  const start = run.find((e) => e.type === 'pipeline.started');
  if (!start) return null;
  const p = /** @type {any} */ (start.payload);
  if (p.machine !== map.machine || p.version !== map.version || p.topology !== map.topology) return null;
  const ids = new Set(map.nodes.map((n) => n.id));
  for (const e of run) if (e.type === 'search.step' && !ids.has(/** @type {any} */ (e.payload).trace.state)) return null;

  /** @type {Map<string, number>} */
  const visits = new Map();
  for (const s of loggedStates(map, run)) visits.set(s, (visits.get(s) ?? 0) + 1);
  if (visits.size === 0) return null;

  // the state a run finished in is reached even when no event logs it (a final state logs nothing)
  const finished = [...run].reverse().find((e) => e.type === 'pipeline.finished');
  const fp = /** @type {any} */ (finished?.payload);
  if (fp && ids.has(fp.state) && !visits.has(fp.state)) visits.set(fp.state, 1);
  const stop = fp?.status === 'failed' ? fp.state : null;
  const final = fp && map.nodes.find((n) => n.id === fp.state)?.kind === 'final' ? fp.state : null;

  const name = new Map(map.nodes.filter((n) => visits.has(n.id)).map((n, i) => [n.id, `n${i}`]));
  /** @param {string} s */
  const clean = (s) => s.replace(/["#:;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  /** @type {string[]} */
  const lines = ['stateDiagram-v2'];
  for (const n of map.nodes) {
    const v = visits.get(n.id);
    if (v === undefined) continue;
    lines.push(`    state "${clean(n.label)} (x${v})" as ${name.get(n.id)}`);
  }
  if (name.has(map.initial)) lines.push(`    [*] --> ${name.get(map.initial)}`);
  for (const e of map.edges) {
    if (!name.has(e.from) || !name.has(e.to)) continue;
    const guard = e.guard ? ` [${clean(e.guard)}]` : '';
    lines.push(`    ${name.get(e.from)} --> ${name.get(e.to)} : ${clean(e.event)}${guard}`);
  }
  for (const n of map.nodes) if (n.kind === 'final' && name.has(n.id)) lines.push(`    ${name.get(n.id)} --> [*]`);
  lines.push(
    '    classDef visited fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a',
    '    classDef stop fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d',
    '    classDef final stroke-width:3px',
  );
  for (const [id, n] of name) {
    const cls = ['visited'];
    if (stop === id) cls.push('stop');
    if (final === id) cls.push('final');
    lines.push(`    class ${n} ${cls.join(',')}`);
  }
  return lines.join('\n');
}

/**
 * Session list order: newest start first, ties by ID. Independent of later events, so a live session getting
 * events never moves the rows under the pointer.
 * @template {{ sessionId: string; startedAt: string }} S
 * @param {readonly S[]} sessions
 * @returns {S[]}
 */
export function orderSessions(sessions) {
  return [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));
}

/**
 * Which run to show. While following, the latest run (so a live session shows a new search as it starts); once the
 * reader picked an earlier run, that run, as long as it still exists.
 * @param {readonly string[]} keys run keys, oldest first
 * @param {string | null} current the run shown now
 * @param {boolean} follow
 * @returns {string | null}
 */
export function pickRun(keys, current, follow) {
  const last = keys[keys.length - 1] ?? null;
  if (follow || current === null || !keys.includes(current)) return last;
  return current;
}
