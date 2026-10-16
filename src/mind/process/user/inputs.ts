/**
 * What every loop in one user mind run reads: her notes so far and the memories they haven't read
 * yet, read once before the loops so each sees the same memories even if an earlier loop fails;
 * and the run's triggers in plain words. Sensitive memories (from a crisis) are read only while a
 * crisis window is open; outside one the chain restarts from her clean notes.
 */
import { listUnreadFacts, type FactRow, type UnreadFact } from "@/db/repos/user/facts";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import { latestNonSensitiveSummary, liveSummary, type Trigger } from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { DAY } from "@/mind/platform/time";
import { effectiveCrisisQuietUntil } from "@/mind/process/outreach/inputs";
import type { UserLoopDeps } from "./runner";

export type RunInputs = {
  previous: FactRow | null;
  facts: UnreadFact[];
  /** Outside an open crisis window: nothing a crisis touched is read, so nothing written is marked. */
  clean: boolean;
};

export async function loadRunInputs(
  deps: Pick<UserLoopDeps, "db" | "config" | "clock">,
  userId: string,
): Promise<RunInputs> {
  const { db, config } = deps;
  const now = deps.clock.now();
  const row = await getRelationshipRow(db, userId);
  const quietUntil = await effectiveCrisisQuietUntil(
    deps,
    userId,
    row?.crisis_quiet_until ?? null,
    now,
  );
  // A crisis rides her notes only while it's live; after it, the chain restarts from clean notes.
  const clean = !(quietUntil && quietUntil > now);
  const previous = clean
    ? await latestNonSensitiveSummary(db, userId)
    : await liveSummary(db, userId);
  const settings = config.user_mind.summarise;
  const facts = await listUnreadFacts(db, userId, {
    since: new Date(now.getTime() - settings.unread_days * DAY),
    clean,
    limit: settings.max_facts,
  });
  return { previous, facts, clean };
}

/** What a run may read: outside a crisis window, nothing a crisis touched. */
export function visible<T extends { payload: unknown }>(
  inputs: Pick<RunInputs, "clean">,
  rows: T[],
): T[] {
  return inputs.clean ? rows.filter((r) => !isSensitive(r)) : rows;
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

function paramMove(t: { param: string; from: number; to: number }, sharply: boolean): string {
  const what =
    t.param === "affect_valence" ? "how warmly you feel toward them" : `${t.param} between you`;
  return `${what} just ${t.to > t.from ? "rose" : "fell"}${sharply ? " sharply" : ""}`;
}

export function triggerText(t: Trigger): string {
  switch (t.kind) {
    case "param_jump":
      return paramMove(t, true);
    case "param_band":
      return paramMove(t, false);
    case "salient_fact":
      // Runs recorded before the content was kept read the old way.
      return t.content ? `they told you: ${t.content}` : "they told you something";
    case "repaired":
      return t.via === "apology"
        ? "they apologised, and the hurt has passed"
        : "the hurt between you has faded";
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
