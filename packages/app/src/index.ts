/**
 * @kg/app: the composition root. `compose` wires the real packages over one database file; the scripts in
 * scripts/ and the MCP and viewer entry points are the only callers.
 */
export { compose, CachedParser, machineMaps, ollamaLlm, type Composition, type ComposeOptions } from './compose';
