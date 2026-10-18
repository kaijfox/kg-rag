/**
 * ingestScenarios: IngestService invariants on the mini-corpus (core/ports/ingest.ts). Expected counts come
 * from the hand-derived fixtures (expected-chunks-v*.json, expected-diff.json), never from an ingest run.
 */
import { expect } from 'vitest';
import {
  TOOLS,
  KgError,
  docVersionId,
  recipeId,
  renderDocument,
  runTool,
  spaceId,
  type Chunker,
  type ChunkId,
  type Clock,
  type CorpusStore,
  type DatabaseConfig,
  type DocKey,
  type Embedder,
  type EventEnvelope,
  type IdGen,
  type IngestReport,
  type IngestRequest,
  type IngestService,
  type Parser,
  type ParseArtifact,
  type ParseRecipeSpec,
  type SourceRef,
} from '@kg/core';
import { HashEmbedder } from '../fakes/embedder';
import { InMemoryEventLog } from '../fakes/eventlog';
import { FixedClock, SeqIds } from '../fakes/infra';
import { FixtureParser } from '../fakes/parser';
import { InMemoryCorpusStore } from '../fakes/store';
import { MINI_DOCS, miniArtifactPath, miniConfig, miniDiff, miniExpected, miniLabels, miniParserEntries, miniSourcePath, type MiniDoc } from '../fixtures';
import { expectKgError, type Suite } from './harness';

export interface IngestDeps {
  store: CorpusStore;
  parser: Parser;
  chunker: Chunker;
  embedder: Embedder;
  config: DatabaseConfig;
  clock: Clock;
  ids: IdGen;
}

class CountingParser extends FixtureParser {
  parses = 0;
  override async parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    this.parses++;
    return super.parse(src, recipe);
  }
}
class CountingEmbedder extends HashEmbedder {
  texts = 0;
  seen: string[] = [];
  failAfter = Infinity;
  override async embed(texts: readonly string[]) {
    if (this.texts + texts.length > this.failAfter) throw new KgError('upstream', 'embedder failed mid-batch (scripted)');
    this.texts += texts.length;
    this.seen.push(...texts);
    return super.embed(texts);
  }
}

function setup(make: (d: IngestDeps) => IngestService, chunker: Chunker) {
  const clock = new FixedClock();
  const ids = new SeqIds();
  const store = new InMemoryCorpusStore(clock);
  const parser = new CountingParser(miniParserEntries());
  const embedder = new CountingEmbedder(4096);
  let service = make({ store, parser, chunker, embedder, config: miniConfig(), clock, ids });
  const log = new InMemoryEventLog(clock, ids);
  const session = log.openSession({ kind: 'test', label: 'ingest', meta: {} });
  const rt = { log, clock, ids, currentBuild: () => store.currentBuild() };
  const ingest = async (req: IngestRequest) => {
    const mark = log.events(session).at(-1)!.seq;
    const report = await runTool(rt, TOOLS.ingest, session, req, (ctx, r) => service.ingest(ctx, r));
    return { report, events: log.events(session, mark) as EventEnvelope[] };
  };
  /** rebuild the service over the same store with another config (e.g. a new embedding space) */
  const reconfigure = (config: DatabaseConfig) => {
    service = make({ store, parser, chunker, embedder, config, clock, ids });
  };
  return { store, parser, embedder, log, session, ingest, reconfigure };
}

const sources = (v: 1 | 2, docs: readonly MiniDoc[] = MINI_DOCS): IngestRequest => ({ sources: docs.map((d) => ({ path: miniSourcePath(v, d) })) });
const artifacts = (v: 1 | 2): IngestRequest => ({ artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(v, d) })) });
const doc = (r: IngestReport, d: MiniDoc) => r.docs.find((x) => x.docKey === d)!;
const expectedIds = (v: 1 | 2, d: MiniDoc): ChunkId[] => {
  const labels = miniLabels();
  return miniExpected(v)[d].map((c) => labels[c.label]!);
};

export function ingestScenarios(make: (d: IngestDeps) => IngestService, chunker: Chunker): Suite {
  return {
    name: 'ingestScenarios',
    cases: [
      {
        name: 'first ingest: chunks inserted, doc versions current, one build over all chunks, all embedded',
        async run() {
          const t = setup(make, chunker);
          const { report } = await t.ingest(sources(1));
          expect(report.docs.map((d) => d.docKey)).toEqual(MINI_DOCS);
          for (const d of MINI_DOCS) {
            expect(doc(report, d)).toMatchObject({ unchanged: false, inserted: expectedIds(1, d).length, reused: 0, dropped: 0 });
          }
          expect(report.buildChanged).toBe(true);
          expect(t.store.currentBuild()).toBe(report.buildId);
          const all = MINI_DOCS.flatMap((d) => expectedIds(1, d)).sort();
          expect(t.store.getBuild(report.buildId)!.itemIds).toEqual(all);
          const space = t.store.getBuild(report.buildId)!.manifest.embeddingSpaces[0]!;
          expect(t.store.missingEmbeddings(space, all)).toEqual([]);
          expect(t.store.currentDocVersions().map((v) => v.chunkIds)).toEqual(MINI_DOCS.map((d) => expectedIds(1, d)));
          expect(t.store.getBuild(report.buildId)!.manifest.searchRecipeId).toBe(recipeId(miniConfig().searchRecipe));
        },
      },
      {
        name: 'events: per document started, parsed, chunked, embedded, completed; then build.created once',
        async run() {
          const t = setup(make, chunker);
          const { report, events } = await t.ingest(sources(1));
          const domain = events.filter((e) => e.type.startsWith('ingest.') || e.type === 'build.created');
          for (const d of MINI_DOCS) {
            const mine = domain.filter((e) => (e.payload as { docKey?: string }).docKey === d).map((e) => e.type);
            expect(mine, d).toEqual(['ingest.started', 'ingest.parsed', 'ingest.chunked', 'ingest.embedded', 'ingest.completed']);
          }
          const builds = domain.filter((e) => e.type === 'build.created');
          expect(builds.length).toBe(1);
          expect(domain.at(-1)!.type).toBe('build.created');
          expect(builds[0]!.buildId).toBe(report.buildId);
          const chunked = domain.filter((e): e is EventEnvelope<'ingest.chunked'> => e.type === 'ingest.chunked');
          for (const c of chunked) expect(c.payload.inserted).toBe(doc(report, c.payload.docKey as MiniDoc).inserted);
        },
      },
      {
        name: 'chunks are embedded through the space document template (headings included)',
        async run() {
          const t = setup(make, chunker);
          await t.ingest(sources(1));
          for (const d of MINI_DOCS)
            for (const c of miniExpected(1)[d]) expect(t.embedder.seen, c.label).toContain(renderDocument(miniConfig().space, { text: c.text, sectionPath: c.sectionPath }));
        },
      },
      {
        name: 'S2: after a space switch, ingesting one document still yields a build whose every item is embedded in the new space',
        async run() {
          const t = setup(make, chunker);
          await t.ingest(sources(1));
          const space2 = { ...miniConfig().space, documentTemplate: 'section: {headings}\n{text}' };
          t.reconfigure({ ...miniConfig(), space: space2 });
          const { report } = await t.ingest(sources(1, ['gas']));
          const b = t.store.getBuild(report.buildId)!;
          expect(b.manifest.embeddingSpaces).toEqual([spaceId(space2)]);
          expect(b.itemIds).toEqual(MINI_DOCS.flatMap((d) => expectedIds(1, d)).sort());
          expect(t.store.missingEmbeddings(spaceId(space2), b.itemIds)).toEqual([]);
          expect(report.buildChanged).toBe(true);
        },
      },
      {
        name: 're-ingesting unchanged content writes nothing, re-embeds nothing, keeps the build',
        async run() {
          const t = setup(make, chunker);
          const first = await t.ingest(sources(1));
          const embedded = t.embedder.texts;
          const { report, events } = await t.ingest(sources(1));
          expect(report.buildId).toBe(first.report.buildId);
          expect(report.buildChanged).toBe(false);
          for (const d of MINI_DOCS) expect(doc(report, d)).toMatchObject({ unchanged: true, inserted: 0, reused: expectedIds(1, d).length, dropped: 0 });
          expect(t.embedder.texts).toBe(embedded);
          expect(events.some((e) => e.type === 'build.created')).toBe(false);
        },
      },
      {
        name: 'parse artifacts are cached by (sha256, parse recipe): the second ingest does not parse again',
        async run() {
          const t = setup(make, chunker);
          await t.ingest(sources(1));
          const parses = t.parser.parses;
          const { events } = await t.ingest(sources(1));
          expect(t.parser.parses).toBe(parses);
          const parsed = events.filter((e): e is EventEnvelope<'ingest.parsed'> => e.type === 'ingest.parsed');
          expect(parsed.map((e) => e.payload.origin)).toEqual(['cache', 'cache']);
        },
      },
      {
        name: 'v1 -> v2: inserted / reused / dropped match the hand-derived diff; new build; old build becomes stale',
        async run() {
          const t = setup(make, chunker);
          const a = await t.ingest(sources(1));
          const { report } = await t.ingest(sources(2));
          const labels = miniLabels();
          const diff = miniDiff();
          const surviving = new Set(diff.survive.map((l) => labels[l]!));
          for (const d of MINI_DOCS) {
            const v1 = expectedIds(1, d);
            const v2 = expectedIds(2, d);
            expect(doc(report, d)).toMatchObject({
              unchanged: false,
              reused: v2.filter((c) => surviving.has(c)).length,
              inserted: v2.filter((c) => !surviving.has(c)).length,
              dropped: v1.filter((c) => !surviving.has(c)).length,
            });
          }
          expect(report.buildChanged).toBe(true);
          expect(t.store.getBuild(report.buildId)!.parentId).toBe(a.report.buildId);
          expect(t.store.staleCheck(a.report.buildId)).toEqual({
            buildId: a.report.buildId,
            missingChunkIds: diff.vanish.map((l) => labels[l]!).sort(),
            stale: true,
          });
          expect(t.store.staleCheck(report.buildId).stale).toBe(false);
        },
      },
      {
        name: 'importing artifact files gives exactly the doc versions and build that parsing the sources gives',
        async run() {
          const a = setup(make, chunker);
          const b = setup(make, chunker);
          const viaSources = await a.ingest(sources(1));
          const viaArtifacts = await b.ingest(artifacts(1));
          expect(viaArtifacts.report.buildId).toBe(viaSources.report.buildId);
          expect(viaArtifacts.report.docs.map((d) => d.docVersionId)).toEqual(viaSources.report.docs.map((d) => d.docVersionId));
          expect(b.parser.parses).toBe(0);
          const parsed = viaArtifacts.events.filter((e): e is EventEnvelope<'ingest.parsed'> => e.type === 'ingest.parsed');
          expect(parsed.map((e) => e.payload.origin)).toEqual(['imported', 'imported']);
        },
      },
      {
        name: 'an embedder failure mid-ingest leaves no doc version, no pointer change and no new build',
        async run() {
          const t = setup(make, chunker);
          const first = await t.ingest(sources(1));
          const before = t.store.currentDocVersions();
          t.embedder.failAfter = t.embedder.texts + 1;
          await expectKgError(() => t.ingest(sources(2)), 'upstream');
          expect(t.store.currentDocVersions()).toEqual(before);
          expect(t.store.currentBuild()).toBe(first.report.buildId);
          const art = (d: MiniDoc) => t.store.findArtifact(miniParserEntries().find((e) => e.path === miniSourcePath(2, d))!.artifact.sourceSha256, recipeId(miniConfig().parseRecipe));
          for (const d of MINI_DOCS) {
            const aid = art(d);
            if (aid) expect(t.store.getDocVersion(docVersionId(d as DocKey, aid, recipeId(miniConfig().chunkRecipe)))).toBeNull();
          }
          expect(t.log.events(t.session).at(-1)!.type).toBe('tool.failed');
        },
      },
      {
        name: 'a failure on a fresh database leaves it empty (no build, no current versions)',
        async run() {
          const t = setup(make, chunker);
          t.embedder.failAfter = 3;
          await expectKgError(() => t.ingest(sources(1)), 'upstream');
          expect(t.store.currentBuild()).toBeNull();
          expect(t.store.currentDocVersions()).toEqual([]);
        },
      },
      {
        name: 'ingesting one document then another builds over all current documents',
        async run() {
          const t = setup(make, chunker);
          const a = await t.ingest(sources(1, ['gas']));
          expect(t.store.getBuild(a.report.buildId)!.itemIds).toEqual(expectedIds(1, 'gas').sort());
          const b = await t.ingest(sources(1, ['entropy']));
          expect(t.store.getBuild(b.report.buildId)!.itemIds).toEqual([...expectedIds(1, 'gas'), ...expectedIds(1, 'entropy')].sort());
          expect(Object.keys(t.store.getBuild(b.report.buildId)!.manifest.docVersions).sort()).toEqual(['entropy', 'gas']);
        },
      },
    ],
  };
}
