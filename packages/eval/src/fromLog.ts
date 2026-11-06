/**
 * Evaluation questions from real use. An agent session logs each search, the feedback and usage the agent reported, and
 * whether the solution worked. Two kinds of question come out:
 *
 * - A search whose results the agent used, and that was not rated badly, becomes a question whose gold passages are the
 *   chunks the agent used. The gold is weak (the agent may have used less than the best passage, and it may have read
 *   a result that did not matter), so the question measures whether a machine finds what real work needed, not the best
 *   possible passage. It has no reference answer, so it is run with retrieval only.
 * - A search rated badly, or whose solution failed, becomes an entry without gold, listing what was retrieved. A person
 *   reads the passages, writes in the chunk IDs that should have been found, and `labelQuestions` adds it to the set.
 *
 * Chunk IDs are content-derived, so these questions stay valid across rebuilds.
 */
import { KgError, type Kg } from '@kg/kernel';
import { evalSetId } from './run';
import type { EvalQuestion, EvalSet } from './types';

export interface UnlabelledQuestion {
  searchId: string;
  question: string;
  machine: string;
  relevance: number | null;
  worked: boolean | null;
  note: string | null;
  /** what the search returned, to read when deciding what should have been found */
  retrieved: { chunkId: string; where: string; text: string }[];
  /** to be filled in by a person: the chunks that answer the question */
  goldChunkIds: string[];
  referenceAnswer: string;
}

interface Logged {
  searchId: string;
  query: string;
  machine: string;
  ts: string;
  resultChunks: string[];
  usedChunks: string[];
  relevance: number | null;
  worked: boolean | null;
  note: string | null;
}

const norm = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim();

/** Gathers every search made in an agent session, with the feedback, usage and outcome that followed it. */
export function loggedSearches(kg: Kg): Logged[] {
  const agent = new Set(kg.history.sessions(100000).filter((s) => s.kind === 'agent').map((s) => s.sessionId));
  const out: Logged[] = [];
  for (const e of kg.history.eventsOfType('search.started', 100000)) {
    if (!agent.has(e.sessionId) || !e.searchId) continue;
    const p = e.payload as { query: string; machine: string };
    const l: Logged = { searchId: e.searchId, query: p.query, machine: p.machine, ts: e.ts, resultChunks: [], usedChunks: [], relevance: null, worked: null, note: null };
    const rel: number[] = [];
    for (const x of kg.history.eventsOfSearch(e.searchId)) {
      const q = x.payload as Record<string, unknown>;
      if (x.type === 'search.result') l.resultChunks = [...new Set((q.items as { sourceChunkIds: string[] }[]).flatMap((i) => i.sourceChunkIds))];
      else if (x.type === 'usage') l.usedChunks = [...new Set([...l.usedChunks, ...(q.chunkIds as string[])])];
      else if (x.type === 'feedback') {
        rel.push(q.relevance as number);
        if (typeof q.note === 'string') l.note = q.note;
      } else if (x.type === 'outcome') {
        l.worked = q.worked as boolean;
        if (typeof q.note === 'string') l.note = q.note;
      }
    }
    if (rel.length) l.relevance = rel.reduce((a, b) => a + b, 0) / rel.length;
    out.push(l);
  }
  return out;
}

export function questionsFromLog(kg: Kg, o: { minRelevance?: number } = {}): { set: EvalSet; unlabelled: UnlabelledQuestion[] } {
  const min = o.minRelevance ?? 0.5;
  const all = loggedSearches(kg).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const seen = new Set<string>();
  const questions: EvalQuestion[] = [];
  const unlabelled: UnlabelledQuestion[] = [];
  for (const s of all) {
    const key = norm(s.query);
    if (seen.has(key)) continue;
    seen.add(key);
    const bad = s.worked === false || (s.relevance !== null && s.relevance < min);
    if (bad) {
      const chunks = kg.index.getChunks(s.resultChunks.slice(0, 10));
      unlabelled.push({
        searchId: s.searchId, question: s.query, machine: s.machine, relevance: s.relevance, worked: s.worked, note: s.note,
        retrieved: chunks.map((c) => ({ chunkId: c.id, where: `${c.docKey} › ${c.sectionPath.join(' › ')}`, text: c.text.slice(0, 300) })),
        goldChunkIds: [], referenceAnswer: '',
      });
      continue;
    }
    const gold = kg.index.filterCurrent(s.usedChunks);
    if (gold.length === 0) continue;
    const chunks = kg.index.getChunks(gold);
    questions.push({
      id: `log-${s.searchId.slice(-10)}`, type: 'logged', question: s.query, referenceAnswer: '',
      goldChunkIds: [...gold].sort(), goldText: chunks.map((c) => c.text), sourceDocKeys: [...new Set(chunks.map((c) => c.docKey))].sort(),
    });
  }
  questions.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { set: { id: evalSetId(questions), name: 'logged use', genRecipeId: null, questions }, unlabelled };
}

/**
 * Adds the entries a person has labelled (their `goldChunkIds` is not empty) to a set. A gold ID that is not a current
 * chunk is an error, because a question pinned to a chunk that does not exist can never be answered.
 */
export function labelQuestions(kg: Kg, set: EvalSet, entries: readonly UnlabelledQuestion[]): { set: EvalSet; added: number; skipped: number } {
  const questions = [...set.questions];
  let added = 0;
  for (const e of entries) {
    if (e.goldChunkIds.length === 0) continue;
    const current = new Set(kg.index.filterCurrent(e.goldChunkIds));
    const bad = e.goldChunkIds.filter((c) => !current.has(c));
    if (bad.length) throw new KgError('invalid_input', `question ${JSON.stringify(e.question)} names chunks that are not current: ${bad.join(', ')}`);
    const id = `log-${e.searchId.slice(-10)}`;
    if (questions.some((q) => q.id === id)) continue;
    const chunks = kg.index.getChunks(e.goldChunkIds);
    questions.push({
      id, type: 'logged', question: e.question, referenceAnswer: e.referenceAnswer,
      goldChunkIds: [...new Set(e.goldChunkIds)].sort(), goldText: chunks.map((c) => c.text), sourceDocKeys: [...new Set(chunks.map((c) => c.docKey))].sort(),
    });
    added++;
  }
  questions.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { set: { ...set, id: evalSetId(questions), questions }, added, skipped: entries.length - added };
}
