import type { AnyStateMachine } from '@kg/pipeline';
import { topologyOf } from '@kg/pipeline';
import { similarity, similaritySettingsSchema, SIMILARITY_VERSION } from './machines/similarity';

/** A search machine the service can run: its name and version (the recipe key), the machine, and its settings parser. */
export interface SearchMachineEntry {
  name: string;
  version: string;
  machine: AnyStateMachine;
  parseSettings: (raw: unknown) => unknown;
  topology: string;
}

/** Registered search machines keyed by `machine@version`. v0 has only `similarity@1`. */
export const searchMachines: Record<string, SearchMachineEntry> = {
  [`similarity@${SIMILARITY_VERSION}`]: {
    name: 'similarity',
    version: SIMILARITY_VERSION,
    machine: similarity,
    parseSettings: (raw) => similaritySettingsSchema.parse(raw),
    topology: topologyOf(similarity),
  },
};
