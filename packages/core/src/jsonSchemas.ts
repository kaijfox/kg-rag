/** JSON Schemas generated from the zod schemas, for non-TypeScript consumers (the Python docling sidecar). */
import { z } from 'zod';
import { parseArtifactSchema, parseRecipeSchema } from './schemas';
import { TOOLS, type ToolName } from './api';

export function parseArtifactJsonSchema(): object {
  return { $id: 'kg-parse-artifact/1', ...z.toJSONSchema(parseArtifactSchema, { unrepresentable: 'any', cycles: 'ref' }) };
}
export function parseRecipeJsonSchema(): object {
  return { $id: 'kg-parse-recipe/1', ...z.toJSONSchema(parseRecipeSchema, { unrepresentable: 'any', cycles: 'ref' }) };
}

/** JSON Schema of one tool's input, for the MCP adapter's tool listing (an object schema, as MCP requires). */
export function toolInputJsonSchema(name: ToolName): { type: 'object'; [key: string]: unknown } {
  const schema = z.toJSONSchema(TOOLS[name].input, { io: 'input', unrepresentable: 'any' }) as { type?: string; [key: string]: unknown };
  return { ...schema, type: 'object' };
}
