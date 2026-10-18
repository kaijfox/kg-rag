import { knnFixtureSuite, registerSuite } from '@kg/testkit/conformance';
import { openDatabase, SqliteCorpusStore } from '../src/index';
import { FixedClock } from '@kg/testkit';
registerSuite(knnFixtureSuite(() => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock())));
