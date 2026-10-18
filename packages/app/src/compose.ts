/**
 * The real composition: SQLite store and event log in one database file, the parse package with a directory of
 * cached artifacts (and the sidecar as fallback), the section-pack chunker, the Ollama embedder, ingest, search,
 * the KgApi handlers, and the surfaces on top (MCP server, viewer, eval runner). The only module that knows
 * every package; nothing here is business logic.
 */
import {
  DEFAULT_CONFIG,
  KgError,
  createKgApi,
  systemClock,
  ulidGen,
  type Clock,
  type DatabaseConfig,
  type Embedder,
  type IdGen,
  type KgApi,
  type Llm,
  type MachineMap,
  type ParseArtifact,
  type ParseRecipeSpec,
  type Parser,
  type SourceRef,
  type ToolRuntime,
} from '@kg/core';
import { createApiHandlers } from '@kg/api';
import { renderChunkView, sectionPack } from '@kg/chunk';
import { ollamaEmbedder } from '@kg/embed';
import { documentMachine, ingestMachine, createIngest } from '@kg/ingest';
import { evalRunMachine, runEval } from '@kg/eval';
import { SqliteEventLog } from '@kg/eventlog';
import { ArtifactDirParser, SubprocessParser } from '@kg/parse';
import { machineMapOf } from '@kg/pipeline';
import { createSearch, searchMachines } from '@kg/search';
import { SqliteCorpusStore, SqliteEvalRepo, openDatabase } from '@kg/store';
import { createViewerServer } from '@kg/viewer';
import { createMcpServer, serveStdio } from '@kg/mcp';
import { ollamaLlm } from './ollamaLlm';

export interface ComposeOptions {
  /** the one database file (store, event log, eval results); ':memory:' for a throwaway */
  dbPath: string;
  /** directory of *.kgparse.json(.gz) artifacts served before the sidecar is tried */
  artifactDir?: string;
  /** run the kg-parse sidecar when no cached artifact matches; default false (a miss is then `not_found`) */
  sidecar?: boolean | string;
  config?: DatabaseConfig;
  /** default: Ollama, with the digest pinned in the config's space */
  embedder?: Embedder;
  /** default: local Ollama chat */
  llm?: Llm;
  clock?: Clock;
  ids?: IdGen;
  ollamaUrl?: string;
}

/** Tries the cached-artifact directory first, then the sidecar (when configured). */
export class CachedParser implements Parser {
  constructor(
    private readonly cache: Parser,
    private readonly fallback: Parser | null,
  ) {}
  identify(path: string) {
    return this.cache.identify(path);
  }
  readArtifact(path: string) {
    return this.cache.readArtifact(path);
  }
  async parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    try {
      return await this.cache.parse(src, recipe);
    } catch (e) {
      if (!(e instanceof KgError) || e.code !== 'not_found' || this.fallback === null) throw e;
      return this.fallback.parse(src, recipe);
    }
  }
}

/** Map of every machine the viewer may be asked to draw, keyed by `machine@version`. */
export function machineMaps(): Map<string, MachineMap> {
  const m = new Map<string, MachineMap>();
  for (const e of Object.values(searchMachines)) m.set(`${e.name}@${e.version}`, machineMapOf(e.machine, { machine: e.name, version: e.version }));
  m.set('ingest@1', machineMapOf(ingestMachine, { machine: 'ingest', version: '1' }));
  m.set('document@1', machineMapOf(documentMachine, { machine: 'document', version: '1' }));
  m.set('eval-run@1', machineMapOf(evalRunMachine, { machine: 'eval-run', version: '1' }));
  return m;
}

export function compose(o: ComposeOptions) {
  const clock = o.clock ?? systemClock;
  const ids = o.ids ?? ulidGen();
  const config = o.config ?? DEFAULT_CONFIG;
  const db = openDatabase(o.dbPath);
  const store = new SqliteCorpusStore(db, clock);
  const log = new SqliteEventLog(db, clock, ids);
  const repo = new SqliteEvalRepo(db);

  const cache = new ArtifactDirParser(o.artifactDir ?? '/nonexistent-artifact-dir');
  const sidecar = o.sidecar ? new SubprocessParser(typeof o.sidecar === 'string' ? { command: o.sidecar } : {}) : null;
  const parser = new CachedParser(cache, sidecar);

  const embedder =
    o.embedder ??
    ollamaEmbedder(config.space.model, config.space.dims, {
      ...(config.space.digest ? { digest: config.space.digest } : {}),
      ...(o.ollamaUrl ? { baseUrl: o.ollamaUrl } : {}),
    });
  const llm = o.llm ?? ollamaLlm(o.ollamaUrl ? { baseUrl: o.ollamaUrl } : {});

  const search = createSearch({ store, embedder, llm });
  const ingest = createIngest({ store, parser, chunker: sectionPack, chunkView: renderChunkView, embedder, config });
  const runtime: ToolRuntime = { log, clock, ids, currentBuild: () => store.currentBuild() };
  const api: KgApi = createKgApi(runtime, createApiHandlers({ store, log, search, ingest }));

  const maps = machineMaps();
  const itemInfo = (id: string) => {
    const [item] = store.getItems([id as never]);
    if (!item) return null;
    if (item.kind !== 'chunk') return { label: item.id, text: '' };
    const doc = store.currentDocVersions().find((v) => v.docKey === item.docKey);
    const idx = doc ? doc.chunkIds.indexOf(item.id) : -1;
    return { label: `${item.docKey}#${idx >= 0 ? idx : '?'}`, text: item.text };
  };

  return {
    db,
    store,
    log,
    repo,
    api,
    search,
    ingest,
    runtime,
    config,
    embedder,
    llm,
    parser,
    ids,
    clock,
    /** the MCP server over this composition (connect a transport yourself) */
    mcpServer: () => createMcpServer(api),
    /** the MCP server on stdin and stdout */
    serveMcp: () => serveStdio(api),
    /** the viewer; pass `port` to listen at once */
    viewer: (port?: number) =>
      createViewerServer(log, {
        ...(port !== undefined ? { port } : {}),
        itemInfo,
        machines: (machine, version) => maps.get(`${machine}@${version}`) ?? null,
      }),
    runEval,
    close: () => db.close(),
  };
}

export type Composition = ReturnType<typeof compose>;
export { ollamaLlm };
