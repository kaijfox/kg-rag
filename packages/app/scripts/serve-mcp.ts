/** Serves the MCP tools over stdio on a database file. Usage: tsx scripts/serve-mcp.ts [--db path] [--artifacts dir] */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const kg = compose({ dbPath: arg('--db', join(root, 'scratch/integration/stat-mech.kg.sqlite')), artifactDir: arg('--artifacts', join(root, 'test/corpa/stat-mech/artifacts')) });
await kg.serveMcp();
