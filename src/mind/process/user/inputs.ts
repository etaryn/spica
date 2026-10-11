/**
 * What every loop in one user mind run reads: her live summary and what she has learned since
 * it, read once before the loops so each sees the same memories even if an earlier loop fails;
 * and the run's triggers in plain words. Sensitive memories (from a crisis) are included and
 * flagged; ideate and reach-outs never read them.
 */
import { listFactsForSummary, type FactRow } from "@/db/repos/user/facts";
import { liveSummary, summaryInputFactIds, type Trigger } from "@/db/repos/user/user-mind";
import { MINUTE } from "@/mind/platform/time";
import type { UserLoopDeps } from "./runner";

export type RunInputs = {
  previous: FactRow | null;
  facts: Awaited<ReturnType<typeof listFactsForSummary>>;
};

export async function loadRunInputs(
  deps: Pick<UserLoopDeps, "db" | "config">,
  userId: string,
): Promise<RunInputs> {
  const { db } = deps;
  const settings = deps.config.user_mind.summarise;
  const previous = await liveSummary(db, userId);
  // Memories are dated by when their exchange began, so one whose cold path committed after
  // the last summary can be dated before it: look back a little, minus what it already read.
  // ponytail: a cold path the daily sweep recovers can commit later than the slack; widen it if
  // those memories matter
  const since = previous
    ? new Date(previous.created_at.getTime() - settings.since_slack_minutes * MINUTE)
    : null;
  const consumed = previous ? await summaryInputFactIds(db, userId, previous.id) : [];
  const facts = await listFactsForSummary(db, userId, since, consumed, settings.max_facts);
  return { previous, facts };
}

const MILESTONE_TEXT: Record<string, string> = {
  "stage:experimenting": "you two have started getting to know each other",
  "stage:intensifying": "you two are becoming friends",
  "stage:integrating": `you two have become close: there's a "we" now`,
  "stage:bonding": "you two are properly close friends now, the kind that lasts",
  first_conflict: "you two had your first real falling-out",
  first_inside_joke: "you two have your first inside joke",
  "first_depth:2": "you told them something personal about yourself for the first time",
  "first_depth:3":
    "you told them something only someone really close would hear, for the first time",
  first_their_depth: "they opened up to you about something deeply personal for the first time",
};

export function triggerText(t: Trigger): string {
  switch (t.kind) {
    case "param_jump":
      return `${t.param} between you just ${t.to > t.from ? "rose" : "fell"} sharply`;
    case "param_band":
      return `${t.param} between you just ${t.to > t.from ? "rose" : "fell"}`;
    case "salient_fact":
      return "they told you something important";
    case "make_up_done":
      return "you two made up after a hurt";
    case "long_conversation":
      return "you two just had a long conversation";
    case "crisis_passed":
      return "they went through something hard, and it has eased";
    case "stale_summary":
      return "you're about to write to them and haven't taken stock in a while";
    case "milestone":
      return MILESTONE_TEXT[t.name] ?? "something new happened between you";
  }
}

/** The memories as a loop's prompt shows them. */
export function memoryLines(facts: RunInputs["facts"]) {
  return facts.map(({ subject, kind, content }) => ({ subject, kind, content }));
}
