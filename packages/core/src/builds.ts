/** Build composition: the one definition of what a build contains, used by ingest, api and testkit. */
import { buildId, type ArtifactId, type BuildId, type ItemId, type RecipeId, type SpaceId } from './ids';
import type { Build, BuildManifest, DocVersion } from './model';

export interface ComposeBuildInput {
  /** every document's current version */
  docVersions: readonly DocVersion[];
  /** parse recipe of each doc version's artifact */
  parseRecipeOf: (artifact: ArtifactId) => RecipeId;
  spaceIds: readonly SpaceId[];
  searchRecipeId: RecipeId;
  parentId: BuildId | null;
  /** v0: none */
  derivedItemIds?: readonly ItemId[];
  derivedRecipes?: readonly RecipeId[];
}

const sortedUnique = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();

export function composeBuild(i: ComposeBuildInput): Omit<Build, 'createdAt'> {
  const docVersions: Record<string, DocVersion['id']> = {};
  for (const v of i.docVersions) docVersions[v.docKey] = v.id;
  const parseRecipes = new Set(i.docVersions.map((v) => i.parseRecipeOf(v.artifactId)));
  const chunkRecipes = new Set(i.docVersions.map((v) => v.chunkRecipeId));
  const manifest: BuildManifest = {
    docVersions,
    embeddingSpaces: sortedUnique(i.spaceIds),
    searchRecipeId: i.searchRecipeId,
    derivedRecipes: sortedUnique(i.derivedRecipes ?? []),
    mappingRuns: [],
    mixedRecipes: parseRecipes.size > 1 || chunkRecipes.size > 1,
  };
  const itemIds = sortedUnique<ItemId>([...i.docVersions.flatMap((v) => v.chunkIds), ...(i.derivedItemIds ?? [])]);
  return { id: buildId(manifest, itemIds), parentId: i.parentId, manifest, itemIds };
}
