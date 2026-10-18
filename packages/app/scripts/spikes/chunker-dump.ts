/** Dumps section-pack/1 chunks for each artifact: <name>.ts.json in [outDir]. Usage: tsx chunker-dump.ts [dir] [outDir] */
import { writeFileSync } from 'node:fs';
import { DEFAULT_DIR, artifactNames, readArtifact } from './io';
import { join } from 'node:path';
import { DEFAULT_CHUNK_RECIPE, asDocKey, type ParseArtifact } from '@kg/core';
import { sectionPack } from '../../src/skeleton/chunker';
const dir = process.argv[2] ?? DEFAULT_DIR;
const out = process.argv[3] ?? dir;
for (const name of artifactNames(dir)) {
  const art = readArtifact(dir, name);
  writeFileSync(join(out, `${name}.ts.json`), JSON.stringify(sectionPack(art, asDocKey(name), DEFAULT_CHUNK_RECIPE)));
}
