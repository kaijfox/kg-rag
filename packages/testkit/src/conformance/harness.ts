/**
 * Conformance suites are data: a list of named cases. registerSuite() turns one into vitest tests;
 * runSuite() runs it programmatically, which is how the meta-test proves each suite fails its broken fake.
 */
import { describe, it } from 'vitest';
import { CONTRACT_VERSION, KgError, type ErrorCode } from '@kg/core';

export interface Case {
  name: string;
  run: () => void | Promise<void>;
}
export interface Suite {
  name: string;
  cases: Case[];
}

export function registerSuite(s: Suite): void {
  describe(`${s.name} [contract ${CONTRACT_VERSION}]`, () => {
    for (const c of s.cases) it(c.name, c.run);
  });
}

export interface SuiteRun {
  passed: string[];
  failed: { name: string; error: string }[];
}
export async function runSuite(s: Suite): Promise<SuiteRun> {
  const out: SuiteRun = { passed: [], failed: [] };
  for (const c of s.cases) {
    try {
      await c.run();
      out.passed.push(c.name);
    } catch (e) {
      out.failed.push({ name: c.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Asserts fn throws (or rejects with) a KgError, optionally with a given code. */
export async function expectKgError(fn: () => unknown, code?: ErrorCode): Promise<KgError> {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  if (!(err instanceof KgError)) throw new Error(`expected a KgError${code ? ` (${code})` : ''}, got ${err === undefined ? 'no error' : String(err)}`);
  if (code && err.code !== code) throw new Error(`expected KgError ${code}, got ${err.code}: ${err.message}`);
  return err;
}

export function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    if (ArrayBuffer.isView(x)) return x; // typed arrays cannot be frozen
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}
