import { KgError, type RecipeId } from '@kg/core';
import type { ConditionKind } from '../machines/evalQuestion';

/** The standard condition names and their kinds; another name is a variant that must name a search recipe. */
const STANDARD: Record<string, ConditionKind> = {
  'no-context': 'none',
  gold: 'gold',
  retrieved: 'retrieved',
  'oracle-gold-first': 'oracle',
};

export function conditionKind(name: string, searchRecipes: Record<string, RecipeId> | undefined): ConditionKind {
  const std = STANDARD[name];
  if (std) return std;
  if (searchRecipes?.[name]) return 'retrieved';
  throw new KgError('invalid_input', `unknown condition ${JSON.stringify(name)}: not a standard name and no search recipe is given for it`);
}

/** The first condition error, or null when every name is usable. */
export function conditionError(conditions: readonly string[], searchRecipes: Record<string, RecipeId> | undefined): KgError | null {
  try {
    for (const c of conditions) conditionKind(c, searchRecipes);
    return null;
  } catch (e) {
    return e as KgError;
  }
}
