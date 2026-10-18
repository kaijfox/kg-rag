import { DEFAULT_POOL, ITEM_KINDS, KgError, type ItemKind, type SearchRecipeSpec, type SearchState } from '@kg/core';
import { assign, setup, toKgError, topologyOf } from '@kg/pipeline';
import { stepActor, type SearchRun } from './kit';
import { truncate } from '../steps/truncate';
import { vectorKnn } from '../steps/vectorKnn';

export const SIMILARITY_VERSION = '1';

export interface SimilaritySettings {
  /** candidates kept per query variant by the retrieval */
  pool: number;
  kinds: ItemKind[];
}

export const DEFAULT_SIMILARITY_SETTINGS: SimilaritySettings = { pool: DEFAULT_POOL, kinds: ['chunk'] };

const SETTING_KEYS = ['kinds', 'pool'];

/**
 * Settings of the similarity machine. Strict: unknown keys, a non-integer or non-positive pool, an empty or repeated
 * kinds list, and a kind outside the item kinds are all errors (the message says which).
 */
export const similaritySettingsSchema = {
  parse(raw: unknown): SimilaritySettings {
    const fail = (why: string): never => {
      throw new KgError('invalid_input', `similarity settings: ${why}`);
    };
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not an object');
    const extra = Object.keys(raw).filter((k) => !SETTING_KEYS.includes(k));
    if (extra.length > 0) return fail(`unknown keys ${extra.join(', ')}`);
    const { pool, kinds } = raw as { pool?: unknown; kinds?: unknown };
    if (typeof pool !== 'number' || !Number.isInteger(pool) || pool <= 0) return fail('pool must be a positive integer');
    if (!Array.isArray(kinds) || kinds.length === 0) return fail('kinds must be a non-empty array');
    const seen = new Set<unknown>();
    for (const k of kinds) {
      if (!(ITEM_KINDS as readonly unknown[]).includes(k)) return fail(`kind ${String(k)} is not an item kind`);
      if (seen.has(k)) return fail(`kind ${String(k)} is repeated`);
      seen.add(k);
    }
    return { pool, kinds: [...(kinds as ItemKind[])] };
  },
  safeParse(raw: unknown): { success: true; data: SimilaritySettings } | { success: false; message: string } {
    try {
      return { success: true, data: this.parse(raw) };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
};

export interface SimilarityInput {
  run: SearchRun;
  state: SearchState;
  settings: SimilaritySettings;
}

export interface SimilarityContext extends SimilarityInput {
  error: KgError | null;
}

/** Retrieve the nearest passages of every query variant, then keep the top k. */
export const similarity = setup({
  types: {
    context: {} as SimilarityContext,
    input: {} as SimilarityInput,
    output: {} as SearchState,
  },
  actors: {
    retrieve: stepActor(vectorKnn),
    cut: stepActor(truncate),
  },
}).createMachine({
  id: 'similarity',
  context: ({ input }) => ({ ...input, error: null }),
  initial: 'retrieve',
  output: ({ context }) => context.state,
  states: {
    retrieve: {
      meta: { logs: 'search.step', step: 'vector-knn', label: 'find similar passages' },
      invoke: {
        src: 'retrieve',
        input: ({ context }) => ({
          run: context.run,
          at: 'retrieve',
          state: context.state,
          params: { pool: context.settings.pool, kinds: context.settings.kinds },
        }),
        onDone: { target: 'cut', actions: assign({ state: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    cut: {
      meta: { logs: 'search.step', step: 'truncate', label: 'keep the top k' },
      invoke: {
        src: 'cut',
        input: ({ context }) => ({ run: context.run, at: 'cut', state: context.state, params: {} }),
        onDone: { target: 'done', actions: assign({ state: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});

/** The recipe for this machine: its name, version, settings and topology fingerprint. */
export function similarityRecipe(settings?: Partial<SimilaritySettings>): SearchRecipeSpec {
  const s = similaritySettingsSchema.parse({ ...DEFAULT_SIMILARITY_SETTINGS, ...settings });
  return {
    kind: 'search',
    version: SIMILARITY_VERSION,
    spec: { machine: 'similarity', settings: { pool: s.pool, kinds: [...s.kinds] }, topology: topologyOf(similarity) },
  };
}
