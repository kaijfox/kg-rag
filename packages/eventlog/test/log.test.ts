import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EventDraft, EventEnvelope } from '@kg/core';
import { FixedClock, SeqIds } from '@kg/testkit';
import { SqliteEventLog } from '../src/index';

const newLog = () => new SqliteEventLog(new Database(':memory:'), new FixedClock(), new SeqIds());

describe('append-only enforcement', () => {
  it('UPDATE and DELETE on events raise', () => {
    const db = new Database(':memory:');
    const log = new SqliteEventLog(db, new FixedClock(), new SeqIds());
    const s = log.openSession({ kind: 'test', label: null, meta: {} });
    expect(() => db.prepare("UPDATE events SET type = 'tool.called' WHERE session_id = ?").run(s)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM events WHERE session_id = ?').run(s)).toThrow(/append-only/);
    expect(log.events(s).length).toBe(1);
  });
});

describe('recorded fixtures', () => {
  const dir = new URL('../../testkit/fixtures/log/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  for (const name of files) {
    it(`re-appending ${name} reproduces its event types in order`, () => {
      const recorded = readFileSync(new URL(name, dir), 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as EventEnvelope);
      const log = newLog();
      const s = log.openSession({ kind: 'test', label: name, meta: {} });
      const replayed = recorded.filter((e) => e.type !== 'session.started');
      for (const e of replayed) {
        log.append({ sessionId: s, type: e.type, buildId: e.buildId, searchId: e.searchId, parentId: e.parentId, payload: e.payload } as EventDraft);
      }
      expect(log.events(s).slice(1).map((e) => e.type)).toEqual(replayed.map((e) => e.type));
    });
  }
});
