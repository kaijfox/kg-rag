// @ts-check
/**
 * Pure functions shared by the page (loaded as a module) and the tests. No imports, no DOM access.
 * Everything here is derived from the event log and an immutable MachineMap.
 *
 * @typedef {import('@kg/core').MachineMap} MachineMap
 * @typedef {import('@kg/core').EventEnvelope} EventEnvelope
 * @typedef {{ label: string; text: string } | null} ItemInfo
 * @typedef {{ start: EventEnvelope; events: EventEnvelope[] }} Run
 * @typedef {{ visits: Record<string, number>; moves: { from: string; to: string; count: number }[]; stop: string | null; final: string | null; next?: string[] }} Overlay
 */

/** @param {unknown} s */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/** A number as text; anything else is escaped, so a malformed log row cannot inject markup through a numeric field. @param {unknown} x */
const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? String(x) : escapeHtml(x));

/** @param {unknown} x @param {number} [d] */
const num = (x, d = 3) => (typeof x === 'number' ? x.toFixed(d) : '-');

/** @param {string} id @param {(id: string) => ItemInfo} itemInfo */
function itemHtml(id, itemInfo) {
  const info = itemInfo(id);
  return `<span class="item" data-item="${escapeHtml(id)}">${escapeHtml(info ? info.label : id)}</span>`;
}

/**
 * @param {{ rank: number; score: number; itemId: string }[]} refs
 * @param {(id: string) => ItemInfo} itemInfo
 * @param {number} limit
 */
function refsHtml(refs, itemInfo, limit) {
  if (refs.length === 0) return '<span class="muted">none</span>';
  return refs
    .slice(0, limit)
    .map((r) => `<span class="cand">${n(r.rank)}. ${itemHtml(r.itemId, itemInfo)} <span class="score">${num(r.score)}</span></span>`)
    .join(' ');
}

/**
 * Renders one event as one HTML line (the page joins them with newlines). Item IDs are shown as the label from
 * `itemInfo` when it knows the item; the raw ID otherwise. Expandable details stay on the same line.
 * @param {EventEnvelope[]} events
 * @param {(id: string) => ItemInfo} [itemInfo]
 * @returns {string}
 */
export function renderTimeline(events, itemInfo = () => null) {
  return events.map((e) => `<div class="ev ${escapeHtml(e.type)}" data-seq="${n(e.seq)}"><span class="seq">#${n(e.seq)}</span> <span class="type">${escapeHtml(e.type)}</span> ${rowBody(e, itemInfo)}</div>`).join('\n');
}

/** @param {EventEnvelope} e @param {(id: string) => ItemInfo} itemInfo */
function rowBody(e, itemInfo) {
  /** @type {any} */
  const p = e.payload;
  switch (e.type) {
    case 'session.started':
      return `${escapeHtml(p.kind)}${p.label ? ` ${escapeHtml(p.label)}` : ''}`;
    case 'tool.called':
      return `<b>${escapeHtml(p.tool)}</b> ${escapeHtml(jsonText(p.input, itemInfo))}${e.parentId ? ' <span class="muted">(nested)</span>' : ''}`;
    case 'tool.returned':
      return `<b>${escapeHtml(p.tool)}</b> returned in ${num(p.durationMs, 1)} ms ${escapeHtml(jsonText(p.summary, itemInfo, 120))}`;
    case 'tool.failed':
      return `<b>${escapeHtml(p.tool)}</b> <span class="error">${escapeHtml(p.error.code)}</span> ${escapeHtml(p.error.message)}`;
    case 'query':
      return `"${escapeHtml(p.query)}" k=${n(p.k)}`;
    case 'pipeline.started':
      return `${escapeHtml(p.pipeline)} pipeline ${escapeHtml(p.machine)}@${escapeHtml(p.version)}`;
    case 'pipeline.finished':
      return `${escapeHtml(p.pipeline)} pipeline ${escapeHtml(p.status)} at ${escapeHtml(p.state)}${p.error ? ` <span class="error">${escapeHtml(p.error.code)}</span> ${escapeHtml(p.error.message)}` : ''}`;
    case 'search.step': {
      const t = p.trace;
      const pools = t.pools
        ? Object.keys(t.pools)
            .map(
              (name) =>
                `<details class="pool"><summary>pools: ${escapeHtml(name)} (${t.pools[name].length})</summary>${refsHtml(t.pools[name], itemInfo, Infinity)}</details>`,
            )
            .join(' ')
        : '';
      return (
        `step ${n(t.stepIndex)} <span class="state">${escapeHtml(t.state)}</span> ${escapeHtml(t.stepType)}: ` +
        `${t.considered.length} considered, ${t.output.length} output <span class="muted">${num(t.durationMs, 1)} ms</span> ` +
        `<span class="top">${refsHtml(t.output, itemInfo, 5)}</span>` +
        ` <details class="considered"><summary>all considered</summary>${refsHtml(t.considered, itemInfo, Infinity)}</details>` +
        (pools ? ` ${pools}` : '')
      );
    }
    case 'search.result':
      return `${p.items.length} items${p.stale ? ' <span class="error">stale</span>' : ''} ${refsHtml(
        p.items.map((/** @type {any} */ i) => ({ rank: i.rank, score: i.score, itemId: i.itemId })),
        itemInfo,
        Infinity,
      )}`;
    case 'ingest.started':
      return `${escapeHtml(p.docKey)} from ${escapeHtml(p.source.path)}`;
    case 'ingest.parsed':
      return `${escapeHtml(p.docKey)} parsed (${escapeHtml(p.origin)}), ${n(p.stats.pages)} pages`;
    case 'ingest.chunked':
      return `${escapeHtml(p.docKey)} chunked: ${n(p.chunkCount)} chunks, ${n(p.inserted)} new, ${n(p.reused)} reused, ${n(p.dropped)} dropped`;
    case 'ingest.embedded':
      return `${escapeHtml(p.docKey)} embedded: ${n(p.embedded)} new, ${n(p.skipped)} skipped`;
    case 'ingest.completed':
      return `${escapeHtml(p.docKey)} completed${p.unchanged ? ' (unchanged)' : ''}`;
    case 'build.created':
      return `build ${escapeHtml(p.buildId)}: ${n(p.itemCount)} items${p.revert ? ' (revert)' : ''}`;
    case 'build.labeled':
      return `build ${escapeHtml(p.buildId)} labeled ${escapeHtml(p.name)}`;
    case 'build.stale':
      return `build ${escapeHtml(p.buildId)} stale: ${p.missingChunkIds.length} missing chunks`;
    case 'items.fetched':
      return p.itemIds.map((/** @type {string} */ id) => itemHtml(id, itemInfo)).join(' ');
    case 'feedback':
      return `overall ${p.overall == null ? '-' : n(p.overall)}, ${p.items.length} item ratings${p.note ? ` <span class="muted">${escapeHtml(p.note)}</span>` : ''}`;
    case 'usage':
      return `${p.itemIds.length} items used by ${escapeHtml(p.account)}`;
    case 'outcome':
      return `success ${p.success === null ? 'unknown' : escapeHtml(p.success)} <span class="muted">${escapeHtml(p.note)}</span>`;
    case 'llm.called':
      return `${escapeHtml(p.purpose)} ${escapeHtml(p.model)}: ${n(p.inputTokens)}/${n(p.outputTokens)} tokens, ${num(p.durationMs, 1)} ms`;
    case 'eval.run.started':
      return `run ${escapeHtml(p.runId)} on build ${escapeHtml(p.buildId)}: ${p.conditions.map(escapeHtml).join(', ')}`;
    case 'eval.question.scored':
      return `${escapeHtml(p.questionId)} ${escapeHtml(p.condition)}: judge ${num(p.judgeScore, 2)}`;
    case 'eval.run.completed':
      return `run ${escapeHtml(p.runId)} completed`;
    default:
      return escapeHtml(jsonText(p, itemInfo));
  }
}

/**
 * Logged states of a run in order: a search.step maps to its trace.state; any other event maps to the first node
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
 * Shortest edge path from `from` to `to` whose intermediate states are all routing states. Returns edge indexes,
 * or null. When from === to the path must have at least one edge (a loop).
 * @param {MachineMap} map
 * @param {Map<string, number[]>} out
 * @param {string} from
 * @param {string} to
 * @returns {number[] | null}
 */
function pathTo(map, out, from, to) {
  const kind = new Map(map.nodes.map((n) => [n.id, n.kind]));
  /** @type {Map<string, number>} routing node -> edge index that reached it */
  const via = new Map();
  const seen = new Set([from]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const node = /** @type {string} */ (queue[qi]);
    for (const ei of out.get(node) ?? []) {
      const e = /** @type {MachineMap['edges'][number]} */ (map.edges[ei]);
      if (e.to === to) {
        /** @type {number[]} */
        const path = [ei];
        let n = node;
        while (n !== from) {
          const pe = /** @type {number} */ (via.get(n));
          path.unshift(pe);
          n = /** @type {MachineMap['edges'][number]} */ (map.edges[pe]).from;
        }
        return path;
      }
      if (kind.get(e.to) === 'routing' && !seen.has(e.to)) {
        seen.add(e.to);
        via.set(e.to, ei);
        queue.push(e.to);
      }
    }
  }
  return null;
}

/** @param {MachineMap} map @returns {Map<string, number[]>} */
function outEdges(map) {
  /** @type {Map<string, number[]>} */
  const out = new Map();
  map.edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) ?? []), i]));
  return out;
}

/**
 * Which states a run took, computed from its events and the immutable map. Visits count logged states. Moves count
 * map edges traversed between consecutive logged states (unlogged routing states in between are filled in along the
 * shortest path). `stop` is the state of a failed pipeline.finished; `final` the final state reached.
 * @param {MachineMap} map
 * @param {EventEnvelope[]} events
 * @returns {Overlay}
 */
export function pathOverlay(map, events) {
  const out = outEdges(map);
  const kind = new Map(map.nodes.map((n) => [n.id, n.kind]));
  /** @type {Record<string, number>} */
  const visits = {};
  /** @type {{ from: string; to: string; count: number }[]} */
  const moves = [];
  const bump = (/** @type {number[]} */ path) => {
    for (const ei of path) {
      const e = /** @type {MachineMap['edges'][number]} */ (map.edges[ei]);
      const m = moves.find((x) => x.from === e.from && x.to === e.to);
      if (m) m.count++;
      else moves.push({ from: e.from, to: e.to, count: 1 });
    }
  };
  /** @type {string | null} */
  let cur = null;
  for (const s of loggedStates(map, events)) {
    if (cur === null) {
      if (s !== map.initial) {
        const path = pathTo(map, out, map.initial, s);
        if (path) bump(path);
      }
    } else {
      const path = pathTo(map, out, cur, s);
      if (path) bump(path);
    }
    cur = s;
    visits[s] = (visits[s] ?? 0) + 1;
  }
  const finished = [...events].reverse().find((e) => e.type === 'pipeline.finished');
  let stop = null;
  let final = null;
  if (finished) {
    const p = /** @type {any} */ (finished.payload);
    if (cur !== null && p.state !== cur && kind.has(p.state)) {
      const path = pathTo(map, out, cur, p.state);
      if (path) bump(path);
    }
    if (kind.get(p.state) === 'final') final = p.state;
    if (p.status === 'failed') stop = p.state;
  }
  return { visits, moves, stop, final };
}

/**
 * States the run may enter next, while it has not finished: the successors (done or always moves, through routing
 * states) of the last logged state, or of the initial state when nothing was logged yet. Empty once finished.
 * @param {MachineMap} map
 * @param {EventEnvelope[]} events
 * @returns {string[]}
 */
export function nextOf(map, events) {
  if (events.some((e) => e.type === 'pipeline.finished')) return [];
  const out = outEdges(map);
  const kind = new Map(map.nodes.map((n) => [n.id, n.kind]));
  const logged = loggedStates(map, events);
  /** @type {Set<string>} */
  const found = new Set();
  /** @type {Set<string>} */
  const expanded = new Set();
  /** @param {string} t */
  const arrive = (t) => {
    if (kind.get(t) !== 'routing') {
      found.add(t);
      return;
    }
    if (expanded.has(t)) return;
    expanded.add(t);
    for (const ei of out.get(t) ?? []) {
      const e = /** @type {MachineMap['edges'][number]} */ (map.edges[ei]);
      if (e.event !== 'error') arrive(e.to);
    }
  };
  if (logged.length === 0) arrive(map.initial);
  else {
    const last = /** @type {string} */ (logged[logged.length - 1]);
    for (const ei of out.get(last) ?? []) {
      const e = /** @type {MachineMap['edges'][number]} */ (map.edges[ei]);
      if (e.event !== 'error') arrive(e.to);
    }
  }
  return map.nodes.map((n) => n.id).filter((id) => found.has(id));
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
 * The Mermaid text (stateDiagram-v2) of a machine. With an overlay, visited nodes carry their visit count (or the
 * round count of a loop), unvisited nodes are grey, traversed moves carry their count in the label (stateDiagram-v2 has no linkStyle: Mermaid draws it as extra states), the stop and
 * final states are marked and the next states are dashed.
 * @param {MachineMap} map
 * @param {Overlay | null} [overlay]
 * @returns {string}
 */
export function mermaidOf(map, overlay = null) {
  const id = new Map(map.nodes.map((n, i) => [n.id, `n${i}`]));
  const kind = new Map(map.nodes.map((n) => [n.id, n.kind]));
  /** @param {string} s */
  const clean = (s) => s.replace(/["#:;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  /** @param {MachineMap['nodes'][number]} n */
  const labelOf = (n) => {
    const v = overlay?.visits[n.id] ?? 0;
    if (v === 0) return clean(n.label);
    return n.loop && v > 1 ? `${clean(n.label)} (${v} rounds)` : `${clean(n.label)} (x${v})`;
  };
  /** @type {string[]} */
  const lines = ['stateDiagram-v2'];
  /** @param {string | null} parent @param {string} indent */
  const declare = (parent, indent) => {
    for (const n of map.nodes) {
      if (n.parent !== parent) continue;
      const children = map.nodes.some((c) => c.parent === n.id);
      if (children) {
        lines.push(`${indent}state "${labelOf(n)}" as ${id.get(n.id)} {`);
        declare(n.id, `${indent}    `);
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}state "${labelOf(n)}" as ${id.get(n.id)}`);
      }
    }
  };
  declare(null, '    ');
  lines.push(`    [*] --> ${id.get(map.initial)}`);
  map.edges.forEach((e) => {
    const m = overlay?.moves.find((x) => x.from === e.from && x.to === e.to);
    const guard = e.guard ? ` [${clean(e.guard)}]` : '';
    lines.push(`    ${id.get(e.from)} --> ${id.get(e.to)} : ${clean(e.event)}${guard}${m ? ` x${m.count}` : ''}`);
  });
  for (const n of map.nodes) {
    if (kind.get(n.id) !== 'final') continue;
    lines.push(`    ${id.get(n.id)} --> [*]`);
  }
  if (overlay) {
    lines.push(
      '    classDef visited fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a',
      '    classDef unvisited fill:#f3f4f6,stroke:#9ca3af,color:#6b7280',
      '    classDef stop fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d',
      '    classDef next stroke-dasharray:4 3',
      '    classDef final stroke-width:3px',
    );
    for (const n of map.nodes) {
      const cls = [];
      const reached =
        (overlay.visits[n.id] ?? 0) > 0 ||
        overlay.final === n.id ||
        overlay.stop === n.id ||
        overlay.moves.some((m) => m.from === n.id || m.to === n.id);
      cls.push(reached ? 'visited' : 'unvisited');
      if (overlay.stop === n.id) cls.push('stop');
      if (overlay.final === n.id) cls.push('final');
      if (overlay.next?.includes(n.id)) cls.push('next');
      lines.push(`    class ${id.get(n.id)} ${cls.join(',')}`);
    }
  }
  return lines.join('\n');
}

/**
 * The diagram text for one run, or null when the run cannot be drawn on this map (no pipeline.started, another
 * machine, version or topology, or a step in a state the map does not have). The caller then shows the flat timeline.
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
  const overlay = pathOverlay(map, run);
  overlay.next = nextOf(map, run);
  return mermaidOf(map, overlay);
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
