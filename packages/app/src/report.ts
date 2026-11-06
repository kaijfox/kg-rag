/**
 * `kg report`: what the history says about real use, in plain terms. How many searches agents made, what they rated, which
 * searches failed, and how the machine an agent used compared with the baseline that ran beside it.
 */
import type { Kg } from '@kg/kernel';
import { loggedSearches } from '@kg/eval';

export interface Report {
  agentSessions: number;
  searches: number;
  byMachine: Record<string, number>;
  rated: number;
  meanRelevance: number | null;
  outcomes: { worked: number; failed: number };
  toolFailures: number;
  shadow: {
    searches: number;
    /** mean of shared / (shared + only in one) over the chunks the two machines returned */
    meanOverlap: number | null;
    machine: string | null;
    /** among searches where the agent reported using chunks: how many of those chunks each machine had returned */
    used: number;
    usedInChosen: number;
    usedInShadow: number;
    usedOnlyInChosen: number;
    usedOnlyInShadow: number;
  };
  failed: { searchId: string; query: string; machine: string; relevance: number | null; worked: boolean | null; note: string | null }[];
}

export function buildReport(kg: Kg): Report {
  const logged = loggedSearches(kg);
  const sessions = kg.history.sessions(100000).filter((s) => s.kind === 'agent');
  const byMachine: Record<string, number> = {};
  for (const l of logged) byMachine[l.machine] = (byMachine[l.machine] ?? 0) + 1;
  const rated = logged.filter((l) => l.relevance !== null);
  const shadowEvents = kg.history.eventsOfType('search.shadow', 1_000_000);
  const shadowBy = new Map(shadowEvents.map((e) => [e.searchId, e.payload as { machine: string; items: { sourceChunkIds: string[] }[]; sharedChunks: number; onlyShadow: number; onlyChosen: number }]));
  let overlapSum = 0;
  let overlapN = 0;
  const sh = { used: 0, usedInChosen: 0, usedInShadow: 0, usedOnlyInChosen: 0, usedOnlyInShadow: 0 };
  for (const l of logged) {
    const s = shadowBy.get(l.searchId);
    if (!s) continue;
    const denom = s.sharedChunks + s.onlyShadow + s.onlyChosen;
    if (denom > 0) (overlapSum += s.sharedChunks / denom, overlapN++);
    const shadowChunks = new Set(s.items.flatMap((i) => i.sourceChunkIds));
    const chosenChunks = new Set(l.resultChunks);
    for (const c of l.usedChunks) {
      sh.used++;
      const a = chosenChunks.has(c);
      const b = shadowChunks.has(c);
      if (a) sh.usedInChosen++;
      if (b) sh.usedInShadow++;
      if (a && !b) sh.usedOnlyInChosen++;
      if (b && !a) sh.usedOnlyInShadow++;
    }
  }
  const outcomes = logged.filter((l) => l.worked !== null);
  return {
    agentSessions: sessions.length,
    searches: logged.length,
    byMachine,
    rated: rated.length,
    meanRelevance: rated.length ? rated.reduce((a, l) => a + l.relevance!, 0) / rated.length : null,
    outcomes: { worked: outcomes.filter((l) => l.worked).length, failed: outcomes.filter((l) => !l.worked).length },
    toolFailures: kg.history.eventsOfType('tool.failed', 1_000_000).length,
    shadow: { searches: shadowBy.size, meanOverlap: overlapN ? overlapSum / overlapN : null, machine: shadowEvents[0] ? (shadowEvents[0].payload as { machine: string }).machine : null, ...sh },
    failed: logged
      .filter((l) => l.worked === false || (l.relevance !== null && l.relevance < 0.5))
      .slice(0, 20)
      .map((l) => ({ searchId: l.searchId, query: l.query, machine: l.machine, relevance: l.relevance, worked: l.worked, note: l.note })),
  };
}

export function formatReport(r: Report): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');
  const lines = [
    `agent sessions   ${r.agentSessions}`,
    `searches         ${r.searches} (${Object.entries(r.byMachine).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'})`,
    `rated            ${r.rated}${r.meanRelevance === null ? '' : `, mean relevance ${r.meanRelevance.toFixed(2)}`}`,
    `outcomes         ${r.outcomes.worked} worked, ${r.outcomes.failed} did not`,
    `tool failures    ${r.toolFailures}`,
  ];
  if (r.shadow.searches) {
    lines.push(
      '',
      `compared with ${r.shadow.machine} on ${r.shadow.searches} searches`,
      `  the two returned the same passages ${r.shadow.meanOverlap === null ? '—' : pct(r.shadow.meanOverlap, 1)} of the time (mean overlap)`,
      `  of ${r.shadow.used} passages agents reported using: ${r.shadow.usedInChosen} were in the chosen machine's results, ${r.shadow.usedInShadow} in ${r.shadow.machine}'s`,
      `  only the chosen machine had ${r.shadow.usedOnlyInChosen}; only ${r.shadow.machine} had ${r.shadow.usedOnlyInShadow}`,
    );
  }
  if (r.failed.length) {
    lines.push('', 'searches that went badly:');
    for (const f of r.failed) lines.push(`  ${f.searchId}  ${f.machine}  relevance ${f.relevance === null ? '—' : f.relevance.toFixed(2)}${f.worked === false ? ', did not work' : ''}\n    ${f.query}${f.note ? `\n    note: ${f.note}` : ''}`);
  }
  return lines.join('\n');
}
