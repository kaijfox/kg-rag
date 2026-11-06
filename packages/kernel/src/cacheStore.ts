/**
 * The model-call cache: responses only, keyed by a hash of model, prompt and input, compressed. Optional: losing or
 * pruning it only slows a rebuild. Pruned least-recently-used first to a size cap.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { Sql, openDb } from './sqlite';

const SCHEMA = `
CREATE TABLE responses (key TEXT PRIMARY KEY, body BLOB NOT NULL, purpose TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT NOT NULL);
CREATE INDEX responses_by_use ON responses(used_at);
`;

export class CacheStore {
  private constructor(
    private readonly sql: Sql,
    private readonly now: () => string,
  ) {}
  static open(path: string, now: () => string = () => new Date().toISOString()): CacheStore {
    return new CacheStore(new Sql(openDb(path, [SCHEMA])), now);
  }
  close(): void {
    this.sql.close();
  }
  get(key: string): string | null {
    const r = this.sql.get<{ body: Buffer }>(`SELECT body FROM responses WHERE key = ?`, key);
    if (!r) return null;
    this.sql.run(`UPDATE responses SET used_at = ? WHERE key = ?`, this.now(), key);
    return gunzipSync(r.body).toString('utf8');
  }
  put(key: string, purpose: string, value: string): void {
    const t = this.now();
    this.sql.run(`INSERT OR REPLACE INTO responses (key, body, purpose, created_at, used_at) VALUES (?, ?, ?, ?, ?)`, key, gzipSync(Buffer.from(value, 'utf8')), purpose, t, t);
  }
  stats(): { entries: number; bytes: number } {
    const r = this.sql.get<{ n: number; b: number | null }>(`SELECT COUNT(*) AS n, SUM(LENGTH(body)) AS b FROM responses`)!;
    return { entries: r.n, bytes: r.b ?? 0 };
  }
  /** Deletes least-recently-used entries until the stored size is at most maxBytes. Returns how many were deleted. */
  prune(maxBytes: number): number {
    let deleted = 0;
    while (this.stats().bytes > maxBytes) {
      const rows = this.sql.all<{ key: string }>(`SELECT key FROM responses ORDER BY used_at LIMIT 50`);
      if (rows.length === 0) break;
      for (const r of rows) this.sql.run(`DELETE FROM responses WHERE key = ?`, r.key);
      deleted += rows.length;
    }
    return deleted;
  }
}
