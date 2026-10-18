/** Child process for the multi-process append test: appends N events to one session of a shared log file. */
import Database from 'better-sqlite3';
import { systemClock, ulidGen, type SessionId } from '@kg/core';
import { SqliteEventLog } from '../../src/index';

const [path, session, count] = process.argv.slice(2) as [string, SessionId, string];
const log = new SqliteEventLog(new Database(path), systemClock, ulidGen());
let ok = 0;
const errors: string[] = [];
for (let i = 0; i < Number(count); i++) {
  try {
    log.append({ sessionId: session, type: 'tool.called', buildId: null, searchId: null, parentId: null, payload: { tool: 'search', input: { i } } });
    ok++;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
}
process.stdout.write(JSON.stringify({ ok, errors }));
