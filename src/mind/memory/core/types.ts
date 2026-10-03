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
  entity_refs: string[];
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
  /** Active factual memories, including resolved intentions, closest first then ID. */
  near(embedding: number[], k: number, minSimilarity: number): Promise<Neighbor[]>;
  /** Dedupe compares text, including hypotheticals; stale and superseded items are excluded. */
  dedupeNear(embedding: number[], k: number, minSimilarity: number): Promise<Neighbor[]>;
  anticipationCandidate(now: Date, until: Date): Promise<CoreMemoryItem | null>;
  ruminationCandidate(
    from: Date,
    to: Date,
    minValence: number,
    maxCount: number,
  ): Promise<CoreMemoryItem | null>;
  /** Factual history created in [from, to], newest first, then ID; no resolved intentions. */
  recallable(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  mergePayload(id: string, patch: Record<string, unknown>): Promise<void>;
  reinforce(id: string, now: Date, bump: number, cap: number): Promise<void>;
  /**
   * The `limit` closest active, real (not hypothetical) memories, for ranking. A resolved
   * intention is left out: once the plan has happened, the episode speaks for it.
   */
  candidates(embedding: number[], limit: number): Promise<CoreCandidate[]>;
  /** Episodes whose time falls in (from, to], oldest first, at most `limit`. */
  recentEpisodes(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  /** Open intentions created in (from, to], oldest first, at most `limit`. */
  openIntentions(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  /** The memory of this kind written from `sourceRef` (e.g. `world_event:<id>`), if any. */
  bySourceRef(kind: CoreMemoryKind, sourceRef: string): Promise<CoreMemoryItem | null>;
  setStatus(id: string, status: CoreMemoryStatus): Promise<void>;
  entities(): Promise<CoreEntity[]>;
  /** When the newest person she met first appeared, ignoring `excludeNames` (her canon people). */
  latestEntityFirstSeen(excludeNames: string[]): Promise<Date | null>;
  /** Ids for these names, inserting the ones she doesn't know yet (salience from the caller). */
  addEntities(names: string[], salience: number, now: Date): Promise<string[]>;
  latestSnapshot(): Promise<CoreSnapshot | null>;
  /** False when that version already exists. */
  insertSnapshot(snapshot: CoreSnapshot): Promise<boolean>;
}
