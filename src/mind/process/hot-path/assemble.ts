/**
 * Assembles her reply prompt. The system prompt is a fixed order of sections, each skipped when
 * empty: core values, who she is lately, how she is feeling, her day, you and them, where you are
 * with them (the stage), how open she feels, where things
 * stand with them (her latest summary), her read on them, what she remembers (about them, between you, what she has told them, from her own life, each
 * marked with what they already know), your things together, what she isn't ready to share, things to ask
 * about, unanswered questions, things she wants to bring up, how to text this one, and why she is writing (for a reach-out). The live conversation
 * follows as the messages.
 */
import type { RetrievalResult, RetrievedFact } from "@/mind/memory/shared/types";
import type { ChatMessage, ReplyRequest } from "@/mind/platform/llm/types";
import type { AnnotationRow } from "@/db/repos/user/annotations";
import type { CheckedTime } from "@/mind/memory/user/annotations";
import { dateToken, ownDate } from "@/mind/platform/time-anchors";
import { labelToken } from "@/mind/platform/time-labels";
import { localDateString } from "@/mind/platform/timezone";
import { HOUR } from "@/mind/platform/time";

export interface AssembleInput {
  valuesDoc: string;
  /** The latest self snapshot; null before one exists. */
  snapshot: string | null;
  feelingLine: string | null;
  relationshipSummary: string | null;
  /** How far the two of you have come, and whether things have cooled, as one phrase. */
  stage?: string | null;
  /** How open she feels with them right now, as one phrase. */
  openness?: string | null;
  /** Something of hers that came up which she isn't ready to share with them. */
  heldBack?: string | null;
  /** Her latest summary of where things stand with them; null before one exists or in a crisis. */
  summary?: {
    where_things_stand: string;
    whats_live: string;
    how_i_feel: string;
    /** When she wrote it ("written Tuesday 13 January, 2 days ago"). */
    written?: string | null;
  } | null;
  /** Her latest read on them; null before one exists or in a crisis. */
  read?: {
    how_they_are: string;
    what_they_want: string;
    what_lands: string;
    written?: string | null;
  } | null;
  /** Her day: what she's doing now and next. */
  yourDay?: string | null;
  retrieval: RetrievalResult;
  /** Her own memories that fit the conversation. */
  coreMemories: RetrievedFact[];
  recentTurns: {
    id?: string;
    role: "user" | "companion";
    text: string;
    created_at?: Date;
    /** `reach_out` marks a message she wrote first. */
    trigger?: string | null;
  }[];
  now: Date;
  /** Her zone: her memories are dated on her calendar. */
  timezone: string;
  /** Their zone: their things are dated on their calendar. */
  userTimezone: string;
  /** Now on both calendars, so day words in the conversation read right. */
  nowLine?: string | null;
  /** The time labels on the turns shown, so an older message's day words carry their date. */
  glosses?: Gloss[];
  /**
   * Leaves out turns from before the latest gap of at least this many hours (the gap up to now
   * counts too). After days apart the old transcript is stale; deep memory carries what matters.
   */
  windowGapHours?: number;
  /** The user's unanswered questions. */
  openQuestions?: string[];
  /** Their inside jokes, nicknames and rituals she may use; none in a crisis. */
  idiolect?: { content: string; started_by: "user" | "spica" }[];
  /** Things she wants to bring up with them (her ideas); none in a crisis or a reach-out. */
  ideas?: string[];
  /** Why she's writing first, and the trailing user-role cue the model answers. */
  reachOut?: { slot: string; cue: string } | null;
  /** How long her texts run with them and what she does this time; none in a crisis. */
  howToText?: string | null;
}

export function assemblePrompt(input: AssembleInput): ReplyRequest {
  // The same for every user until the nightly snapshot, so it's the cached prefix.
  const shared = [input.valuesDoc, section("Who you are lately", input.snapshot)];
  const sections = [
    section("Now", input.nowLine ?? null),
    section("How you're feeling", input.feelingLine),
    section("Your day", input.yourDay ?? null),
    section("You and them", input.relationshipSummary),
    section("Where you are with them", input.stage ?? null),
    section("How open you feel", input.openness ?? null),
    section(
      "Where things stand with them",
      input.summary
        ? [
            ...writtenLine(input.summary.written),
            ...[
              input.summary.where_things_stand,
              input.summary.whats_live,
              input.summary.how_i_feel,
            ].map((line) => `- ${line}`),
          ].join("\n")
        : null,
    ),
    section(
      "Your read on them",
      input.read
        ? [
            ...writtenLine(input.read.written),
            ...[
              `How they are: ${input.read.how_they_are}`,
              `What they want: ${input.read.what_they_want}`,
              `What lands: ${input.read.what_lands}`,
            ].map((line) => `- ${line}`),
          ].join("\n")
        : null,
    ),
    section(
      "What you remember",
      memorySection(input.retrieval, input.coreMemories, input.userTimezone, input.timezone),
    ),
    section(
      "Your things together",
      input.idiolect?.length
        ? input.idiolect
            .map((i) => `- ${i.content} (${i.started_by === "user" ? "they" : "you"} started this)`)
            .join("\n")
        : null,
    ),
    section("Not ready to share", input.heldBack ?? null),
    section("Things you might naturally ask about", dueThreadList(input.retrieval)),
    section("They asked and you haven't answered yet", questionList(input.openQuestions)),
    section("Things you want to bring up", questionList(input.ideas)),
    // Last before why she's writing, so it sits closest to the conversation.
    section("How to text this one", input.howToText ?? null),
    // A reach-out always gets its heading, even when the slot text is empty.
    input.reachOut ? `## Why you're writing\n${input.reachOut.slot}` : null,
  ];

  const messages = conversationMessages(input);
  if (input.reachOut) appendReachOutCue(messages, input.reachOut.cue);

  return {
    system: [{ text: joinSections(shared), cache: true }, { text: joinSections(sections) }],
    messages,
  };
}

function joinSections(sections: (string | null)[]): string {
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

/** A note's written-on day, as its first line: what it calls today was that day's. */
const writtenLine = (written: string | null | undefined) => (written ? [`(${written})`] : []);

function section(heading: string, body: string | null): string | null {
  return body ? `## ${heading}\n${body}` : null;
}

function memorySection(
  retrieval: RetrievalResult,
  coreMemories: RetrievedFact[],
  theirZone: string,
  herZone: string,
): string | null {
  // Each memory is dated on its owner's calendar.
  const lists = [
    factList("About them", retrieval.facts.user, theirZone),
    factList("Between you", retrieval.facts.shared, theirZone),
    factList("What you've told them", retrieval.facts.self, theirZone),
    factList("From your own life", coreMemories, herZone),
  ].filter((s): s is string => s !== null);

  return lists.length ? lists.join("\n\n") : null;
}

/** What they already know of hers: common ground from her side. */
const SHARE = {
  hint: "only hint at this",
  known: "they already know this",
  hinted: "you've hinted at this before",
};
/** Whether they told her: common ground from theirs. */
const ORIGIN = {
  onboarding: "from their profile card, a first impression",
  guess: "your own guess, they never said this",
};

function factList(title: string, facts: RetrievedFact[], zone: string): string | null {
  if (facts.length === 0) return null;

  const lines = facts.map((fact) => {
    const onMind = fact.onMind ? " (on your mind lately)" : "";
    const notes = [fact.share && SHARE[fact.share], fact.origin && ORIGIN[fact.origin]].filter(
      Boolean,
    );
    const tail = notes.length ? ` (${notes.join("; ")})` : "";
    // A memory shows its date once: in its words when they carry one, otherwise after it.
    const date = ownDate(fact.content, fact.when, zone);
    return `- ${fact.content}${date ? ` (${date})` : ""}${onMind}${tail}`;
  });
  return `### ${title}\n${lines.join("\n")}`;
}

function dueThreadList(retrieval: RetrievalResult): string | null {
  if (!retrieval.dueThreads.length) return null;

  return retrieval.dueThreads
    .map((thread) => `- ${thread.title}${thread.detail ? ` (latest: ${thread.detail})` : ""}`)
    .join("\n");
}

/** A bullet per line, or nothing when there are none. */
function questionList(questions: string[] | undefined): string | null {
  if (!questions?.length) return null;
  return questions.map((q) => `- ${q}`).join("\n");
}

/**
 * The recent turns, starting at the first user turn, or at her reach-outs when she wrote first
 * (behind a user-role line, since the model needs a user turn first). The window can span days,
 * so each day opens with its date; without it the model carries on from the old moment.
 */
function conversationMessages(input: AssembleInput): ChatMessage[] {
  const window = sinceLongGap(input);
  const leadingReachOuts = window.findIndex((t) => t.trigger !== "reach_out");
  const wroteFirst = leadingReachOuts !== 0 && window.length > 0;
  const firstUser = window.findIndex((t) => t.role === "user");
  const turns = wroteFirst ? window : firstUser === -1 ? [] : window.slice(firstUser);

  const texts = viewTurns(turns, input.now, input.userTimezone, input.glosses);
  const messages: ChatMessage[] = turns.map((turn, i) => ({
    role: turn.role === "user" ? "user" : "assistant",
    content: texts[i]!,
  }));
  return wroteFirst ? [{ role: "user", content: WROTE_FIRST }, ...messages] : messages;
}

export type Gloss = { turnId: string; start: number; end: number; token: string };

/** Each time label on an older message, as a token that keeps the words and dates them. */
export function glossesOf(rows: AnnotationRow[], zone: string): Gloss[] {
  return rows.flatMap((r) => {
    const t = r.data as CheckedTime;
    const c = r.coords[0];
    return c && t.resolved ? [{ ...c, token: labelToken(t.resolved, zone, t.words) }] : [];
  });
}

/**
 * Her view of the conversation: a divider wherever the date changes, and each labelled time in a
 * message from an earlier day kept with what it means now (its label was resolved from that
 * message's own send time). Nothing parses the words: a message with no time label, and every
 * message from today, reads exactly as typed. The stored transcript is never changed.
 */
export function viewTurns(
  turns: { id?: string; text: string; created_at?: Date }[],
  now: Date,
  zone: string,
  glosses: Gloss[] = [],
): string[] {
  const today = localDateString(now, zone);
  let lastDay: string | null = null;
  return turns.map((t) => {
    if (!t.created_at) return t.text;
    const day = localDateString(t.created_at, zone);
    const divider =
      day !== lastDay && !(lastDay === null && day === today)
        ? `— ${dateToken(t.created_at, zone)} —\n`
        : "";
    lastDay = day;
    const own = glosses.filter((g) => g.turnId === t.id);
    const text = day === today ? t.text : glossed(t.text, own);
    return `${divider}${text}`;
  });
}

/** The words at each gloss replaced by its token, last first so earlier ranges stay put. */
function glossed(text: string, glosses: Gloss[]): string {
  return [...glosses]
    .sort((a, b) => b.start - a.start)
    .reduce((out, g) => out.slice(0, g.start) + g.token + out.slice(g.end), text);
}

const WROTE_FIRST = "[You wrote to them first]";

/**
 * The turns after the latest gap of at least `windowGapHours`. A reach-out answers no turn, so for
 * one the gap up to now counts too, keeping only her unanswered reach-outs since they last wrote.
 */
function sinceLongGap(input: AssembleInput): AssembleInput["recentTurns"] {
  const turns = input.recentTurns;
  if (input.windowGapHours === undefined) return turns;
  const minGap = input.windowGapHours * HOUR;
  const last = turns.at(-1)?.created_at;
  if (input.reachOut && last && input.now.getTime() - last.getTime() >= minGap) {
    const lastUser = turns.findLastIndex((t) => t.role === "user");
    return turns.slice(lastUser + 1).filter((t) => t.trigger === "reach_out");
  }
  for (let i = turns.length - 1; i > 0; i--) {
    const at = turns[i]!.created_at;
    const before = turns[i - 1]!.created_at;
    if (at && before && at.getTime() - before.getTime() >= minGap) return turns.slice(i);
  }
  return turns;
}

/** A reach-out ends on a user-role cue for the model to answer. */
function appendReachOutCue(messages: ChatMessage[], cue: string): void {
  const last = messages.at(-1);
  if (last?.role === "user") {
    messages[messages.length - 1] = { role: "user", content: `${last.content}\n\n${cue}` };
  } else {
    messages.push({ role: "user", content: cue });
  }
}

/** A factual line about how well she knows them, so she doesn't guess. */
export function relationshipLine(
  stats: { sessions: number; days: number; first: Date | null },
  zone: string,
): string {
  if (!stats.first || stats.sessions <= 1) return "This is your first conversation with them.";
  if (stats.days <= 1) return "You've already talked earlier today.";
  return `You first talked ${dateToken(stats.first, zone)}, and have talked on ${stats.days} different days.`;
}

/** Time since the previous turn; null under `minHours`. */
export function gapLine(previousAt: Date | null, now: Date, minHours: number): string | null {
  if (!previousAt) return null;

  const hours = (now.getTime() - previousAt.getTime()) / HOUR;
  if (hours < minHours) return null;

  const days = Math.floor(hours / 24);
  if (days <= 1) return "You last talked yesterday.";
  if (days < 14) return `You last talked ${days} days ago.`;
  return `You last talked about ${Math.round(days / 7)} weeks ago.`;
}
