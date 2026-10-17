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
  kind: "planned" | "surprise" | "resolution" | "action";
  content: string;
  valence: number;
  stakes: "low" | "high";
  agents: string[];
  /** The people in it by name, kept so a surprise's people can join her entities when it lands. */
  agent_names?: string[];
  life_day: string;
  created_at: Date;
  plan_ref?: string | null;
  goal_ref?: string | null;
  subject?: string | null;
  outcome?: "happened" | "fell_through" | null;
  fallthrough?: boolean | null;
  resolves_memory_id?: string | null;
};
export type WorldEventRow = NewWorldEvent & {
  id: string;
  agent_names: string[];
  appraised_at: Date | null;
  goal_ref: string | null;
  plan_ref: string | null;
  outcome: "happened" | "fell_through" | null;
  fallthrough: boolean | null;
  resolves_memory_id: string | null;
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
  getEvent(id: string): Promise<WorldEventRow | null>;
  setOutcome(id: string, outcome: "happened" | "fell_through"): Promise<void>;
  /** Events whose time has come (at <= now) that haven't landed with her yet, oldest first. */
  dueUnappraised(now: Date): Promise<WorldEventRow[]>;
  markAppraised(id: string, at: Date): Promise<void>;
  setAgents(id: string, agents: string[]): Promise<void>;
  setGoalRef(id: string, goalId: string): Promise<void>;
  /** The subjects her events were drawn about since `sinceDay` (inclusive). */
  recentSubjects(sinceDay: string): Promise<string[]>;
  lastHighStakesAt(): Promise<Date | null>;
  logEventAttempts(attempts: NewEventAttempt[]): Promise<void>;
}

export type WebItem = {
  source: string;
  url: string;
  title: string;
  credit: string;
  licence: string;
  image: Uint8Array;
};
export interface WebSource {
  label: string;
  fetch(day: string): Promise<WebItem | null>;
}
export type WebSources = Readonly<Record<string, WebSource>>;
export type NewWebFind = {
  source: string;
  url: string;
  title: string;
  credit: string;
  licence: string;
  media_path: string;
  world_event_id: string;
  found_at: Date;
};
export type WebFindRow = NewWebFind & { id: string };
export type PostStatus = "draft" | "approved" | "rejected";
export type PostCheck = "ok" | "flagged" | "unchecked";
export type NewPost = {
  find_id: string;
  medium: "still";
  format: string;
  pose: string;
  caption: string;
  overlay_text: string | null;
  media_path: string;
  skill: number;
  check: PostCheck;
  check_reason: string | null;
  created_at: Date;
};
export type PostRow = NewPost & {
  id: string;
  status: PostStatus;
  decided_at: Date | null;
  action_event_id: string | null;
};

/** Her finds and her posts. Nothing here takes or returns a user id. */
export interface Posts {
  insertFind(row: NewWebFind): Promise<string>;
  findByUrl(url: string): Promise<WebFindRow | null>;
  getFind(id: string): Promise<WebFindRow | null>;
  /** Finds that arrived with an event on her local `day`. */
  findsOn(day: string): Promise<number>;
  /** Finds whose event has landed and that have no post, found at or after `since`, newest first. */
  unposted(since: Date, limit: number): Promise<WebFindRow[]>;
  insertPost(row: NewPost): Promise<string>;
  /** Posts drafted at or after `since`, whatever became of them. */
  postsSince(since: Date): Promise<number>;
  /** Drafts still waiting for a decision. */
  drafts(): Promise<number>;
  getPost(id: string): Promise<PostRow | null>;
  /** The row, locked until the transaction ends; only meaningful inside `transaction`. */
  lockPost(id: string): Promise<PostRow | null>;
  decide(
    id: string,
    patch: { status: "approved" | "rejected"; decided_at: Date; action_event_id: string | null },
  ): Promise<void>;
  /** Newest first, with the find's title and source, for the inspector. */
  recent(limit: number): Promise<(PostRow & { title: string; source: string })[]>;
}
