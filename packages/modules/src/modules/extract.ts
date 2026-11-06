/**
 * Fact extraction: one model call per chunk (a second "anything missed" call when configured). A fact is one standalone
 * sentence that carries its own qualifiers, with the names it refers to. Replies that are malformed are asked again once;
 * facts that fail the checks below are rejected with a reason in the step's notes, never silently.
 */
import { KgError, normName, normText, type DerivedItemDraft, type Llm, type LlmRequest, type ModuleDef } from '@kg/kernel';
import { services } from '../services';

export const EXTRACT_SYSTEM = `You extract facts from one passage of a scientific or technical document, for a retrieval system.
A fact is one self-contained sentence that is still true and clear when read alone, with no other text.
Rules:
- State the species, system, conditions, quantities and scope that the passage gives for the fact, inside the sentence.
- Name every thing in full. Never write "this", "it", "they", "the passage", "the chapter", "the equation" or an equation or section number in place of a name.
- Use only what the passage supports. Add no outside knowledge.
- Skip headings, lists of symbols, and captions that carry no information.
- For each fact list the names of the things it is about (entities, concepts, quantities, methods), each written exactly as it appears in your sentence.
Reply with one JSON object and nothing else: {"facts": [{"text": "...", "names": ["...", "..."]}]}
Reply {"facts": []} when the passage holds nothing worth keeping. Give at most {{max}} facts.`;

const MORE = 'List any facts of the passage that your first reply missed, in the same JSON shape, with only the missing facts. Reply {"facts": []} if nothing is missing.';
const RETRY = 'That reply was not valid. Reply again with the JSON object only, in exactly the requested shape, with no other text.';

export interface RawFact {
  text: string;
  names: string[];
}

/** Parses a reply strictly: {"facts": [{"text": string, "names": string[]}]} and nothing else. */
export function parseFacts(raw: string): RawFact[] {
  let v: unknown;
  try {
    v = JSON.parse(raw.trim());
  } catch {
    throw new KgError('invalid_input', `reply is not JSON: ${JSON.stringify(raw.slice(0, 80))}`);
  }
  const o = v as { facts?: unknown };
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !Array.isArray(o.facts)) throw new KgError('invalid_input', 'reply lacks a facts array');
  return o.facts.map((f, i) => {
    const x = f as { text?: unknown; names?: unknown };
    if (typeof x?.text !== 'string' || !Array.isArray(x.names) || !x.names.every((n) => typeof n === 'string')) throw new KgError('invalid_input', `fact ${i} must have a text and a names array`);
    return { text: x.text.trim(), names: (x.names as string[]).map((n) => n.trim()).filter((n) => n !== '') };
  });
}

const DANGLING = /\b(the (?:chapter|section|figure|equation|passage|text|author|authors)s?\b|(?:equation|eq\.|section|figure|fig\.)\s*\(?\d)/i;
const PRONOUN_START = /^(this|that|these|those|it|they|we|here|there)\b/i;

/** Why a fact is refused, or null when it passes. Names that do not occur in the text are dropped from the fact. */
export function checkFact(f: RawFact, chunkText: string): { ok: DerivedItemDraft['mentions'] } | { reject: string } {
  if (f.text.length < 30) return { reject: 'too short to stand alone' };
  if (f.text.length > 600) return { reject: 'too long for one sentence' };
  if (PRONOUN_START.test(f.text)) return { reject: 'starts with a pronoun' };
  if (DANGLING.test(f.text)) return { reject: 'refers to the document instead of naming the thing' };
  if (normText(chunkText).includes(normText(f.text))) return { reject: 'copies the passage verbatim' };
  const t = normName(f.text);
  const names = [...new Set(f.names.filter((n) => normName(n) !== '' && t.includes(normName(n))))];
  if (names.length === 0) return { reject: 'names no thing that occurs in the sentence' };
  return { ok: names.map((surface) => ({ surface })) };
}

function request(model: string, temperature: number, maxTokens: number, max: number, section: string, passage: string, extra: LlmRequest['messages'] = []): LlmRequest {
  return {
    purpose: 'extract-facts',
    model,
    system: EXTRACT_SYSTEM.replace('{{max}}', String(max)),
    messages: [{ role: 'user', content: `Section: ${section || '(none)'}\n\nPassage:\n${passage}` }, ...extra],
    temperature,
    maxTokens,
    json: true,
  };
}

async function ask(llm: Llm, r: LlmRequest): Promise<{ facts: RawFact[]; reply: string } | null> {
  let req = r;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = (await llm.complete(req)).text;
    try {
      return { facts: parseFacts(reply), reply };
    } catch {
      req = { ...r, messages: [...r.messages, { role: 'assistant', content: reply }, { role: 'user', content: RETRY }] };
    }
  }
  return null;
}

export const extractFacts: ModuleDef = {
  name: 'extract-facts',
  version: '1',
  needs: ['segmented'],
  adds: ['extracted'],
  scope: 'per-chunk',
  async run({ ctx }) {
    const cfg = ctx.config;
    if (!cfg.extract.enabled) {
      ctx.note('fact extraction is off (extract.enabled is false in kg.json)');
      return { patch: { extracted: { skipped: true } } };
    }
    const llm = services(ctx).llm;
    if (!llm) throw new KgError('precondition', 'fact extraction needs a model client');
    const done = ctx.index.chunksDoneBy('extract-facts@1');
    const todo = ctx.index.currentChunks().filter((c) => !done.has(c.id));
    const items: DerivedItemDraft[] = [];
    const rejected: { chunk: string; text: string; reason: string }[] = [];
    let malformed = 0;
    for (const c of todo) {
      const base = request(cfg.llm.model, cfg.llm.temperature, cfg.llm.maxTokens, cfg.extract.maxFactsPerChunk, c.sectionPath.join(' > '), c.text);
      const first = await ask(llm, base);
      if (!first) {
        malformed++;
        continue;
      }
      let raw = first.facts;
      if (cfg.extract.secondPass) {
        const more = await ask(llm, request(cfg.llm.model, cfg.llm.temperature, cfg.llm.maxTokens, cfg.extract.maxFactsPerChunk, c.sectionPath.join(' > '), c.text, [{ role: 'assistant', content: first.reply }, { role: 'user', content: MORE }]));
        if (more) raw = [...raw, ...more.facts];
      }
      const seen = new Set<string>();
      for (const f of raw.slice(0, cfg.extract.maxFactsPerChunk * 2)) {
        const key = normText(f.text);
        if (seen.has(key)) continue;
        seen.add(key);
        const r = checkFact(f, c.text);
        if ('reject' in r) rejected.push({ chunk: c.id, text: f.text.slice(0, 120), reason: r.reject });
        else items.push({ kind: 'fact', text: f.text, sourceChunkIds: [c.id], mentions: r.ok });
      }
    }
    ctx.note(`${todo.length} chunks, ${items.length} facts kept, ${rejected.length} rejected, ${malformed} chunks with malformed replies skipped`, { rejected: rejected.slice(0, 25) });
    return { patch: { extracted: { chunks: todo.length, facts: items.length, rejected: rejected.length, malformed } }, writes: items.length ? { derived: { items } } : {} };
  },
};
