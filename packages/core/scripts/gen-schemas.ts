/** Regenerates schemas/*.schema.json from the zod schemas. Run: pnpm --filter @kg/core gen:schemas */
import { writeFileSync } from 'node:fs';
import { parseArtifactJsonSchema, parseRecipeJsonSchema } from '../src/jsonSchemas';
const dir = new URL('../schemas/', import.meta.url);
writeFileSync(new URL('parse-artifact.schema.json', dir), JSON.stringify(parseArtifactJsonSchema(), null, 2) + '\n');
writeFileSync(new URL('parse-recipe.schema.json', dir), JSON.stringify(parseRecipeJsonSchema(), null, 2) + '\n');
