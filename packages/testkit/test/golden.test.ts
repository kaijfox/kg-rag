/** core's ID functions against the golden vectors (hand-written expectations + independent Python oracle). */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_RECIPE,
  DEFAULT_PARSE_RECIPE,
  DEFAULT_SEARCH_RECIPE,
  DEFAULT_SPACE,
  KgError,
  artifactId,
  asDocKey,
  base32,
  buildId,
  canonicalJson,
  chunkId,
  docVersionId,
  nodeId,
  normName,
  normText,
  recipeId,
  spaceId,
  type ArtifactId,
  type BuildManifest,
  type Json,
  type RecipeId,
} from '@kg/core';
import { goldenIds } from '../src/all';

type V = { input: Json; expected: string };
interface Golden {
  canonicalJson: V[];
  normText: V[];
  normName: V[];
  base32: V[];
  chunkId: { docKey: string; sectionPath: string[]; text: string; occurrence: number; id: string }[];
  recipeId: { name: string; canonical: string; id: string }[];
  spaceId: { canonical: string; id: string };
  nodeId: { name: string; normalized: string; id: string }[];
  artifactId: { sourceSha256: string; parseRecipe: string; id: string };
  docVersionId: { docKey: string; artifactId: string; chunkRecipe: string; id: string };
  buildId: { manifest: BuildManifest; canonical: string; itemIds: string[]; id: string };
}
const g = goldenIds<Golden>();
const PARSE_RECIPE_WITH_FORMULA_DECODING = {
  ...DEFAULT_PARSE_RECIPE,
  spec: {
    ...DEFAULT_PARSE_RECIPE.spec,
    formulaDecoding: { model: 'mlx-community/GLM-OCR-4bit', revision: 'rev-test-1', prompt: 'Formula Recognition:', cropMargin: 0.18 },
  },
};
const RECIPES: Record<string, object> = { DEFAULT_PARSE_RECIPE, PARSE_RECIPE_WITH_FORMULA_DECODING, DEFAULT_CHUNK_RECIPE, DEFAULT_SEARCH_RECIPE };

describe('golden ID vectors', () => {
  it('canonicalJson (RFC 8785)', () => {
    for (const v of g.canonicalJson) expect(canonicalJson(v.input)).toBe(v.expected);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '\ud800']) expect(() => canonicalJson(bad)).toThrow(KgError);
  });
  it('normText', () => {
    for (const v of g.normText) expect(normText(v.input as string)).toBe(v.expected);
  });
  it('normName', () => {
    for (const v of g.normName) expect(normName(v.input as string)).toBe(v.expected);
  });
  it('base32 (RFC 4648 vectors, lowercase, unpadded)', () => {
    for (const v of g.base32) expect(base32(new TextEncoder().encode(v.input as string))).toBe(v.expected);
  });
  it('chunkId', () => {
    for (const v of g.chunkId) expect(chunkId(asDocKey(v.docKey), v.sectionPath, v.text, v.occurrence)).toBe(v.id);
  });
  it('recipeId and spaceId of the defaults', () => {
    for (const v of g.recipeId) {
      expect(canonicalJson(RECIPES[v.name] as Json)).toBe(v.canonical);
      expect(recipeId(RECIPES[v.name] as never)).toBe(v.id);
    }
    expect(canonicalJson(DEFAULT_SPACE as Json)).toBe(g.spaceId.canonical);
    expect(spaceId(DEFAULT_SPACE)).toBe(g.spaceId.id);
  });
  it('nodeId', () => {
    for (const v of g.nodeId) {
      expect(normName(v.name)).toBe(v.normalized);
      expect(nodeId(v.name)).toBe(v.id);
    }
  });
  it('artifactId, docVersionId, buildId', () => {
    expect(artifactId(g.artifactId.sourceSha256, g.artifactId.parseRecipe as RecipeId)).toBe(g.artifactId.id);
    expect(docVersionId(asDocKey(g.docVersionId.docKey), g.docVersionId.artifactId as ArtifactId, g.docVersionId.chunkRecipe as RecipeId)).toBe(g.docVersionId.id);
    expect(canonicalJson(g.buildId.manifest as unknown as Json)).toBe(g.buildId.canonical);
    expect(buildId(g.buildId.manifest, g.buildId.itemIds as never)).toBe(g.buildId.id);
  });
});
