import Database from 'better-sqlite3';
import { eventLogConformance, registerSuite } from '@kg/testkit/conformance';
import { FixedClock, SeqIds } from '@kg/testkit';
import { SqliteEventLog } from '../src/index';
registerSuite(eventLogConformance(() => new SqliteEventLog(new Database(':memory:'), new FixedClock(), new SeqIds())));
