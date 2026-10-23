/**
 * Phase 4 baseline pipeline, one index per author (Kardar, Plischke) over the cached undecoded parse artifacts.
 *   ingest <author>     ingest that author's two PDFs into scratch/sprint-2/<author>.kg.sqlite
 *   groups <author>     pick generation groups with a fixed seed -> groups-<author>.json
 *   generate <author>   write questions with the local model -> eval-set-<author>.json and dropped-<author>.json
 * Usage: tsx scripts/baseline.ts <stage> <author> [--seed n] [--single n] [--multi n] [--topic n]
 * Needs Ollama (embeddinggemma, qwen3.5). All state lives in scratch/sprint-2/.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalSetId, recipeId, type Chunk, type ChunkId, type EvalQuestion, type EvalSet } from '@kg/core';
import { generateQuestionsDetailed, generateRecipe, GENERATE_SETTINGS } from '@kg/eval';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const stage = process.argv[2] ?? 'ingest';
const author = (process.argv[3] ?? 'kardar') as 'kardar' | 'plischke';
const out = join(root, 'scratch/sprint-2');
const tag = arg('--tag', '');
mkdirSync(out, { recursive: true });
const corpus = join(root, 'test/corpa/stat-mech');
const PDFS = { kardar: ['FoundationsKardar', 'ThermoKardar'], plischke: ['FoundationsPlischke', 'ThermoPlischke'] }[author];
const kg = compose({ dbPath: join(out, `${author}.kg.sqlite`), artifactDir: join(corpus, 'artifacts') });

/** small seeded generator (mulberry32) so every pick is reproducible */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(xs: T[], r: () => number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

const allChunks = (): Chunk[] => {
  const ids = kg.store.currentDocVersions().flatMap((d) => d.chunkIds);
  return kg.store.getItems(ids).filter((i): i is Chunk => i.kind === 'chunk');
};
const formulaShare = (c: Chunk) => ((c.text.match(/\[formula\]/g) ?? []).length * 9) / Math.max(c.text.length, 1);

if (stage === 'ingest') {
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: `baseline-ingest-${author}` });
  const sources = PDFS.map((n) => ({ path: join(corpus, `${n}.pdf`), docKey: n }));
  const t = performance.now();
  const rep = await kg.api.ingest(sessionId, { sources });
  console.log(`ingested ${author} in ${Math.round(performance.now() - t)} ms`, JSON.stringify(rep));
}

if (stage === 'groups') {
  const seed = Number(arg('--seed', '17'));
  const nSingle = Number(arg('--single', '40'));
  const nMulti = Number(arg('--multi', '20'));
  const nTopic = Number(arg('--topic', '10'));
  const r = rng(seed);
  const docs = kg.store.currentDocVersions();
  const chunks = allChunks();
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const position = new Map<string, { doc: string; i: number }>();
  for (const d of docs) d.chunkIds.forEach((id, i) => position.set(id, { doc: d.docKey, i }));
  const substantial = (c: Chunk) => c.text.length >= 500 && formulaShare(c) < 0.35;
  const pool = chunks.filter(substantial);

  // single-hop: equal share per document
  const perDoc = Math.ceil(nSingle / docs.length);
  const single: { type: 'single-hop'; chunkIds: ChunkId[] }[] = [];
  for (const d of docs) {
    const cands = shuffle(pool.filter((c) => c.docKey === d.docKey), r).slice(0, perDoc);
    for (const c of cands) single.push({ type: 'single-hop', chunkIds: [c.id] });
  }

  // multi-hop: two thirds linked by embedding similarity across sections, one third adjacent chunks of one section
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: `baseline-groups-${author}` });
  const multi: { type: 'multi-hop'; chunkIds: ChunkId[]; link: 'similar' | 'adjacent' }[] = [];
  const seeds = shuffle(pool, r);
  const used = new Set<string>();
  for (const s of seeds) {
    if (multi.length >= nMulti) break;
    if (used.has(s.id)) continue;
    const adjacent = multi.length % 3 === 2;
    if (adjacent) {
      const p = position.get(s.id)!;
      const next = docs.find((d) => d.docKey === p.doc)!.chunkIds[p.i + 1];
      const n = next ? byId.get(next) : undefined;
      if (n && substantial(n) && n.sectionPath.join('>') === s.sectionPath.join('>')) {
        multi.push({ type: 'multi-hop', chunkIds: [s.id, n.id], link: 'adjacent' });
        used.add(s.id).add(n.id);
      }
    } else {
      const res = await kg.api.search(sessionId, { query: s.text.slice(0, 1200), k: 8 });
      const sibs = res.items
        .map((i) => byId.get(i.itemId as ChunkId))
        .filter((c): c is Chunk => !!c && c.id !== s.id && substantial(c) && c.sectionPath.join('>') !== s.sectionPath.join('>') && !used.has(c.id));
      const pick = sibs.slice(0, 1 + (multi.length % 2));
      if (pick.length) {
        multi.push({ type: 'multi-hop', chunkIds: [s.id, ...pick.map((c) => c.id)], link: 'similar' });
        used.add(s.id);
        for (const c of pick) used.add(c.id);
      }
    }
  }

  // topic: whole sections of 3 to 6 chunks
  const sections = new Map<string, Chunk[]>();
  for (const d of docs) for (const id of d.chunkIds) {
    const c = byId.get(id)!;
    const k = `${d.docKey}|${c.sectionPath.join('>')}`;
    (sections.get(k) ?? sections.set(k, []).get(k)!).push(c);
  }
  const topicCands = shuffle([...sections.values()].filter((s) => s.length >= 3 && s.length <= 6), r);
  const topic = topicCands.slice(0, nTopic).map((s) => ({ type: 'topic' as const, chunkIds: s.map((c) => c.id) }));

  const groups = [...single, ...multi, ...topic];
  writeFileSync(join(out, `groups-${author}${tag}.json`), JSON.stringify({ seed, author, groups }, null, 1));
  console.log(`groups ${author}: ${single.length} single-hop, ${multi.length} multi-hop (${multi.filter((m) => m.link === 'adjacent').length} adjacent), ${topic.length} topic; pool ${pool.length}/${chunks.length} chunks`);
}

if (stage === 'generate') {
  const { groups } = JSON.parse(readFileSync(join(out, `groups-${author}${tag}.json`), 'utf8')) as { groups: { type: 'single-hop' | 'multi-hop' | 'topic'; chunkIds: ChunkId[] }[] };
  const chunks = allChunks();
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: `baseline-generate-${author}` });
  void sessionId;
  const [m1, m2, m3] = arg('--mix', '1,1,1').split(',').map(Number);
  const settings = { ...GENERATE_SETTINGS, mix: { 'single-hop': m1!, 'multi-hop': m2!, topic: m3! } };
  const t = performance.now();
  // one call per group: a group whose replies stay malformed after the retries is recorded as dropped, the rest go on
  const recipe = generateRecipe(settings);
  const drafts: Awaited<ReturnType<typeof generateQuestionsDetailed>>['drafts'] = [];
  const dropped: { group: number; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [gi, g] of groups.entries()) {
    try {
      const r = await generateQuestionsDetailed(kg.llm, chunks, [g], recipe);
      for (const d of r.drafts) {
        if (seen.has(d.question)) dropped.push({ group: gi, reason: 'duplicate question' });
        else (seen.add(d.question), drafts.push(d));
      }
      for (const d of r.dropped) dropped.push({ group: gi, reason: d.reason });
    } catch (e) {
      dropped.push({ group: gi, reason: `generation failed: ${(e as Error).message}` });
    }
    if (gi % 10 === 9) console.log(`group ${gi + 1}/${groups.length}: ${drafts.length} questions, ${dropped.length} dropped, ${Math.round((performance.now() - t) / 1000)} s`);
  }
  const genRecipeId = recipeId(recipe);
  console.log(`${dropped.length} groups or drafts dropped`, JSON.stringify(dropped.reduce<Record<string, number>>((m, d) => ((m[d.reason.slice(0, 40)] = (m[d.reason.slice(0, 40)] ?? 0) + 1), m), {})), `in ${Math.round(performance.now() - t)} ms`);
  const questions: EvalQuestion[] = drafts.map((d, i) => ({ ...d, id: `${author[0]}${tag.replace('-', '')}${i + 1}` }));
  const set: EvalSet = { id: evalSetId(questions as never), name: `stat-mech-${author}`, genRecipeId, questions };
  writeFileSync(join(out, `eval-set-${author}${tag}.json`), JSON.stringify(set, null, 1));
  writeFileSync(join(out, `dropped-${author}${tag}.json`), JSON.stringify(dropped.map((d) => ({ ...d, group: groups[d.group] ? { index: d.group, type: groups[d.group]!.type, chunkIds: groups[d.group]!.chunkIds } : d.group })), null, 1));
  const count = (f: (q: EvalQuestion) => string) => questions.reduce<Record<string, number>>((m, q) => ((m[f(q)] = (m[f(q)] ?? 0) + 1), m), {});
  console.log('by type', count((q) => q.type), 'by doc', count((q) => q.sourceDocKeys.join('+')), 'with formula in gold', questions.filter((q) => q.goldText.some((g) => g.includes('[formula]'))).length);
  void byId;
}

if (stage === 'merge') {
  // rounds r1 and r2 into -all, then (when review-<author>.json lists excluded ids) the final pinned set
  const load = (f: string) => JSON.parse(readFileSync(join(out, f), 'utf8')) as EvalSet;
  const r1 = load(`eval-set-${author}-r1.json`);
  const r2 = load(`eval-set-${author}-r2.json`);
  const seenQ = new Set<string>();
  const all = [...r1.questions, ...r2.questions].filter((q) => !seenQ.has(q.question) && !!seenQ.add(q.question));
  const mk = (qs: EvalQuestion[], name: string): EvalSet => ({ id: evalSetId(qs as never), name, genRecipeId: r1.genRecipeId, questions: qs });
  writeFileSync(join(out, `eval-set-${author}-all.json`), JSON.stringify(mk(all, `stat-mech-${author}-all`), null, 1));
  console.log(`${author}: ${all.length} questions before review`);
  try {
    const ex = new Set((JSON.parse(readFileSync(join(out, `exclude-${author}.json`), 'utf8')) as { id: string }[]).map((e) => e.id));
    // a reviewed question is also dropped when an earlier kept one has the same type and the same gold chunks
    const goldKey = new Set<string>();
    const kept = all.filter((q) => {
      if (ex.has(q.id)) return false;
      const k = `${q.type}|${q.goldChunkIds.join(',')}`;
      return !goldKey.has(k) && !!goldKey.add(k);
    });
    writeFileSync(join(out, `eval-set-${author}.json`), JSON.stringify(mk(kept, `stat-mech-${author}`), null, 1));
    console.log(`${author}: ${kept.length} questions after excluding ${all.length - kept.length}`);
  } catch {
    console.log('no exclude file yet');
  }
}
kg.close();
