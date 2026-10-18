/**
 * SKELETON viewer read: renders a session (or one search) from LogReader alone, like the session viewer's
 * timeline. Holds no state; reads only the log (plus an optional label function for readability).
 */
import type { EventEnvelope, LogReader, SearchId, SessionId, StepTrace } from '@kg/core';

const short = (id: string | null) => (id ? `${id.slice(0, 3)}${id.slice(-6)}` : '-');

export function renderEvent(e: EventEnvelope, label: (id: string) => string = short): string {
  const head = `#${String(e.seq).padStart(3)} ${e.ts.slice(11, 23)} ${e.type.padEnd(20)}`;
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'session.started':
      return `${head} kind=${p['kind']} label=${p['label']}`;
    case 'tool.called':
      return `${head} ${p['tool']}(${JSON.stringify(p['input']).slice(0, 140)})`;
    case 'tool.returned':
      return `${head} ${p['tool']} -> ${JSON.stringify(p['summary']).slice(0, 140)}`;
    case 'tool.failed':
      return `${head} ${p['tool']} !! ${JSON.stringify(p['error'])}`;
    case 'query':
      return `${head} search=${short(e.searchId)} build=${short(e.buildId)} k=${p['k']} "${p['query']}"`;
    case 'search.step': {
      const t = p['trace'] as StepTrace;
      const top = t.output.slice(0, 5).map((r) => `${r.rank}:${label(r.itemId)}(${r.score.toFixed(3)})`).join(' ');
      return `${head} step ${t.stepIndex} ${t.stepType} ${JSON.stringify(t.params)} considered=${t.considered.length} output=${t.output.length} | ${top}`;
    }
    case 'search.result': {
      const items = p['items'] as { itemId: string; rank: number; score: number }[];
      return `${head} stale=${p['stale']} ${items.map((i) => `${i.rank}:${label(i.itemId)}(${i.score.toFixed(3)})`).join(' ')}`;
    }
    case 'feedback':
      return `${head} search=${short(e.searchId)} build=${short(e.buildId)} overall=${p['overall']} items=${JSON.stringify((p['items'] as { itemId: string; relevance: number }[]).map((i) => [label(i.itemId), i.relevance]))} note=${JSON.stringify(p['note'])}`;
    case 'items.fetched':
      return `${head} ${(p['itemIds'] as string[]).map(label).join(' ')}`;
    default:
      return `${head} ${JSON.stringify(p).slice(0, 160)}`;
  }
}

export function renderSession(reader: LogReader, sessionId: SessionId, label?: (id: string) => string): string {
  const s = reader.getSession(sessionId);
  const lines = [`session ${sessionId} (${s?.kind}, ${s?.label ?? 'no label'}, ${s?.eventCount} events)`];
  for (const e of reader.events(sessionId)) lines.push(renderEvent(e, label));
  for (const n of reader.notes(sessionId)) lines.push(`  note ${n.ts}: ${n.text}`);
  return lines.join('\n');
}

export function renderSearch(reader: LogReader, searchId: SearchId, label?: (id: string) => string): string {
  return reader.eventsBySearch(searchId).map((e) => renderEvent(e, label)).join('\n');
}
