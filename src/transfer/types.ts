import type { Weights } from "../domain/weights.js";

// The shapes of a project's data as the JSON export writes it and the imports read it

export interface TagPair {
  prefix: string;
  value: string;
}

export interface SerializedTicket {
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
}

export interface SerializedRelation {
  source: string;
  type: string;
  target: string;
}

/** The project's weights, as in the export */
export type SerializedWeights = Weights;

export interface SerializedProject {
  tickets: SerializedTicket[];
  tags: TagPair[];
  /** Between tickets, by title */
  relations: SerializedRelation[];
  weights: SerializedWeights;
}

export interface ImportableRevision {
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
  revised_at: string;
  /** Position in the original write order (event_order), if exported */
  sequence?: number;
}

export interface ImportableTagChange {
  action: "added" | "removed";
  /** The tag's name at the time of the change */
  prefix: string;
  value: string;
  /** The tag's name at export time; null if the tag was deleted since */
  tag?: TagPair | null;
  /** The tag's id in the exporting database: which changes are of one tag */
  tagId?: number;
  changed_at: string;
  /** Position in the original write order (event_order), if exported */
  sequence?: number;
}

/** History from `export json --with-history`, restored as it was */
export interface ImportableHistory {
  createdAt?: string;
  updatedAt?: string;
  revisions?: ImportableRevision[];
  tagChanges?: ImportableTagChange[];
}

export interface ImportableTicket {
  title: string;
  description?: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags?: TagPair[];
  history?: ImportableHistory;
}
