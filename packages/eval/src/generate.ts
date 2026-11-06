/**
 * Question generation: one prompt per group of chunks, strict parsing with retries, then a repeated-question check and a
 * check that the question does not copy a run of passage wording (questions that echo a chunk favour similarity search).
 */
import { KgError, type ChunkRow, type Llm, type LlmRequest } from '@kg/kernel';
import { askParsed } from './ask';
import { fill, loadPrompt } from './prompts/loader';
import { parseGenerationReply, type GeneratedQuestion } from './prompts/parse';
import type { QuestionDraft, QuestionType } from './types';

export interface GenerateSettings {
  model: string;
  temperature: number;
  /** questions asked per group of each type; 0 skips the type */
  mix: { 'single-hop': number; 'multi-hop': number; topic: number };
  retryBudget: number;
}
export const GENERATE_SETTINGS: GenerateSettings = { model: 'qwen3.5:latest', temperature: 0.7, mix: { 'single-hop': 1, 'multi-hop': 1, topic: 1 }, retryBudget: 2 };

export type GroupType = Exclude<QuestionType, 'exact-term'>;
export interface Group {
  type: GroupType;
  chunkIds: string[];
}
export interface DroppedDraft {
  group: number;
  reason: 'duplicate' | 'wording-copy' | 'failed';
  question: string;
}

const PROMPT_FOR: Record<GroupType, string> = { 'single-hop': 'generate-single-hop.md', 'multi-hop': 'generate-multi-hop.md', topic: 'generate-topic.md' };

export function generationRequest(type: GroupType, passages: readonly ChunkRow[], s: GenerateSettings): LlmRequest {
  const p = loadPrompt(PROMPT_FOR[type]);
  return {
    purpose: 'eval-generate',
    model: s.model,
    system: fill(p.system, { count: String(s.mix[type]) }),
    messages: [{ role: 'user', content: fill(p.user, { passages: passages.map((c, i) => `[${i}] ${c.text}`).join('\n\n'), section: passages[0]?.sectionPath.join(' > ') ?? '' }) }],
    temperature: s.temperature,
    maxTokens: 1200,
    json: true,
  };
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
const phrases = (t: string, n = 4): Set<string> => {
  const w = words(t);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
};
/** True when the question copies a run of more than three consecutive words of one of the passages. */
export const reusesWording = (question: string, passages: readonly string[]): boolean => {
  const q = phrases(question);
  return passages.some((p) => [...phrases(p)].some((ph) => q.has(ph)));
};

export function toDrafts(type: GroupType, passages: readonly ChunkRow[], parsed: readonly GeneratedQuestion[]): QuestionDraft[] {
  return parsed.map((g) => {
    const used = g.uses.map((u) => passages[u]!).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { type, question: g.question, referenceAnswer: g.referenceAnswer, goldChunkIds: used.map((p) => p.id), goldText: used.map((p) => p.text), sourceDocKeys: [...new Set(used.map((p) => p.docKey))].sort() };
  });
}

/** Splits incoming drafts into those accepted (after `accepted`) and those dropped. */
export function sortDrafts(accepted: readonly QuestionDraft[], incoming: readonly QuestionDraft[], group = 0): { accepted: QuestionDraft[]; dropped: DroppedDraft[] } {
  const seen = new Set(accepted.map((d) => words(d.question).join(' ')));
  const out = [...accepted];
  const dropped: DroppedDraft[] = [];
  for (const d of incoming) {
    const key = words(d.question).join(' ');
    if (seen.has(key)) dropped.push({ group, reason: 'duplicate', question: d.question });
    else if (reusesWording(d.question, d.goldText)) dropped.push({ group, reason: 'wording-copy', question: d.question });
    else (seen.add(key), out.push(d));
  }
  return { accepted: out, dropped };
}

/** Writes questions for the groups. A group whose replies stay malformed after the retries is recorded as dropped and the rest go on. */
export async function generateQuestions(llm: Llm, chunks: readonly ChunkRow[], groups: readonly Group[], s: GenerateSettings = GENERATE_SETTINGS): Promise<{ drafts: QuestionDraft[]; dropped: DroppedDraft[] }> {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  let drafts: QuestionDraft[] = [];
  const dropped: DroppedDraft[] = [];
  for (const [gi, g] of groups.entries()) {
    if (s.mix[g.type] <= 0) continue;
    const passages = g.chunkIds.map((id) => {
      const c = byId.get(id);
      if (!c) throw new KgError('invalid_input', `generation group names chunk ${id}, which is not in the given chunks`);
      return c;
    });
    try {
      const { value } = await askParsed(llm, generationRequest(g.type, passages, s), (raw) => parseGenerationReply(raw, g.type, passages.length), s.retryBudget);
      const r = sortDrafts(drafts, toDrafts(g.type, passages, value), gi);
      drafts = r.accepted;
      dropped.push(...r.dropped);
    } catch (e) {
      if (!(e instanceof KgError) || e.code !== 'invalid_input') throw e;
      dropped.push({ group: gi, reason: 'failed', question: e.message });
    }
  }
  return { drafts, dropped };
}

/** A small seeded generator (mulberry32) so every pick is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks generation groups with a fixed seed: single chunks, adjacent pairs of chunks (the passages of a multi-hop question
 * must both be needed), and sections of three to six chunks (topic questions). Chunks of at least `minChars` characters only.
 */
export function pickGroups(chunks: readonly ChunkRow[], o: { seed: number; single: number; multi: number; topic: number; minChars?: number }): Group[] {
  const r = rng(o.seed);
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const big = chunks.filter((c) => c.text.length >= (o.minChars ?? 300));
  const single = shuffle(big).slice(0, o.single).map((c): Group => ({ type: 'single-hop', chunkIds: [c.id] }));
  const pairs: Group[] = [];
  const byOrdinal = new Map(chunks.map((c) => [`${c.docKey}#${c.ordinal}`, c]));
  for (const c of shuffle(big)) {
    const next = byOrdinal.get(`${c.docKey}#${c.ordinal + 1}`);
    if (next && next.text.length >= (o.minChars ?? 300)) pairs.push({ type: 'multi-hop', chunkIds: [c.id, next.id] });
    if (pairs.length >= o.multi) break;
  }
  const sections = new Map<string, ChunkRow[]>();
  for (const c of chunks) sections.set(`${c.docKey}|${c.sectionPath.join('>')}`, [...(sections.get(`${c.docKey}|${c.sectionPath.join('>')}`) ?? []), c]);
  const topic = shuffle([...sections.values()].filter((s) => s.length >= 3 && s.length <= 6)).slice(0, o.topic).map((s): Group => ({ type: 'topic', chunkIds: s.map((c) => c.id) }));
  return [...single, ...pairs, ...topic];
}
