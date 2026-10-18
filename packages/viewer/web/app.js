import { diagramOf, orderSessions, pickRun, renderTimeline, runsOf } from './render.js';

const POLL_MS = 1000;
const SESSIONS_MS = 5000;

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;

/** Client state only: nothing here is written back to the server. */
const st = {
  session: null,
  events: [],
  lastSeq: 0,
  runKey: null,
  followRun: true,
  pointerOverList: false,
  listStale: false,
  selectedState: null,
  items: new Map(),
  machines: new Map(),
  diagram: null,
  pullTimer: null,
  busy: false,
};
let diagramSeq = 0;

function status(msg) {
  $('status').textContent = msg;
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const err = new Error(body?.error?.message ?? `${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------- sessions

async function loadSessions() {
  try {
    const list = orderSessions(await getJson('/api/sessions?limit=50'));
    const mine = list.find((s) => s.sessionId === st.session);
    // the list says the open session has more events than the page holds: pull now so the header keeps up
    if (mine && mine.eventCount > st.events.length) pull();
    // rows stay put while the pointer is over them, so a click lands on the row it was aimed at
    if (st.pointerOverList) {
      st.listStale = true;
      return;
    }
    st.listStale = false;
    const box = $('sessions');
    box.replaceChildren(
      ...list.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.session = s.sessionId;
        b.setAttribute('aria-current', String(s.sessionId === st.session));
        const title = document.createElement('div');
        title.textContent = s.label ?? s.sessionId;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${s.kind} · ${s.sessionId === st.session ? Math.max(s.eventCount, st.events.length) : s.eventCount} events · ${s.lastEventAt}`;
        b.append(title, meta);
        b.addEventListener('click', () => selectSession(s.sessionId));
        return b;
      }),
    );
  } catch (e) {
    status(`sessions: ${e.message}`);
  }
}

$('sessions').addEventListener('mouseenter', () => (st.pointerOverList = true));
$('sessions').addEventListener('mouseleave', () => {
  st.pointerOverList = false;
  if (st.listStale) loadSessions();
});

function selectSession(sessionId) {
  if (st.pullTimer) clearInterval(st.pullTimer);
  st.session = sessionId;
  st.events = [];
  st.lastSeq = 0;
  st.runKey = null;
  st.followRun = true;
  st.selectedState = null;
  st.diagram = null;
  $('item-detail').hidden = true;
  $('visit').replaceChildren();
  if (decodeURIComponent(location.hash.slice(1)) !== sessionId) location.hash = enc(sessionId);
  $('notes').hidden = false;
  for (const b of $('sessions').children) b.setAttribute('aria-current', String(b.dataset.session === sessionId));
  loadSessions();
  pull();
  st.pullTimer = setInterval(pull, POLL_MS);
  loadNotes();
}

async function pull() {
  if (!st.session || st.busy) return;
  st.busy = true;
  const sid = st.session;
  try {
    let got;
    do {
      got = await getJson(`/api/events?session=${enc(sid)}&after=${st.lastSeq}&limit=1000`);
      if (sid !== st.session) return;
      st.events.push(...got);
      if (got.length) st.lastSeq = got[got.length - 1].seq;
    } while (got.length === 1000);
    await loadItems();
    await loadMachines();
    draw();
    status(`${st.events.length} events · ${new Date().toLocaleTimeString()}`);
    const row = document.querySelector(`#sessions [aria-current="true"] .meta`);
    if (row) row.textContent = row.textContent.replace(/· \d+ events/, `· ${Math.max(st.events.length, Number(/· (\d+) events/.exec(row.textContent)?.[1] ?? 0))} events`);
  } catch (e) {
    status(`events: ${e.message}`);
  } finally {
    st.busy = false;
  }
}

// ---------------------------------------------------------------- item labels (fetched once per id)

function itemIdsOf(events) {
  const ids = new Set();
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'search.step') {
      const t = p.trace;
      for (const r of [...t.considered, ...t.output, ...Object.values(t.pools ?? {}).flat()]) ids.add(r.itemId);
    } else if (e.type === 'search.result') {
      for (const i of p.items) ids.add(i.itemId);
    } else if (e.type === 'items.fetched') {
      for (const id of p.itemIds) ids.add(id);
    } else if (e.type === 'usage') {
      for (const id of p.itemIds) ids.add(id);
    } else if (e.type === 'feedback') {
      for (const i of p.items) ids.add(i.itemId);
    }
  }
  return ids;
}

async function loadItems() {
  const missing = [...itemIdsOf(st.events)].filter((id) => !st.items.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        st.items.set(id, await getJson(`/api/items/${enc(id)}`));
      } catch (e) {
        if (e.status === 404) st.items.set(id, null);
        else throw e;
      }
    }),
  );
}

const itemInfo = (id) => st.items.get(id) ?? null;

// ---------------------------------------------------------------- machines

async function loadMachines() {
  for (const run of runsOf(st.events)) {
    const p = run.start.payload;
    const key = `${p.machine}@${p.version}`;
    if (st.machines.has(key)) continue;
    try {
      st.machines.set(key, await getJson(`/api/machines/${enc(key)}`));
    } catch (e) {
      if (e.status === 404) st.machines.set(key, null);
      else throw e;
    }
  }
}

// ---------------------------------------------------------------- drawing

async function draw() {
  $('timeline').innerHTML = renderTimeline(st.events, itemInfo);
  drawRun();
}

async function drawRun() {
  const runs = runsOf(st.events);
  $('run-panel').hidden = runs.length === 0;
  const sel = $('run');
  const keys = runs.map((r) => String(r.start.seq));
  st.runKey = pickRun(keys, st.runKey, st.followRun);
  sel.replaceChildren(
    ...runs.map((r) => {
      const o = document.createElement('option');
      o.value = String(r.start.seq);
      o.textContent = `#${r.start.seq} ${r.start.payload.machine}@${r.start.payload.version}${r.start.searchId ? ` ${r.start.searchId}` : ''}`;
      o.selected = o.value === st.runKey;
      return o;
    }),
  );
  const run = runs.find((r) => String(r.start.seq) === st.runKey);
  if (!run) return;
  const p = run.start.payload;
  const map = st.machines.get(`${p.machine}@${p.version}`) ?? null;
  const text = diagramOf(map, run.events);
  if (text === null) {
    $('diagram').textContent = 'Flat timeline: this run has no drawable machine.';
    $('states').replaceChildren();
    $('visit').replaceChildren();
    st.diagram = null;
    return;
  }
  if (text !== st.diagram) {
    st.diagram = text;
    try {
      const { svg } = await globalThis.mermaid.render(`run-${++diagramSeq}`, text);
      $('diagram').innerHTML = svg;
    } catch (e) {
      $('diagram').textContent = `diagram failed: ${e.message}`;
    }
  }
  drawStates(map, run);
}

function drawStates(map, run) {
  const steps = run.events.filter((e) => e.type === 'search.step');
  const counts = new Map();
  for (const e of steps) counts.set(e.payload.trace.state, (counts.get(e.payload.trace.state) ?? 0) + 1);
  $('states').replaceChildren(
    ...map.nodes
      .filter((n) => counts.has(n.id))
      .map((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${n.label} x${counts.get(n.id)}`;
        b.addEventListener('click', () => {
          st.selectedState = n.id;
          showVisits(run, n.id);
        });
        return b;
      }),
  );
  if (st.selectedState) showVisits(run, st.selectedState);
}

function showVisits(run, stateId) {
  const visits = run.events.filter((e) => e.type === 'search.step' && e.payload.trace.state === stateId);
  const pre = document.createElement('pre');
  pre.textContent = visits.map((e) => `#${e.seq} ${JSON.stringify(e.payload.trace, null, 2)}`).join('\n\n');
  const h = document.createElement('div');
  h.className = 'muted';
  h.textContent = `${stateId}: ${visits.length} visit(s)`;
  $('visit').replaceChildren(h, pre);
}

// ---------------------------------------------------------------- item detail on click

$('timeline').addEventListener('click', async (ev) => {
  const el = ev.target.closest?.('[data-item]');
  if (!el) return;
  const id = el.dataset.item;
  const box = $('item-detail');
  box.hidden = false;
  box.textContent = 'loading...';
  try {
    const info = await getJson(`/api/items/${enc(id)}`);
    box.textContent = `${info.label}\n\n${info.text}`;
  } catch (e) {
    box.textContent = `${id}: ${e.message}`;
  }
  box.onclick = () => (box.hidden = true);
});

$('run').addEventListener('change', (ev) => {
  st.runKey = ev.target.value;
  const last = $('run').options[$('run').options.length - 1];
  st.followRun = last !== undefined && last.value === st.runKey;
  st.selectedState = null;
  st.diagram = null;
  drawRun();
});

// ---------------------------------------------------------------- notes (the viewer's only write)

async function loadNotes() {
  if (!st.session) return;
  const sid = st.session;
  try {
    const notes = await getJson(`/api/notes?session=${enc(sid)}`);
    if (sid !== st.session) return;
    $('note-list').replaceChildren(
      ...notes.map((n) => {
        const li = document.createElement('li');
        li.textContent = `${n.ts}: ${n.text}`;
        return li;
      }),
    );
  } catch (e) {
    status(`notes: ${e.message}`);
  }
}

$('note-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('note-text').value;
  if (!st.session || text.trim() === '') return;
  try {
    await getJson('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: st.session, text }),
    });
    $('note-text').value = '';
    loadNotes();
  } catch (e) {
    status(`note: ${e.message}`);
  }
});

// ---------------------------------------------------------------- start

globalThis.mermaid?.initialize({ startOnLoad: false, securityLevel: 'strict' });
loadSessions();
setInterval(loadSessions, SESSIONS_MS);
const fromHash = () => decodeURIComponent(location.hash.slice(1));
if (fromHash()) selectSession(fromHash());
addEventListener('hashchange', () => {
  const id = fromHash();
  if (id && id !== st.session) selectSession(id);
});
