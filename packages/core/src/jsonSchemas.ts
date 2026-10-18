/** JSON Schemas generated from the zod schemas, for non-TypeScript consumers (the Python docling sidecar). */
import { z } from 'zod';
import { parseArtifactSchema, parseRecipeSchema } from './schemas';

export function parseArtifactJsonSchema(): object {
  return { $id: 'kg-parse-artifact/1', ...z.toJSONSchema(parseArtifactSchema, { unrepresentable: 'any', cycles: 'ref' }) };
}
export function parseRecipeJsonSchema(): object {
  return { $id: 'kg-parse-recipe/1', ...z.toJSONSchema(parseRecipeSchema, { unrepresentable: 'any', cycles: 'ref' }) };
}
