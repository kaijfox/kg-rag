import { readFileSync } from 'node:fs';

/** Schema version written to db_meta.schema_version by schema.sql. */
export const SCHEMA_VERSION = 1;

let cached: string | undefined;
/** The text of schema.sql (idempotent; both `store` and `eventlog` run it on open). */
export function schemaSql(): string {
  cached ??= readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  return cached;
}
