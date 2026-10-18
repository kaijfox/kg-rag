/**
 * End-to-end run of the real composition on the stat-mech corpus. Stages (run in order, state lives in the database):
 *   ingest   ingest the four PDFs from cached parse artifacts, then ingest again unchanged
 *   search   run the query set (exact-term, paraphrase, ...) and two deliberately failing calls
 *   mcp      call search and feedback through the real MCP SDK client over an in-memory transport
 *   eval     generate questions with qwen3.5, run the 'retrieved' and 'gold' conditions, judge
 * Usage: tsx scripts/integrate.ts <stage> [--db path] [--questions n]
 * Needs Ollama at localhost:11434 with embeddinggemma and qwen3.5. Output is printed and written to scratch/integration/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { evalSetId, type Chunk, type ChunkId, type EvalQuestion, type EvalSet, type SearchResponse } from '@kg/core';
import { describeDropped, generateQuestionsDetailed, generateRecipe, GENERATE_SETTINGS, makeJudge } from '@kg/eval';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const stage = process.argv[2] ?? 'ingest';
const outDir = join(root, 'scratch/integration');
mkdirSync(outDir, { recursive: true });
const dbPath = arg('--db', join(outDir, 'stat-mech.kg.sqlite'));
const corpus = join(root, 'test/corpa/stat-mech');
const PDFS = ['FoundationsKardar', 'FoundationsPlischke', 'ThermoKardar', 'ThermoPlischke'];

const ms = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const v = await f();
  return [v, Math.round(performance.now() - t)];
};
const kg = compose({ dbPath, artifactDir: join(corpus, 'artifacts') });
const report: Record<string, unknown> = {};
const save = () => writeFileSync(join(outDir, `run-${stage}${process.argv.includes('--tag') ? '-' + arg('--tag', '') : ''}.json`), JSON.stringify(report, null, 2));

const label = (id: string) => {
  const i = kg.store.getItems([id as never])[0] as Chunk | undefined;
  if (!i) return id.slice(0, 9);
  const v = kg.store.currentDocVersions().find((d) => d.docKey === i.docKey);
  return `${i.docKey}#${v?.chunkIds.indexOf(i.id as ChunkId)} p${i.pages.join(',')} [${i.sectionPath.join(' > ').slice(0, 50)}]`;
};

if (stage === 'ingest') {
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: 'integrate-ingest' });
  const sources = PDFS.map((n) => ({ path: join(corpus, `${n}.pdf`), docKey: n }));
  const [first, t1] = await ms(() => kg.api.ingest(sessionId, { sources }));
  const [second, t2] = await ms(() => kg.api.ingest(sessionId, { sources }));
  report.firstIngest = { ms: t1, report: first };
  report.secondIngest = { ms: t2, report: second };
  report.sameBuild = JSON.stringify(first) !== undefined && (first as { buildId?: string }).buildId === (second as { buildId?: string }).buildId;
  console.log('first ingest', t1, 'ms', JSON.stringify(first, null, 1));
  console.log('second ingest', t2, 'ms', JSON.stringify(second, null, 1));
  const embeds = kg.db.prepare("SELECT COUNT(*) n FROM events WHERE type='ingest.embedded'").all();
  report.embeddedEvents = kg.db.prepare("SELECT payload FROM events WHERE type='ingest.embedded' ORDER BY ts").all();
  console.log(embeds, report.embeddedEvents);
  save();
}

if (stage === 'search') {
  const { sessionId } = await kg.api.openSession({ kind: 'agent', label: 'integrate-search' });
  const queries: [string, string][] = [
    ['natural', 'What does the first law of thermodynamics say about heat and work?'],
    ['natural', 'How is the Helmholtz free energy obtained from the partition function?'],
    ['exact-term', 'Clausius inequality'],
    ['exact-term', 'Maxwell relations'],
    ['exact-term', 'Gibbs-Duhem relation'],
    ['paraphrase', 'why does a gas not change temperature when it expands into a vacuum'],
    ['paraphrase', 'the most efficient engine possible between a hot and a cold reservoir'],
    ['natural', 'Liouville theorem and conservation of phase space volume'],
    ['natural', 'What is the ergodic hypothesis and why is it needed?'],
    ['natural', 'Boltzmann definition of entropy as the logarithm of the number of microstates'],
    ['natural', 'Landau theory of continuous phase transitions'],
  ];
  const rows = [];
  for (const [kind, q] of queries) {
    const [res, t] = await ms(() => kg.api.search(sessionId, { query: q, k: 5 }));
    rows.push({ kind, q, ms: t, searchId: res.searchId, buildId: res.buildId, top: res.items.map((i) => ({ score: +i.score.toFixed(3), at: label(i.itemId) })), topText: res.items[0]?.text.slice(0, 200) });
    console.log(`\n[${kind}] ${q}  (${t} ms)`);
    for (const i of res.items) console.log(`   ${i.score.toFixed(3)}  ${label(i.itemId)}`);
  }
  report.queries = rows;
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  report.latency = { median: lat[Math.floor(lat.length / 2)], max: lat.at(-1), min: lat[0] };
  const fails: Record<string, string> = {};
  for (const [name, call] of [
    ['empty-query', () => kg.api.search(sessionId, { query: '', k: 5 })],
    ['unknown-build', () => kg.api.search(sessionId, { query: 'entropy', k: 5, buildId: 'bd_aaaaaaaaaaaaaaaaaaaa' as never })],
    ['unknown-search-feedback', () => kg.api.feedback(sessionId, { searchId: 'sr_0000000000000000000000ZZZZ' as never, overall: 1 })],
  ] as const) {
    try {
      await call();
      fails[name] = 'NO ERROR';
    } catch (e) {
      fails[name] = `${(e as { code?: string }).code}: ${(e as Error).message}`;
    }
  }
  // a failure inside the pipeline: the embedder cannot reach Ollama
  const dead = compose({ dbPath, artifactDir: join(corpus, 'artifacts'), ollamaUrl: 'http://127.0.0.1:1' });
  const deadSession = await dead.api.openSession({ kind: 'agent', label: 'integrate-embedder-down' });
  try {
    await dead.api.search(deadSession.sessionId, { query: 'entropy', k: 5 });
    fails['embedder-down'] = 'NO ERROR';
  } catch (e) {
    fails['embedder-down'] = `${(e as { code?: string }).code}: ${(e as Error).message}`;
  }
  report.deadSessionId = deadSession.sessionId;
  dead.close();
  report.failures = fails;
  console.log(fails);
  // feedback and usage on the first search
  const first = rows[0]!;
  const top = kg.log.eventsBySearch(first.searchId as never).find((e) => e.type === 'search.result');
  report.sessionId = sessionId;
  report.firstSearchId = first.searchId;
  console.log('search.result payload', JSON.stringify(top?.payload).slice(0, 300));
  save();
}

if (stage === 'mcp') {
  const server = kg.mcpServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'integration-client', version: '0.0.1' });
  await client.connect(ct);
  const tools = await client.listTools();
  report.tools = tools.tools.map((t) => t.name);
  console.log('tools', report.tools);
  const [s, tSearch] = await ms(() => client.callTool({ name: 'search', arguments: { query: 'Carnot cycle efficiency', k: 3 } }));
  const sr = s.structuredContent as unknown as SearchResponse;
  console.log('search via MCP', tSearch, 'ms', s.isError, sr?.searchId, sr?.items.length);
  const fb = await client.callTool({ name: 'feedback', arguments: { searchId: sr.searchId, overall: 2, items: [{ itemId: sr.items[0]!.itemId, relevance: 2 }], note: 'mcp client check' } });
  console.log('feedback', fb.isError, JSON.stringify(fb.content).slice(0, 200));
  const bad = await client.callTool({ name: 'search', arguments: { query: '' } });
  console.log('bad search', bad.isError, JSON.stringify(bad.content).slice(0, 200));
  const badFb = await client.callTool({ name: 'feedback', arguments: { searchId: 'sr_0000000000000000000000ZZZZ', overall: 1 } });
  console.log('unknown search feedback', badFb.isError, JSON.stringify(badFb.content).slice(0, 200));
  report.mcp = { searchMs: tSearch, searchId: sr.searchId, feedback: fb, badSearch: bad, badFeedback: badFb };
  await client.close();
  save();
}

if (stage === 'eval') {
  const nQ = Number(arg('--questions', '8'));
  const build = kg.store.currentBuild()!;
  const docs = kg.store.currentDocVersions();
  const chunkIds = docs.flatMap((d) => d.chunkIds);
  const chunks = kg.store.getItems(chunkIds).filter((i): i is Chunk => i.kind === 'chunk');
  // deterministic sample: every n-th substantial chunk, single-hop on each; two adjacent-chunk multi-hop groups
  const good = chunks.filter((c) => c.text.length > 600 && !/\[formula\]\s*$/.test(c.text));
  const step = Math.floor(good.length / nQ);
  const groups = Array.from({ length: nQ }, (_, i) => ({ type: 'single-hop' as const, chunkIds: [good[i * step]!.id] }));
  const settings = { ...GENERATE_SETTINGS, mix: { 'single-hop': 1, 'multi-hop': 0, topic: 0 } };
  const t0 = performance.now();
  const { drafts, dropped, genRecipeId } = await generateQuestionsDetailed(kg.llm, chunks, groups, generateRecipe(settings));
  console.log(describeDropped(dropped));
  const tGen = Math.round(performance.now() - t0);
  const questions: EvalQuestion[] = drafts.map((d, i) => ({ ...d, id: `q${i + 1}` }));
  const set: EvalSet = { id: evalSetId(questions as never), name: 'stat-mech-integration', genRecipeId, questions };
  writeFileSync(join(outDir, `eval-set-${arg('--tag', 'a')}.json`), JSON.stringify(set, null, 2));
  console.log(`generated ${questions.length} questions from ${groups.length} groups in ${tGen} ms`);
  for (const q of questions) console.log(`  ${q.id} [${q.type}] ${q.question}`);
  const t1 = performance.now();
  const out = await kg.runEval(
    { rt: kg.runtime, api: kg.api, store: kg.store, answerer: kg.llm, judge: makeJudge(kg.llm), repo: kg.repo },
    set,
    { conditions: arg('--conditions', 'retrieved,gold').split(','), ks: [1, 5], buildId: build },
  );
  const tEval = Math.round(performance.now() - t1);
  console.log(`eval run ${tEval} ms for ${questions.length} questions x 2 conditions`, JSON.stringify(out.summary, null, 1));
  report.eval = { questions: questions.length, generateMs: tGen, runMs: tEval, perQuestionMs: Math.round(tEval / questions.length), summary: out.summary, runId: out.runId };
  save();
}
kg.close();
