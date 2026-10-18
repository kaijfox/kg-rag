/**
 * Prints the event log of one search (by id) or of one session, for judging whether the log alone explains a result.
 * Usage: tsx scripts/inspect-log.ts [--db path] (--search sr_... | --session se_... | --last-failed)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const kg = compose({ dbPath: arg('--db') ?? join(root, 'scratch/integration/stat-mech.kg.sqlite') });
let events;
if (arg('--search')) events = kg.log.eventsBySearch(arg('--search') as never);
else if (arg('--session')) events = kg.log.events(arg('--session') as never, 0, 1000);
else {
  const row = kg.db.prepare("SELECT session_id FROM events WHERE type='tool.failed' ORDER BY ts DESC LIMIT 1").get() as { session_id: string };
  events = kg.log.events(row.session_id as never, 0, 1000);
}
const cut = (v: unknown, n = 600) => {
  const s = JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + `...(${s.length})` : s;
};
for (const e of events) console.log(`#${e.seq} ${e.type} build=${e.buildId ?? '-'} search=${e.searchId ?? '-'} parent=${e.parentId?.slice(-6) ?? '-'}\n    ${cut(e.payload)}`);
kg.close();
