/**
 * Assembles her reply prompt. The system prompt is a fixed order of sections, each skipped when
 * empty: core values, who she is lately, how she is feeling, her day, you and them, where things
 * stand with them (her latest summary), what she remembers (about them, between you, what she has told them, from her own life), things to ask
 * about, unanswered questions, things she wants to bring up, and why she is writing (for a reach-out). The live conversation
 * follows as the messages.
 */
import type { RetrievalResult, RetrievedFact } from "@/mind/memory/shared/types";
import type { ChatMessage } from "@/mind/platform/llm/types";
import { relativeDate } from "@/mind/platform/relative-date";
import { HOUR } from "@/mind/platform/time";

export interface AssembleInput {
  valuesDoc: string;
  /** The latest self snapshot; null before one exists. */
  snapshot: string | null;
  feelingLine: string | null;
  relationshipSummary: string | null;
  /** Her latest summary of where things stand with them; null before one exists or in a crisis. */
  summary?: { where_things_stand: string; whats_live: string; how_i_feel: string } | null;
  /** Her day: what she's doing now and next. */
  yourDay?: string | null;
  retrieval: RetrievalResult;
  /** Her own memories that fit the conversation. */
  coreMemories: RetrievedFact[];
  recentTurns: { role: "user" | "companion"; text: string; created_at?: Date }[];
  now: Date;
  /** Marks the first user message after a gap of at least this many hours ("[7 days later] …"). */
  gapMarkerMinHours?: number;
  /**
   * Leaves out turns from before the latest gap of at least this many hours (the gap up to now
   * counts too). After days apart the old transcript is stale; deep memory carries what matters.
   */
  windowGapHours?: number;
  /** The user's unanswered questions. */
  openQuestions?: string[];
  /** Things she wants to bring up with them (her ideas); none in a crisis or a reach-out. */
  ideas?: string[];
  /** Why she's writing first, and the trailing user-role cue the model answers. */
  reachOut?: { slot: string; cue: string } | null;
}

export function assemblePrompt(input: AssembleInput): { system: string; messages: ChatMessage[] } {
  const sections = [
    input.valuesDoc,
    section("Who you are lately", input.snapshot),
    section("How you're feeling", input.feelingLine),
    section("Your day", input.yourDay ?? null),
    section("You and them", input.relationshipSummary),
    section(
      "Where things stand with them",
      input.summary
        ? [input.summary.where_things_stand, input.summary.whats_live, input.summary.how_i_feel]
            .map((line) => `- ${line}`)
            .join("\n")
        : null,
    ),
    section("What you remember", memorySection(input.retrieval, input.coreMemories, input.now)),
    section("Things you might naturally ask about", dueThreadList(input.retrieval)),
    section("They asked and you haven't answered yet", questionList(input.openQuestions)),
    section("Things you want to bring up", questionList(input.ideas)),
    // A reach-out always gets its heading, even when the slot text is empty.
    input.reachOut ? `## Why you're writing\n${input.reachOut.slot}` : null,
  ].filter((s): s is string => s !== null);

  const messages = conversationMessages(input);
  if (input.reachOut) appendReachOutCue(messages, input.reachOut.cue);

  return { system: sections.join("\n\n"), messages };
}

function section(heading: string, body: string | null): string | null {
  return body ? `## ${heading}\n${body}` : null;
}

function memorySection(
  retrieval: RetrievalResult,
  coreMemories: RetrievedFact[],
  now: Date,
): string | null {
  const lists = [
    factList("About them", retrieval.facts.user, now),
    factList("Between you", retrieval.facts.shared, now),
    factList("What you've told them", retrieval.facts.self, now),
    factList("From your own life", coreMemories, now),
  ].filter((s): s is string => s !== null);

  return lists.length ? lists.join("\n\n") : null;
}

function factList(title: string, facts: RetrievedFact[], now: Date): string | null {
  if (facts.length === 0) return null;

  const lines = facts.map((fact) => {
    const onMind = fact.onMind ? " (on your mind lately)" : "";
    return `- ${fact.content} (${relativeDate(fact.when, now)})${onMind}`;
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
 * The recent turns, starting at the first user turn. The window can span days, so a user turn
 * after a long gap is marked; without the marker the model carries on from the old moment.
 */
function conversationMessages(input: AssembleInput): ChatMessage[] {
  const window = sinceLongGap(input);
  const firstUser = window.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : window.slice(firstUser);

  return turns.map((turn, i) => {
    const previous = turns[i - 1];
    const gapHours =
      previous?.created_at && turn.created_at
        ? (turn.created_at.getTime() - previous.created_at.getTime()) / HOUR
        : 0;
    const marked =
      turn.role === "user" &&
      input.gapMarkerMinHours !== undefined &&
      gapHours >= input.gapMarkerMinHours;

    return {
      role: turn.role === "user" ? "user" : "assistant",
      content: marked ? `[${elapsed(gapHours)} later] ${turn.text}` : turn.text,
    };
  });
}

/** The turns after the latest gap of at least `windowGapHours`, counting the gap up to now. */
function sinceLongGap(input: AssembleInput): AssembleInput["recentTurns"] {
  const turns = input.recentTurns;
  if (input.windowGapHours === undefined) return turns;
  const minGap = input.windowGapHours * HOUR;
  const last = turns.at(-1)?.created_at;
  if (last && input.now.getTime() - last.getTime() >= minGap) return [];
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

function elapsed(hours: number): string {
  const days = Math.round(hours / 24);
  if (days <= 1) return "1 day";
  if (days < 14) return `${days} days`;
  return `about ${Math.round(days / 7)} weeks`;
}

/** A factual line about how well she knows them, so she doesn't guess. */
export function relationshipLine(
  stats: { sessions: number; days: number; first: Date | null },
  now: Date,
): string {
  if (!stats.first || stats.sessions <= 1) return "This is your first conversation with them.";
  if (stats.days <= 1) return "You've already talked earlier today.";
  return `You first talked ${relativeDate(stats.first, now)}, and have talked on ${stats.days} different days.`;
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
