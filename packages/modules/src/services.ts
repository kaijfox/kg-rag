/** What the modules in this package expect in `ctx.services`. The kernel treats the bag as opaque. */
import type { Correction, Embedder, EmbeddingSpace, Llm, ModuleContext } from '@kg/kernel';
import type { SourceAdapter } from './adapters';
import type { ArtifactStore } from './parse/artifacts';

export interface ModuleServices {
  embedder: Embedder;
  space: EmbeddingSpace;
  llm?: Llm;
  /** confirmed corrections from the history, replayed into a rebuilt index */
  corrections?: Correction[];
  adapters?: Map<string, SourceAdapter>;
  artifacts?: ArtifactStore;
  /** directory that relative source paths resolve against */
  baseDir?: string;
}

export const services = (ctx: ModuleContext): ModuleServices => ctx.services as unknown as ModuleServices;
