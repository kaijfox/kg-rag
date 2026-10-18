import { embedderConformance, registerSuite } from '@kg/testkit/conformance';
import { ollamaEmbedder } from '../src/index';
import { HashEmbedder } from '@kg/testkit';
// a stub /api/embed backed by HashEmbedder (not recorded Ollama output, which would be circular)
const hash = new HashEmbedder(768);
const stubFetch = (async (_url: string, init: { body: string }) => {
  const { input } = JSON.parse(init.body) as { input: string[] };
  const embeddings = (await hash.embed(input)).map((v) => Array.from(v, (x) => x * 3)); // unnormalized on purpose
  return new Response(JSON.stringify({ embeddings }), { status: 200 });
}) as unknown as typeof fetch;
registerSuite(embedderConformance(() => ollamaEmbedder('embeddinggemma:latest', 768, { fetch: stubFetch })));
const live = process.env.KG_OLLAMA === '1';
if (live) registerSuite(embedderConformance(() => ollamaEmbedder('embeddinggemma:latest', 768), { tol: 1e-4 }));
