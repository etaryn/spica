/**
 * The core mind's data layer: her memory, her state and her world, with no way to name a user.
 * Core loops get only this (never the database), so they can't read user data even by mistake.
 */
import type { CoreMemory } from "@/mind/memory/core/types";
import type { CoreState } from "@/mind/state/core/types";
import type { World } from "@/mind/world/types";

export type NewCoreLoopTrace = {
  loop: string;
  inputs: unknown;
  outputs: unknown;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  created_at: Date;
};

export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
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
