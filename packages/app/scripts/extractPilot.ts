/**
 * Pilot of the relation layer's producer (pre-check for "not extracted", "fragmentation", "conflicting relations").
 * Takes the gold chunks of single-hop questions (N per author), asks the local model for self-contained relations with
 * their nodes, and writes scratch/sprint-2/pilot/extract-<author>.json. Nothing here enters a store: it is a measurement.
 * Usage: tsx scripts/extractPilot.ts <author> [--n 12]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSet } from '@kg/core';
import { ollamaLlm } from '../src/ollamaLlm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const author = process.argv[2]!;
const n = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 12);
const out = join(root, 'scratch/sprint-2/pilot');
mkdirSync(out, { recursive: true });
const set = JSON.parse(readFileSync(join(root, `scratch/sprint-2/eval-set-${author}.json`), 'utf8')) as EvalSet;
const picks = set.questions.filter((q) => q.type === 'single-hop' && q.goldChunkIds.length === 1).slice(0, n);
const llm = ollamaLlm();

const SYSTEM = `You extract a knowledge graph from one passage of a physics textbook.
Write every distinct fact the passage states as a relation. A relation has:
- "text": one self-contained sentence a reader can understand without the passage. State qualifiers (the system, conditions, limits, scope) in the sentence itself. Do not use pronouns or references such as "this", "above", "equation (2.3)". Write formulas in words if the passage gives only a placeholder.
- "nodes": the names of the things the relation connects (concepts, quantities, systems, laws), 2 to 5 names, each a short lowercase noun phrase.
Reply with one JSON object and nothing else: {"relations": [{"text": "...", "nodes": ["...", "..."]}]}
If the passage states nothing worth extracting, reply {"relations": []}.`;

const rows = [];
for (const q of picks) {
  const text = q.goldText[0]!;
  let relations: { text: string; nodes: string[] }[] = [];
  let error: string | null = null;
  try {
    const r = await llm.complete({ purpose: 'pilot-extract', model: 'qwen3.5:latest', system: SYSTEM, messages: [{ role: 'user', content: text }], temperature: 0, maxTokens: 1500, json: true });
    relations = (JSON.parse(r.text) as { relations: { text: string; nodes: string[] }[] }).relations ?? [];
  } catch (e) {
    error = (e as Error).message;
  }
  rows.push({ questionId: q.id, chunkId: q.goldChunkIds[0], question: q.question, referenceAnswer: q.referenceAnswer, chunkText: text, relations, error });
  console.log(q.id, relations.length, 'relations', error ?? '');
}
writeFileSync(join(out, `extract-${author}.json`), JSON.stringify(rows, null, 1));
