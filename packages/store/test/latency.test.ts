/**
 * Reports brute-force knn latency on 20,000 x 384 float32 vectors. Printed for the README; nothing is asserted about speed.
 */
import { it } from 'vitest';
import { FixedClock } from '@kg/testkit';
import { openDatabase } from '@kg/sqlite';
import { SqliteCorpusStore } from '../src/index';
import { populate, prng, randomVector } from './helpers';

it('reports knn latency on 20,000 x 384 (printed, not asserted)', () => {
  const s = new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock());
  const t0 = performance.now();
  const p = populate(s, 20000, 384, 5);
  const loadMs = performance.now() - t0;
  const rnd = prng(99);
  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const vector = randomVector(384, rnd);
    const t = performance.now();
    s.knn({ space: p.space, vector, buildId: p.id, kinds: ['chunk'], limit: 10 });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;
  console.log(`LATENCY 20000x384 populate+build ${loadMs.toFixed(0)} ms; knn limit 10 over 30 queries: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
}, 600000);
