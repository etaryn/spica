/**
 * Her world as the rest of the mind sees it: the shared day plan and what actually happened.
 * Nothing here belongs to a user.
 */
import type { LifePlan } from "@/db/schema";

export type NewLifeDay = {
  date: string;
  plan: LifePlan;
  source: "model" | "fallback" | "scripted";
  model: string;
  prompt_version: string;
  generated_at: Date;
};

export type NewWorldEvent = {
  at: Date;
  kind: "planned" | "surprise" | "resolution";
  content: string;
  valence: number;
  stakes: "low" | "high";
  agents: string[];
  /** The people in it by name, kept so a surprise's people can join her entities when it lands. */
  agent_names?: string[];
  life_day: string;
  created_at: Date;
};
export type WorldEventRow = NewWorldEvent & {
  id: string;
  agent_names: string[];
  appraised_at: Date | null;
};

/** One event-generator attempt, for the inspector. */
export type NewEventAttempt = {
  life_day: string;
  attempt: number;
  candidate: unknown;
  decision: string;
  target_memory_id: string | null;
  world_event_id: string | null;
  model: string;
  prompt_version: string;
  created_at: Date;
};

export interface World {
  plan(day: string): Promise<LifePlan | null>;
  /** The `limit` plans before `day`, oldest first (the plan generator's continuity context). */
  plansBefore(day: string, limit: number): Promise<{ date: string; plan: LifePlan }[]>;
  /** False when that day already has a plan (a concurrent generator's row wins). */
  insertPlan(row: NewLifeDay): Promise<boolean>;
  events(day: string): Promise<WorldEventRow[]>;
  recordEvent(event: NewWorldEvent): Promise<string>;
  /** Events whose time has come (at <= now) that haven't landed with her yet, oldest first. */
  dueUnappraised(now: Date): Promise<WorldEventRow[]>;
  markAppraised(id: string, at: Date): Promise<void>;
  setAgents(id: string, agents: string[]): Promise<void>;
  lastHighStakesAt(): Promise<Date | null>;
  logEventAttempts(attempts: NewEventAttempt[]): Promise<void>;
}
