/** Composition: opens a database directory with the shipped machines and the local Ollama clients. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kg, type Embedder, type Llm } from '@kg/kernel';
import { createRegistry, ollamaEmbedder, ollamaLlm } from '@kg/modules';

export interface AppOptions {
  /** the database directory */
  db: string;
  create?: boolean;
  ollamaUrl?: string;
  /** the docling command; "none" runs no parser. Default: the repository's sidecar if installed, else none */
  sidecar?: string | null;
  /** extra directories searched for parsed documents produced elsewhere */
  artifactDirs?: string[];
  embedder?: Embedder;
  llm?: Llm;
}

const REPO = resolve(new URL('../../..', import.meta.url).pathname);
const SIDECAR_VENV = join(REPO, 'packages/parse-sidecar/.venv/bin/kg-parse');

export function sidecarCommand(opt: string | null | undefined): string | null {
  if (opt === 'none') return null;
  if (opt) return opt;
  return existsSync(SIDECAR_VENV) ? SIDECAR_VENV : null;
}

export function openKg(o: AppOptions): Kg {
  const kg = Kg.open(o.db, { create: o.create, registry: createRegistry() });
  kg.services = {
    embedder: o.embedder ?? ollamaEmbedder(kg.config.space.model, kg.config.space.dims, { baseUrl: o.ollamaUrl, digest: kg.config.space.digest }),
    llm: o.llm ?? ollamaLlm({ baseUrl: o.ollamaUrl }),
  };
  return kg;
}
