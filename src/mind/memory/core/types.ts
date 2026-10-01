/**
 * Her core memory, as the rest of the mind sees it: her own episodes now, and her opinions,
 * thoughts and narrative as the core loops arrive. No method takes a user, so nothing written or
 * read through this interface can belong to one.
 */
import type { Neighbor } from "@/mind/memory/shared/types";

export type CoreMemoryKind =
  | "episode"
  | "opinion"
  | "interest"
  | "goal"
  | "intention"
  | "thought"
  | "reflection"
  | "idea"
  | "hypothetical"
  | "insight"
  | "narrative"
  | "agent_note";
export type CoreMemoryStatus = "open" | "resolved" | "recurring" | "stale" | "superseded";

export type CoreMemoryItem = {
  id: string;
  kind: CoreMemoryKind;
  content: string;
  payload: unknown;
  occurred_at: Date | null;
  created_at: Date;
  last_recalled_at: Date | null;
  status: CoreMemoryStatus;
  salience: number;
  valence: number;
  source: "world" | "loop";
  source_ref: string | null;
};

export type NewCoreMemory = {
  kind: CoreMemoryKind;
  content: string;
  payload?: unknown;
  embedding: number[];
  entity_refs?: string[];
  occurred_at: Date | null;
  created_at: Date;
  status: CoreMemoryStatus;
  salience: number;
  valence: number;
  confidence: number;
  source: "world" | "loop";
  source_ref: string | null;
};

/** A ranking candidate: the shape `rankMemories` scores. */
export type CoreCandidate = {
  id: string;
  content: string;
  salience: number;
  created_at: Date;
  last_recalled_at: Date | null;
  occurred_at: Date | null;
  sim: number;
  entity_salience: number;
};

export type CoreEntity = {
  id: string;
  name: string;
  aliases: string[];
  salience: number;
  first_seen: Date;
};

export type CoreSnapshot = {
  version: number;
  content: string;
  sections: Record<string, string>;
  source_ids: string[];
  rendered_at: Date;
  model: string;
  prompt_version: string;
};

export interface CoreMemory {
  insert(item: NewCoreMemory): Promise<string>;
  get(id: string): Promise<CoreMemoryItem | null>;
  /** Active memories at or above `minSimilarity`, closest first (reconcile candidates). */
  near(embedding: number[], k: number, minSimilarity: number): Promise<Neighbor[]>;
  /** The `limit` closest active, real (not hypothetical) memories, for ranking. */
  candidates(embedding: number[], limit: number): Promise<CoreCandidate[]>;
  /** Episodes whose time falls in (from, to], oldest first, at most `limit`. */
  recentEpisodes(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  entities(): Promise<CoreEntity[]>;
  latestEntityFirstSeen(): Promise<Date | null>;
  /** Ids for these names, inserting the ones she doesn't know yet (salience from the caller). */
  addEntities(names: string[], salience: number, now: Date): Promise<string[]>;
  latestSnapshot(): Promise<CoreSnapshot | null>;
  /** False when that version already exists. */
  insertSnapshot(snapshot: CoreSnapshot): Promise<boolean>;
}
