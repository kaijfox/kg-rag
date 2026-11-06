/**
 * `kg export`: a folder that holds what is needed to see how the system was used, to send to the people who maintain it.
 * It holds the history (every search, what each step did, feedback, outcomes), the configuration, and the index. With
 * `noText` the index is left out, so no passage of the corpus leaves the machine; queries, feedback notes and the
 * names of source files are still in the history and the configuration.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FORMAT_VERSION, KG_VERSION, type Kg } from '@kg/kernel';

export interface ExportResult {
  dir: string;
  textIncluded: boolean;
  files: string[];
  sessions: number;
  searches: number;
}

export function exportDatabase(kg: Kg, outDir: string, o: { noText?: boolean } = {}): ExportResult {
  if (existsSync(outDir)) throw new Error(`${outDir} already exists`);
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  kg.history.backupTo(join(outDir, 'history.sqlite'));
  files.push('history.sqlite');
  if (!o.noText) {
    kg.index.backupTo(join(outDir, 'index.sqlite'));
    files.push('index.sqlite');
  }
  const config = o.noText ? { ...kg.config, sources: kg.config.sources.map((s) => ({ ...s, path: basename(s.path) })) } : kg.config;
  writeFileSync(join(outDir, 'kg.json'), JSON.stringify(config, null, 2) + '\n');
  files.push('kg.json');
  const sessions = kg.history.sessions(100000);
  const searches = kg.history.eventsOfType('search.started', 1_000_000).length;
  writeFileSync(
    join(outDir, 'export.json'),
    JSON.stringify(
      {
        format: 'kg-export/1',
        createdAt: kg.now(),
        kg: KG_VERSION,
        formatVersion: FORMAT_VERSION,
        indexId: kg.index.indexId,
        builtBy: kg.index.getMeta('built_by'),
        textIncluded: !o.noText,
        stats: kg.index.stats(),
        sessions: sessions.length,
        searches,
        cache: kg.cache.stats(),
      },
      null,
      2,
    ) + '\n',
  );
  files.push('export.json');
  return { dir: outDir, textIncluded: !o.noText, files, sessions: sessions.length, searches };
}
