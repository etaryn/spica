/**
 * Her world as the rest of the mind sees it: the shared day plan and what actually happened.
 * Nothing here belongs to a user.
 */
import type { LifePlan } from "@/db/schema";

export type NewWorldEvent = {
  at: Date;
  kind: "planned" | "surprise" | "resolution";
  content: string;
  valence: number;
  stakes: "low" | "high";
  agents: string[];
  life_day: string;
  created_at: Date;
};
export type WorldEventRow = NewWorldEvent & { id: string };

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
  events(day: string): Promise<WorldEventRow[]>;
  recordEvent(event: NewWorldEvent): Promise<string>;
  lastHighStakesAt(): Promise<Date | null>;
  logEventAttempts(attempts: NewEventAttempt[]): Promise<void>;
}
