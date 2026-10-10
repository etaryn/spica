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
  /** How much of herself it reveals: 1 surface, 2 personal, 3 intimate. */
  depth: number;
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
  /** The loops always judge it; left out, the column's default (personal) applies. */
  depth?: number;
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
  valence: number;
  /** Best similarity to an active goal; 0 with none. */
  goal_sim: number;
  depth: number;
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
  embedding: number[] | null;
  content: string;
  sections: Record<string, string>;
  source_ids: string[];
  rendered_at: Date;
  model: string;
  prompt_version: string;
};

export type CoreSelfLine = {
  id: string;
  version: number | null;
  text: string;
  embedding: number[];
  depth: number;
};
/** Left out, a line is surface. */
export type NewCoreSelfLine = Omit<CoreSelfLine, "id" | "depth"> & { depth?: number };
/** What a claim of hers matched in core: one memory or one line of her self. */
export type GroundRef = { kind: "memory" | "self_line"; id: string; depth: number };

export type CoreGistGroup = { week: string; sources: CoreMemoryItem[] };

export interface CoreMemory {
  /** Active, unreflected episodes, thoughts and ideas at or before `to`, oldest first then ID. */
  reflectInputs(to: Date, limit: number): Promise<CoreMemoryItem[]>;
  /** Mark selected inputs inside the same transaction as their successful reflection trace. */
  markReflected(ids: string[], now: Date): Promise<number>;
  /** Active memories of the requested kinds, closest first then ID. */
  nearestActive(
    embedding: number[],
    kinds: CoreMemoryKind[],
    limit: number,
  ): Promise<CoreMemoryItem[]>;
  /** Active items by descending salience, newest creation time, then ID. */
  activeByKind(kind: CoreMemoryKind, limit: number): Promise<CoreMemoryItem[]>;
  /** Active insights in (from, to], newest first then ID; null starts all history. */
  recentInsights(from: Date | null, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  latestNarrative(): Promise<CoreMemoryItem | null>;
  supersede(id: string, replacementId: string): Promise<void>;
  /** True when an active item was faded. */
  scaleSalience(id: string, factor: number): Promise<boolean>;
  /** Untouched before cutoff, excluding open intentions, preoccupation, latest narrative and direct active-goal episodes. */
  decay(cutoff: Date, rate: number, staleFloor: number): Promise<number>;
  /** Resolved ungisted episodes before the local cutoff day, grouped by Monday week; oldest week first, sources by time then ID. */
  eligibleGistGroups(
    beforeLocalDay: string,
    timezone: string,
    minSources: number,
    limit: number,
  ): Promise<CoreGistGroup[]>;
  /** Locks and rechecks every source (including age and one local week); false writes nothing. Use with gist insertion inside a transaction. */
  gistSources(
    ids: string[],
    gistId: string,
    factor: number,
    beforeLocalDay: string,
    timezone: string,
    minSources: number,
  ): Promise<boolean>;
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
  /**
   * Her best match for a claim, across her recallable memory, her core values and her latest
   * self: its similarity and what it was. 0 and null when she has none.
   */
  groundingMatch(embedding: number[]): Promise<{ similarity: number; ref: GroundRef | null }>;
  /** The newest `limit` episodes whose time falls in (from, to], oldest first. */
  recentEpisodes(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  /** Her thoughts and ideas created in (from, to], newest first; hypotheticals are their own kind. */
  recentThoughts(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
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
  snapshot(version: number): Promise<CoreSnapshot | null>;
  /** Only fills an existing null embedding; never changes content or a populated vector. */
  backfillSnapshotEmbedding(version: number, embedding: number[]): Promise<void>;
  selfLines(version: number | null): Promise<CoreSelfLine[]>;
  insertSelfLines(lines: NewCoreSelfLine[]): Promise<void>;
  /** False when that version already exists. */
  insertSnapshot(snapshot: CoreSnapshot & { embedding: number[] }): Promise<boolean>;
}
