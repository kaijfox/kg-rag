import { knnFixtureSuite, registerSuite } from '@kg/testkit/conformance';
import { openDatabase } from '@kg/sqlite';
import { SqliteCorpusStore } from '../src/index';
import { FixedClock } from '@kg/testkit';
registerSuite(knnFixtureSuite(() => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock())));
