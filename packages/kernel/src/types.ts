/** Shared record types. Plain data, no behaviour. */
import type { Json, JsonObject } from './ids';

/** A passage of a document. Its ID is computed from its text, so unchanged text keeps its ID. */
export interface ChunkRow {
  id: string;
  docKey: string;
  /** position within the document's current ingest, from 0 */
  ordinal: number;
  /** verbatim heading texts, outermost first */
  sectionPath: string[];
  occurrence: number;
  /** verbatim text of the blocks, joined by a blank line */
  text: string;
  pages: number[];
  blockRefs: string[];
  /** adapter-specific facts, such as a decision's date */
  meta: JsonObject;
}

export interface DocumentRow {
  docKey: string;
  sourceSha256: string;
  sourceName: string;
  parseRecipe: JsonObject;
  chunkRecipe: JsonObject;
  /** counts the document's ingests; a chunk is current when its ingest number equals this */
  ingestNo: number;
  ingestedAt: string;
  meta: JsonObject;
}

export type ItemKind = 'fact' | 'summary';
export type RecordKind = 'chunk' | ItemKind;

export interface MentionDraft {
  /** the name as written in the fact */
  surface: string;
  role?: string | null;
}

/** What a module proposes. The runner assigns the ID and the madeBy stamp, and the store refuses a draft with no sources. */
export interface DerivedItemDraft {
  kind: ItemKind;
  text: string;
  sourceChunkIds: string[];
  mentions: MentionDraft[];
  meta?: JsonObject;
}

export interface DerivedItem {
  id: string;
  kind: ItemKind;
  text: string;
  /** "module-name@version" of the module that made it */
  madeBy: string;
  sourceChunkIds: string[];
  mentions: { name: string; surface: string; role: string | null }[];
  meta: JsonObject;
}

export type LinkKind = 'replaces' | 'alias-of';
export type LinkSubject = 'item' | 'chunk' | 'name';

/**
 * "replaces": fromId is the newer record and toId the older one it replaces (same subject on both sides).
 * "alias-of": fromId is a name, toId the canonical name for the same thing (subject "name").
 */
export interface LinkDraft {
  kind: LinkKind;
  subject: LinkSubject;
  fromId: string;
  toId: string;
  note?: string | null;
}
export interface LinkRow extends LinkDraft {
  id: string;
  madeBy: string;
  createdAt: string;
}

/** One ranked entry of a search: a chunk, fact or summary with the chunks it cites. */
export interface Candidate {
  id: string;
  kind: RecordKind;
  text: string;
  score: number;
  /** chunks that support this record; a chunk cites itself */
  sourceChunkIds: string[];
  docKey?: string;
  sectionPath?: string[];
  meta?: JsonObject;
}

export interface EmbeddingSpaceSpec {
  /** Ollama model name with tag */
  model: string;
  /** digest of the model weights as Ollama reports it; a model update that keeps the tag is a new space */
  digest: string;
  dims: number;
  /** placeholders: {text}, {headings} */
  documentTemplate: string;
  /** placeholder: {query} */
  queryTemplate: string;
}
export type EmbeddingSpace = EmbeddingSpaceSpec & { id: string };

export type { Json, JsonObject };
