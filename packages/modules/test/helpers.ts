import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { Kg, l2normalize, type Embedder, type KgConfig, type Llm, type LlmRequest } from '@kg/kernel';
import { createRegistry } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
export const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'kg-modules-'));
  dirs.push(d);
  return d;
};

const DIMS = 64;
/** A bag-of-words embedder: words hash to dimensions, so texts that share words are close. Deterministic and offline. */
export function fakeEmbedder(): Embedder & { calls: number } {
  const e = {
    model: 'fake',
    dims: DIMS,
    calls: 0,
    async embed(texts: readonly string[]) {
      e.calls += texts.length;
      return texts.map((t) => {
        const v = new Float32Array(DIMS);
        for (const w of t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
          let h = 7;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % DIMS]! += 1;
        }
        return l2normalize(v);
      });
    },
  };
  return e;
}

/** Answers extraction calls from a table: the passage text contains a key, the reply is that key's facts. */
export function scriptedLlm(table: Record<string, { text: string; names: string[] }[]>): Llm & { calls: number } {
  const l = {
    calls: 0,
    async complete(r: LlmRequest) {
      l.calls++;
      const user = r.messages[0]!.content;
      const key = Object.keys(table).find((k) => user.includes(k));
      return { text: JSON.stringify({ facts: key ? table[key] : [] }), model: r.model, inputTokens: 1, outputTokens: 1 };
    },
  };
  return l;
}

export function makeKg(config: Partial<KgConfig>, services: Parameters<typeof Kg.open>[1] extends infer O ? NonNullable<O> extends { services?: infer S } ? S : never : never, dir = tempDir()): Kg {
  writeFileSync(join(dir, 'kg.json'), JSON.stringify({ space: { model: 'fake', digest: 'fake', dims: DIMS, documentTemplate: '{text}', queryTemplate: '{query}' }, ...config }));
  return Kg.open(dir, { registry: createRegistry(), services });
}
