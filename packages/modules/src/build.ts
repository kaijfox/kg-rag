/**
 * Ingest and rebuild. `ingest` runs the build machine on the current index (new and changed sources only do work).
 * `rebuild` builds a new index file from the kept sources, reusing the model-call cache and replaying confirmed
 * corrections, checks it, and swaps it in. `redo` limits a rebuild to one module's output: the current index is copied
 * and that module's records are deleted and made again.
 */
import { join } from 'node:path';
import { Kg, IndexStore, KgError, ulidGen, runMachine, validateSpace, type Json, type SourceEntry } from '@kg/kernel';
import { ArtifactStore } from './parse/artifacts';
import { defaultAdapters } from './adapters';
import type { ModuleServices } from './services';

export interface BuildReport {
  indexId: string;
  documents: { docKey: string; chunks: number; unchanged: boolean }[];
  embedded: number;
  facts: number;
  links: number;
  stats: ReturnType<IndexStore['stats']>;
}

export interface BuildOptions {
  sessionId?: string;
  /** the docling command; null runs no parser (a missing parsed document is an error) */
  sidecar?: string | null;
  /** extra directories searched for parsed documents produced elsewhere */
  artifactDirs?: string[];
}

function servicesFor(kg: Kg, sessionId: string, index: IndexStore, o: BuildOptions): ModuleServices {
  validateSpace(kg.config.space);
  const space = index.putSpace(kg.config.space);
  const base = kg.services as { embedder?: ModuleServices['embedder']; llm?: ModuleServices['llm'] };
  if (!base.embedder) throw new KgError('precondition', 'no embedder: start Ollama and pass one in the services');
  return {
    embedder: base.embedder,
    space,
    llm: kg.llmFor(sessionId, base.llm),
    corrections: kg.history.corrections(),
    adapters: defaultAdapters(),
    artifacts: new ArtifactStore({ dir: kg.path(kg.config.artifactsDir), extraDirs: o.artifactDirs, sidecar: o.sidecar ?? null }),
    baseDir: kg.dir,
  };
}

async function runBuild(kg: Kg, index: IndexStore, sessionId: string, sources: SourceEntry[], o: BuildOptions): Promise<BuildReport> {
  const def = kg.registry.machine(kg.config.buildMachine);
  const { state } = await runMachine(def, { sources }, {
    index,
    services: servicesFor(kg, sessionId, index, o) as never,
    config: kg.config,
    registry: kg.registry,
    now: kg.now,
    mayWrite: true,
    log: (type, payload) => kg.history.append(sessionId, type, payload, { indexId: index.indexId }),
  });
  const count = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    indexId: index.indexId,
    documents: (state.segmented ?? []) as BuildReport['documents'],
    embedded: count(state.embedded),
    facts: count((state.extracted as { facts?: number } | undefined)?.facts),
    links: count(state.corrected) + count(state.linked),
    stats: index.stats(),
  };
}

/** Adds the sources (default: every source in kg.json) to the current index. */
export async function ingest(kg: Kg, o: BuildOptions & { sources?: SourceEntry[] } = {}): Promise<BuildReport> {
  const sessionId = o.sessionId ?? kg.openSession('ingest');
  kg.history.append(sessionId, 'ingest.started', { sources: (o.sources ?? kg.config.sources).length }, { indexId: kg.index.indexId });
  const report = await runBuild(kg, kg.index, sessionId, o.sources ?? kg.config.sources, o);
  kg.history.append(sessionId, 'ingest.finished', report as unknown as Json, { indexId: kg.index.indexId });
  return report;
}

export interface RebuildResult {
  report: BuildReport;
  previousIndexId: string;
  keptOld: string | null;
}

/**
 * Builds a new index and swaps it in. After this the `Kg` handle still points at the old file: open the directory again.
 * The new index must pass the audit (every derived item cites a chunk, nothing points nowhere) or the swap is refused.
 */
export async function rebuild(kg: Kg, o: BuildOptions & { keepOld?: boolean; redo?: string[] } = {}): Promise<RebuildResult> {
  const sessionId = o.sessionId ?? kg.openSession('rebuild');
  const previous = kg.index.indexId;
  const newId = ulidGen().ulid('ix_');
  const tmp = join(kg.dir, `index.${newId}.sqlite.tmp`);
  kg.history.append(sessionId, 'rebuild.started', { from: previous, to: newId, redo: o.redo ?? [] }, { indexId: newId });
  let index: IndexStore;
  if (o.redo?.length) {
    index = kg.index.copyAs(tmp, newId);
    for (const name of o.redo) {
      let deleted = { items: 0, links: 0 };
      for (const mod of kg.registry.modules.values()) if (mod.name === name) deleted = index.deleteMadeBy(`${mod.name}@${mod.version}`);
      kg.history.append(sessionId, 'rebuild.redo', { module: name, ...deleted }, { indexId: newId });
    }
  } else index = IndexStore.open(tmp, { indexId: newId });
  try {
    const report = await runBuild(kg, index, sessionId, kg.config.sources, o);
    const problems = index.audit();
    if (problems.length) throw new KgError('internal', `the rebuilt index failed its audit: ${problems.join('; ')}`);
    index.close();
    const keptOld = Kg.swapIndex(kg.dir, tmp, { keepOld: o.keepOld, oldId: previous });
    kg.history.append(sessionId, 'rebuild.finished', { from: previous, to: newId, kept: keptOld, stats: report.stats }, { indexId: newId });
    return { report, previousIndexId: previous, keptOld };
  } catch (e) {
    try {
      index.close();
    } catch {
      // already closed
    }
    kg.history.append(sessionId, 'rebuild.failed', { to: newId, error: e instanceof Error ? e.message : String(e) }, { indexId: newId });
    throw e;
  }
}
