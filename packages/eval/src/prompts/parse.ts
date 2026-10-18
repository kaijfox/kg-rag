import { KgError, type QuestionType } from '@kg/core';

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function json(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new KgError('invalid_input', `${what} is not JSON: ${JSON.stringify(raw.slice(0, 80))}`);
  }
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], what: string): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new KgError('invalid_input', `${what} has unknown keys ${extra.join(', ')}`);
}

const nonEmptyString = (x: unknown, what: string): string => {
  if (typeof x !== 'string' || x.trim() === '') throw new KgError('invalid_input', `${what} must be a non-empty string`);
  return x.trim();
};

export interface JudgeReply {
  score: 0 | 0.5 | 1;
  rationale: string;
}

/** The judge's reply: exactly {"score": 0 | 0.5 | 1, "rationale": "..."}. Anything else is invalid_input. */
export function parseJudgeReply(raw: string): JudgeReply {
  const o = json(raw, 'judge reply');
  if (!isObject(o)) throw new KgError('invalid_input', 'judge reply is not a JSON object');
  onlyKeys(o, ['score', 'rationale'], 'judge reply');
  if (o.score !== 0 && o.score !== 0.5 && o.score !== 1) throw new KgError('invalid_input', `judge score must be 0, 0.5 or 1, got ${JSON.stringify(o.score)}`);
  return { score: o.score, rationale: nonEmptyString(o.rationale, 'judge rationale') };
}

export interface GeneratedQuestion {
  question: string;
  referenceAnswer: string;
  /** passage numbers the answer needs (multi-hop and topic); [0] for single-hop */
  uses: number[];
}

/** Minimum number of passages a question of each type must use (topic: three, or all when the section has fewer). */
export function minimumUses(type: QuestionType, passages: number): number {
  if (type === 'single-hop') return 1;
  if (type === 'multi-hop') return 2;
  if (type === 'topic') return Math.min(3, passages);
  return 1;
}

/**
 * The generator's reply: {"questions": [{"question", "referenceAnswer", "type", "uses"?}]}. Each question must have the
 * requested type, and its uses (passage numbers, unique, in range) must meet the minimum for that type.
 */
export function parseGenerationReply(raw: string, type: QuestionType, passages: number): GeneratedQuestion[] {
  const o = json(raw, 'generator reply');
  if (!isObject(o)) throw new KgError('invalid_input', 'generator reply is not a JSON object');
  onlyKeys(o, ['questions'], 'generator reply');
  if (!Array.isArray(o.questions)) throw new KgError('invalid_input', 'generator reply lacks a questions array');
  return o.questions.map((q, i) => {
    if (!isObject(q)) throw new KgError('invalid_input', `question ${i} is not an object`);
    onlyKeys(q, ['question', 'referenceAnswer', 'type', 'uses'], `question ${i}`);
    if (q.type !== type) throw new KgError('invalid_input', `question ${i} has type ${String(q.type)}, expected ${type}`);
    const question = nonEmptyString(q.question, `question ${i} question`);
    const referenceAnswer = nonEmptyString(q.referenceAnswer, `question ${i} referenceAnswer`);
    const raw = q.uses ?? (type === 'single-hop' ? [0] : undefined);
    if (!Array.isArray(raw) || !raw.every((u) => Number.isInteger(u) && u >= 0 && u < passages)) {
      throw new KgError('invalid_input', `question ${i} uses must be passage numbers in 0..${passages - 1}`);
    }
    const uses = [...new Set<number>(raw as number[])].sort((a, b) => a - b);
    if (uses.length !== raw.length) throw new KgError('invalid_input', `question ${i} repeats a passage number`);
    if (uses.length < minimumUses(type, passages)) throw new KgError('invalid_input', `question ${i} uses ${uses.length} passages, needs ${minimumUses(type, passages)}`);
    return { question, referenceAnswer, uses };
  });
}
