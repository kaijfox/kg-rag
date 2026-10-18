// Shared by the retrieval pilot scripts. Imports the (read-only) skeleton chunker and core helpers by relative path.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { asDocKey, DEFAULT_CHUNK_RECIPE, DEFAULT_SPACE, cosineScore, renderDocument, renderQuery } from '../../../packages/core/src/index';
import { sectionPack } from '../../../packages/app/src/skeleton/chunker';
import { ollamaEmbedder } from '../../../packages/app/src/skeleton/ollama';
export { DEFAULT_SPACE, cosineScore, renderDocument, renderQuery, ollamaEmbedder };
export const DOCS = ['ThermoPlischke', 'ThermoKardar', 'FoundationsPlischke', 'FoundationsKardar'];
const ART = new URL('../../../test/corpa/stat-mech/artifacts/', import.meta.url).pathname;
const decoded: Record<string, string> = JSON.parse(readFileSync(new URL('./out/decoded_glm.json', import.meta.url), 'utf8'));
export type Variant = 'placeholder' | 'glyph' | 'latex';
export interface Chunk { id: string; doc: string; text: string; variant: Variant }
export function chunksFor(variant: Variant): Chunk[] {
  const out: Chunk[] = [];
  for (const d of DOCS) {
    const art = JSON.parse(gunzipSync(readFileSync(`${ART}${d}.kgparse.json.gz`)).toString('utf8'));
    for (const t of art.document.texts) {
      if (t.label !== 'formula') continue;
      if (variant === 'latex') t.text = decoded[`${d}#${t.self_ref}`] ?? '';
      else if (variant === 'glyph') t.text = t.orig ?? '';
    }
    for (const c of sectionPack(art, asDocKey(d), DEFAULT_CHUNK_RECIPE)) out.push({ id: c.id, doc: d, text: c.text, variant });
  }
  return out;
}
