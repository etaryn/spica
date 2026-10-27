/**
 * What every loop in one user mind run reads: her notes so far and the memories they haven't read
 * yet, read once before the loops so each sees the same memories even if an earlier loop fails;
 * and the run's triggers in plain words. Sensitive memories (from a crisis) are read only while a
 * crisis window is open; outside one the chain restarts from her clean notes.
 */
import type { Db } from "@/db/client";
import {
  factCites,
  liveFactsByIds,
  listUnreadFacts,
  type FactRow,
  type UnreadFact,
} from "@/db/repos/user/facts";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import { getTimezone } from "@/db/repos/user/users";
import { latestNonSensitiveSummary, liveSummary, type Trigger } from "@/db/repos/user/user-mind";
import { lineHead } from "@/mind/memory/user/memory-line";
import { isSensitive } from "@/mind/memory/user/retrieve";
import type { Citable, Owner } from "@/mind/platform/notes";
import { DAY } from "@/mind/platform/time";
import { dateToken, ownDate, tokenDates, written } from "@/mind/platform/time-anchors";
import { zoneOrUtc } from "@/mind/platform/timezone";
import { effectiveCrisisQuietUntil } from "@/mind/process/outreach/inputs";
import type { UserLoopDeps } from "./runner";

export type RunInputs = {
  previous: FactRow | null;
  facts: UnreadFact[];
  /** Outside an open crisis window: nothing a crisis touched is read, so nothing written is marked. */
  clean: boolean;
  /** Their timezone, for dating what the loops read; null means UTC. */
  timezone: string | null;
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
  return { previous, facts, clean, timezone: await getTimezone(db, userId) };
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

/** One of her notes as a loop reads it, headed by when she wrote it: its "today" was that day's. */
export function stampedNote(
  row: { payload: unknown; created_at: Date } | null,
  tz: string | null,
): Record<string, unknown> | null {
  if (!row?.payload || typeof row.payload !== "object") return null;
  return {
    written: written(row.created_at, zoneOrUtc(tz)),
    ...(row.payload as Record<string, unknown>),
  };
}

/** Open storylines: the event's day apart from when to ask, so a check-in never reads as the event. */
export function threadLines(
  threads: { title: string; event?: string | null; next_checkpoint: Date | null }[],
  tz: string | null,
): string[] {
  const zone = zoneOrUtc(tz);
  return threads.map((t) => {
    const parts = [
      ...(t.event ? [`on ${t.event}`] : []),
      ...(t.next_checkpoint ? [`ask after ${dateToken(t.next_checkpoint, zone)}`] : []),
    ];
    return parts.length ? `${t.title} (${parts.join("; ")})` : t.title;
  });
}

type Subject = "user" | "self" | "shared";
export type MemoryRow = {
  id: string;
  subject: Subject;
  kind: string;
  content: string;
  occurred_at: Date | null;
};
export type ThreadRow = {
  id: string;
  title: string;
  subject: Subject;
  event: string | null;
  next_checkpoint: Date | null;
};

const OWNER: Record<Subject, Owner> = { user: "theirs", self: "yours", shared: "you both" };

/**
 * What a loop may cite, numbered for it: the run's new memories, then the older ones her notes
 * already cite, then the open storylines. Each is shown with its id, and reads in a note as its
 * own line with whose it is.
 */
export function citables(
  facts: MemoryRow[],
  earlier: MemoryRow[],
  threads: ThreadRow[],
  tz: string | null,
) {
  const zone = zoneOrUtc(tz);
  const memories = [...facts, ...earlier].map((f, i) => {
    const id = `m${i + 1}`;
    const head = lineHead(f.content);
    const date = ownDate(head, f.occurred_at, zone);
    const item: Citable = {
      id,
      ref: f.id,
      kind: "memory",
      text: date ? `${head} ${date}` : head,
      owner: OWNER[f.subject],
      at: f.occurred_at,
    };
    const line = {
      id,
      subject: f.subject,
      kind: f.kind,
      content: f.content,
      when: ownDate(f.content, f.occurred_at, zone),
    };
    return { item, line };
  });
  const lines = threadLines(threads, tz);
  const storylines = threads.map((t, i) => {
    const id = `t${i + 1}`;
    const item: Citable = {
      id,
      ref: t.id,
      kind: "thread",
      text: lines[i]!,
      owner: OWNER[t.subject],
      at: t.event ? (tokenDates(t.event)[0] ?? null) : null,
    };
    return { item, line: { id, thread: lines[i]! } };
  });
  return {
    new_memories: memories.slice(0, facts.length).map((m) => m.line),
    earlier_memories: memories.slice(facts.length).map((m) => m.line),
    open_threads: storylines.map((s) => s.line),
    items: [...memories, ...storylines].map((x) => x.item),
  };
}

/**
 * The live memories her notes cite that this run didn't bring, so a note can cite them again
 * instead of copying their dates.
 */
export async function earlierMemories(
  db: Db,
  userId: string,
  notes: ({ payload: unknown } | null | undefined)[],
  opts: { exclude: string[]; clean: boolean },
): Promise<UnreadFact[]> {
  const skip = new Set(opts.exclude);
  const ids = [...new Set(notes.flatMap((n) => (n ? factCites(n.payload) : [])))];
  return liveFactsByIds(
    db,
    userId,
    ids.filter((id) => !skip.has(id)),
    opts.clean,
  );
}
