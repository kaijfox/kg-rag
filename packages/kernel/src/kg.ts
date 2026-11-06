/**
 * A database is a directory: kg.json (configuration and the source list), index.sqlite (rebuildable), history.sqlite
 * (durable), cache.sqlite (optional) and artifacts/ (parsed documents, kept). `Kg` opens one and runs machines on it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { KgError } from './errors';
import { spaceId, ulidGen, type Json } from './ids';
import { CacheStore } from './cacheStore';
import { DEFAULT_CONFIG, withDefaults, type KgConfig } from './defaults';
import { HistoryStore } from './historyStore';
import { IndexStore } from './indexStore';
import { Registry, type Services, type Slots } from './machine';
import { runMachine, type RunEnv, type StepTrace } from './runner';
import type { Candidate } from './types';
import { observedLlm, cachedLlm, type Llm } from './llm';

export interface SearchResult {
  searchId: string;
  machine: string;
  indexId: string;
  items: Candidate[];
  steps: StepTrace[];
}

export interface OpenOptions {
  /** create the directory and kg.json when missing */
  create?: boolean;
  registry?: Registry;
  /** model and embedding clients; the llm given here is wrapped with the cache and the call log */
  services?: Services;
  now?: () => string;
}

export class Kg {
  readonly registry: Registry;
  services: Services;
  private readonly ids = ulidGen();
  private constructor(
    readonly dir: string,
    readonly config: KgConfig,
    readonly index: IndexStore,
    readonly history: HistoryStore,
    readonly cache: CacheStore,
    registry: Registry,
    services: Services,
    readonly now: () => string,
  ) {
    this.registry = registry;
    this.services = services;
  }

  static open(dir: string, o: OpenOptions = {}): Kg {
    const root = resolve(dir);
    const configPath = join(root, 'kg.json');
    const now = o.now ?? (() => new Date().toISOString());
    if (!existsSync(configPath)) {
      if (!o.create) throw new KgError('not_found', `no database at ${root} (expected kg.json); create one with "kg init"`);
      mkdirSync(root, { recursive: true });
      writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    }
    const config = withDefaults(JSON.parse(readFileSync(configPath, 'utf8')) as Partial<KgConfig>);
    const index = IndexStore.open(join(root, 'index.sqlite'), { indexId: ulidGen().ulid('ix_') });
    const history = HistoryStore.open(join(root, 'history.sqlite'), now);
    const cache = CacheStore.open(join(root, 'cache.sqlite'), now);
    return new Kg(root, config, index, history, cache, o.registry ?? new Registry(), o.services ?? {}, now);
  }

  close(): void {
    this.index.close();
    this.history.close();
    this.cache.close();
  }

  /** An absolute path for something named in the config: sources and artifacts may be relative to the database directory. */
  path(p: string): string {
    return isAbsolute(p) ? p : join(this.dir, p);
  }

  saveConfig(patch: Partial<KgConfig>): void {
    const next = { ...this.config, ...patch };
    writeFileSync(join(this.dir, 'kg.json'), JSON.stringify(next, null, 2) + '\n');
    Object.assign(this.config, next);
  }

  /** The model client with the cache in front and every call reported to the session's log. */
  llmFor(sessionId: string, base: Llm | undefined = this.services.llm, o: { cacheOnly?: boolean } = {}): Llm | undefined {
    if (!base) return undefined;
    const cached = cachedLlm(base, this.cache, o);
    return observedLlm(cached, (info) => this.history.append(sessionId, 'llm.called', info as unknown as Json, { indexId: this.index.indexId }));
  }

  openSession(kind: string, label?: string): string {
    return this.history.openSession({ kind, label: label ?? null });
  }

  /** Runs a search machine. Logs the query, every step's received and returned ranks, and the final results. */
  async search(o: { query: string; k?: number; machine?: string; sessionId: string; extra?: Slots; shadow?: boolean }): Promise<SearchResult> {
    const name = o.machine ?? this.config.searchMachine;
    const def = this.registry.machine(name);
    const searchId = this.history.newSearchId();
    const k = o.k ?? 5;
    const indexId = this.index.indexId;
    const tag = { indexId, searchId };
    this.history.append(o.sessionId, 'search.started', { query: o.query, k, machine: name, version: def.version }, tag);
    const space = this.index.getSpace(spaceId(this.config.space as unknown as Json));
    if (!space) throw new KgError('precondition', 'this index has no embeddings in the configured space yet; run "kg ingest" first');
    const env: RunEnv = {
      index: this.index,
      services: { ...this.services, space, llm: this.llmFor(o.sessionId) },
      config: this.config,
      registry: this.registry,
      now: this.now,
      mayWrite: false,
      log: (type, payload) => this.history.append(o.sessionId, type, payload, tag),
    };
    const { state, steps } = await runMachine(def, { query: o.query, k, ...(o.extra ?? {}) }, env);
    const items = (state.results ?? []) as Candidate[];
    this.history.append(
      o.sessionId,
      'search.result',
      { items: items.map((c) => ({ id: c.id, kind: c.kind, score: c.score, sourceChunkIds: c.sourceChunkIds })) },
      tag,
    );
    if (o.shadow) await this.runShadow(o.sessionId, searchId, name, o.query, k, items);
    return { searchId, machine: name, indexId, items, steps };
  }

  /**
   * Runs the configured shadow machine on the same query and logs what it ranked, tagged with the same search ID, without
   * returning it. Its steps are not logged, only its results. A failure here is logged and never fails the search.
   */
  private async runShadow(sessionId: string, searchId: string, chosen: string, query: string, k: number, chosenItems: Candidate[]): Promise<void> {
    const shadow = this.config.shadowMachine;
    if (!shadow || shadow === chosen || !this.registry.machines.has(shadow)) return;
    const tag = { indexId: this.index.indexId, searchId };
    try {
      const space = this.index.getSpace(spaceId(this.config.space as unknown as Json))!;
      const env: RunEnv = {
        index: this.index,
        services: { ...this.services, space, llm: this.llmFor(sessionId) },
        config: this.config,
        registry: this.registry,
        now: this.now,
        mayWrite: false,
      };
      const { state } = await runMachine(this.registry.machine(shadow), { query, k }, env);
      const items = (state.results ?? []) as Candidate[];
      const chunksOf = (xs: Candidate[]) => new Set(xs.flatMap((c) => c.sourceChunkIds));
      const mine = chunksOf(chosenItems);
      const theirs = chunksOf(items);
      const both = [...mine].filter((c) => theirs.has(c)).length;
      this.history.append(
        sessionId,
        'search.shadow',
        {
          machine: shadow,
          chosen,
          items: items.map((c) => ({ id: c.id, kind: c.kind, score: c.score, sourceChunkIds: c.sourceChunkIds })),
          sharedChunks: both,
          onlyShadow: theirs.size - both,
          onlyChosen: mine.size - both,
        },
        tag,
      );
    } catch (e) {
      this.history.append(sessionId, 'search.shadow.failed', { machine: shadow, error: e instanceof Error ? e.message : String(e) }, tag);
    }
  }

  /** Swaps a freshly built index file in over the current one, and returns the path of the old file when it is kept. */
  static swapIndex(dir: string, newFile: string, o: { keepOld?: boolean; oldId?: string } = {}): string | null {
    const current = join(dir, 'index.sqlite');
    let kept: string | null = null;
    for (const ext of ['-wal', '-shm']) rmSync(current + ext, { force: true });
    if (existsSync(current)) {
      if (o.keepOld) {
        kept = join(dir, `index.${o.oldId ?? 'old'}.sqlite`);
        renameSync(current, kept);
      } else rmSync(current);
    }
    for (const ext of ['-wal', '-shm']) rmSync(newFile + ext, { force: true });
    renameSync(newFile, current);
    return kept;
  }
}
