/**
 * The core mind's data layer: her memory, her state and her world, with no way to name a user.
 * Core loops get only this (never the database), so they can't read user data even by mistake.
 */
import type { CoreMemory } from "@/mind/memory/core/types";
import type { CoreState } from "@/mind/state/core/types";
import type { World } from "@/mind/world/types";

export type LoopStatus = "done" | "fallback" | "skipped_budget" | "failed";

export type NewCoreLoopTrace = {
  /** Set when a loop needs to cite its own run (a memory's `source_ref`) before the row exists. */
  id?: string;
  loop: string;
  inputs: unknown;
  outputs: unknown;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  /** Model calls actually made, retries included; embeddings don't count. */
  calls: number;
  status: LoopStatus;
  /** The error class only, never content. */
  error: string | null;
  created_at: Date;
};

export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
  /** Model calls traced at or after `from`: what today's budget has spent. */
  callsSince(from: Date): Promise<number>;
}

export interface CoreScope {
  memory: CoreMemory;
  state: CoreState;
  world: World;
  traces: CoreTraces;
  /** A transaction-scoped advisory lock; only meaningful inside `transaction`. */
  lock(key: string): Promise<void>;
}

export interface CoreLayer extends CoreScope {
  transaction<T>(fn: (core: CoreScope) => Promise<T>): Promise<T>;
}
