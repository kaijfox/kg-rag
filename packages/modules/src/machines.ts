/** The machines that ship, and the registry that holds them and their modules. */
import { Registry, type JsonObject, type MachineDef } from '@kg/kernel';
import { embedRecords, linkReplaces, readSources, replayCorrections, segment } from './modules/ingest';
import { extractFacts } from './modules/extract';
import { adjacentChunks, citeChunks, dropReplaced, embedQuery, expandByNames, keepTopK, nearestAll, nearestChunks, nearestFacts } from './modules/search';

const search = (name: string, description: string, states: [string, string, JsonObject?][]): MachineDef => ({
  name,
  version: '1',
  description,
  provides: ['query', 'k'],
  start: states[0]![0],
  states: Object.fromEntries(states.map(([id, module, settings], i) => [id, { module, ...(settings ? { settings } : {}), next: states[i + 1]?.[0] ?? null }])),
});

export const MACHINES: MachineDef[] = [
  search('chunk-search', 'Nearest passages by embedding similarity: the baseline.', [
    ['embed', 'embed-query'],
    ['nearest', 'nearest-chunks'],
    ['cut', 'keep-top-k'],
  ]),
  search('chunk-search-adjacent', 'The baseline plus the passages next to the best three.', [
    ['embed', 'embed-query'],
    ['nearest', 'nearest-chunks'],
    ['neighbours', 'adjacent-chunks'],
    ['cut', 'keep-top-k'],
  ]),
  search('facts-and-neighbours', 'Nearest facts, then facts that share a name with them, then the passages they cite.', [
    ['embed', 'embed-query'],
    ['nearest', 'nearest-facts'],
    ['expand', 'expand-by-names'],
    ['cite', 'cite-chunks'],
    ['cut', 'keep-top-k'],
  ]),
  search('current-state', 'Nearest passages and facts, without those that a later entry replaced.', [
    ['embed', 'embed-query'],
    ['nearest', 'nearest-all'],
    ['current', 'drop-replaced'],
    ['cut', 'keep-top-k'],
  ]),
  {
    name: 'build',
    version: '1',
    description: 'Read the sources, cut them into chunks, extract facts, embed everything new, replay confirmed corrections, link replaced entries.',
    provides: ['sources'],
    start: 'read',
    states: {
      read: { module: 'read-sources', next: 'segment' },
      segment: { module: 'segment', next: 'extract' },
      extract: { module: 'extract-facts', next: 'embed' },
      embed: { module: 'embed-records', next: 'corrections' },
      corrections: { module: 'replay-corrections', next: 'replaces' },
      replaces: { module: 'link-replaces', next: null },
    },
  },
];

export function createRegistry(): Registry {
  const r = new Registry();
  for (const m of [embedQuery, nearestChunks, nearestFacts, nearestAll, expandByNames, citeChunks, dropReplaced, adjacentChunks, keepTopK, readSources, segment, extractFacts, embedRecords, replayCorrections, linkReplaces]) r.addModule(m);
  for (const m of MACHINES) r.addMachine(m);
  return r;
}
