import { type IngestRequest, type IngestService, type Ctx, type IngestReport } from '@kg/core';
import { runPipeline, topologyOf, type PipelineIdentity } from '@kg/pipeline';
import type { IngestDeps } from './deps';
import { ingestMachine } from './machines/ingest';
import type { DocEntry } from './steps';

const identity = (): PipelineIdentity => ({
  pipeline: 'ingest',
  machine: 'ingest',
  version: '1',
  topology: topologyOf(ingestMachine),
  recipeId: null,
});

export function createIngest(d: IngestDeps): IngestService {
  return {
    async ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
      const entries: DocEntry[] = [
        ...(req.sources ?? []).map((s) => ({ kind: 'file' as const, path: s.path, docKey: s.docKey })),
        ...(req.artifacts ?? []).map((a) => ({ kind: 'artifact' as const, path: a.path, docKey: a.docKey })),
      ];
      return runPipeline(ingestMachine, { ctx, deps: d, entries }, { run: { ctx, tag: {} }, identity: identity() });
    },
  };
}

