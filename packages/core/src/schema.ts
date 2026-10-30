import { readFileSync } from 'node:fs';

let cached: string | undefined;
/** The text of schema.sql, version 1 of the schema. `@kg/sqlite` applies it through its migration list. */
export function schemaSql(): string {
  cached ??= readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  return cached;
}
