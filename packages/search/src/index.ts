/**
 * @kg/search: the search service and its one machine (`similarity`: retrieve, then cut).
 * The machine, its steps and the registry are exported for tests and for the app; the service is the entry point.
 */
export { createSearch, type SearchDeps } from './service';
export { vectorKnn, type VectorKnnParams } from './steps/vectorKnn';
export { truncate, type TruncateParams } from './steps/truncate';
export {
  similarity,
  similarityRecipe,
  similaritySettingsSchema,
  DEFAULT_SIMILARITY_SETTINGS,
  SIMILARITY_VERSION,
  type SimilaritySettings,
  type SimilarityInput,
  type SimilarityContext,
} from './machines/similarity';
export { searchMachines, type SearchMachineEntry } from './registry';
