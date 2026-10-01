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

export interface World {
  plan(day: string): Promise<LifePlan | null>;
  events(day: string): Promise<WorldEventRow[]>;
  recordEvent(event: NewWorldEvent): Promise<string>;
  lastHighStakesAt(): Promise<Date | null>;
}
