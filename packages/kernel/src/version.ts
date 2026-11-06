/** The version of this software, and the version of the on-disk format of a database. */
export const KG_VERSION = '0.3.0';

/**
 * Bumped when a database written by an earlier version can no longer be read. A database with a higher number than this
 * is refused, because an older program would misread it. Everything else that changes (prompts, modules, embedding
 * models) is handled by `kg rebuild`, and CHANGELOG.md says when a rebuild is needed.
 */
export const FORMAT_VERSION = 1;
