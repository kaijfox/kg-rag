import { corpusStoreConformance, evalRepoConformance, registerSuite } from '@kg/testkit/conformance';
import { openDatabase, SqliteCorpusStore, SqliteEvalRepo } from '../src/index';
import { FixedClock } from '@kg/testkit';
registerSuite(corpusStoreConformance(() => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock())));
registerSuite(evalRepoConformance(() => new SqliteEvalRepo(openDatabase(':memory:'))));
