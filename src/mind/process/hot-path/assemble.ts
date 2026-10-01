/**
 * Assembles her reply prompt. The system prompt is a fixed order of sections, each skipped when
 * empty: core values, how she's feeling, you and them, her day, what she remembers, things to
 * ask about, unanswered questions, and why she's writing (for a reach-out). The live
 * conversation follows as the messages.
 */
import type { RetrievalResult, RetrievedFact } from "@/mind/memory/shared/types";
import type { ChatMessage } from "@/mind/platform/llm/types";
import { relativeDate } from "@/mind/platform/relative-date";
import { HOUR } from "@/mind/platform/time";

export interface AssembleInput {
  valuesDoc: string;
  feelingLine: string | null;
  relationshipSummary: string | null;
  /** Her day: what she's doing now and next. */
  yourDay?: string | null;
  retrieval: RetrievalResult;
  recentTurns: { role: "user" | "companion"; text: string; created_at?: Date }[];
  now: Date;
  /** Marks the first user message after a gap of at least this many hours ("[7 days later] …"). */
  gapMarkerMinHours?: number;
  /** The user's unanswered questions. */
  openQuestions?: string[];
  /** Why she's writing first, and the trailing user-role cue the model answers. */
  reachOut?: { slot: string; cue: string } | null;
}

export function assemblePrompt(input: AssembleInput): { system: string; messages: ChatMessage[] } {
  const sections = [
    input.valuesDoc,
    section("How you're feeling", input.feelingLine),
    section("You and them", input.relationshipSummary),
    section("Your day", input.yourDay ?? null),
    section("What you remember", memorySection(input.retrieval, input.now)),
    section("Things you might naturally ask about", dueThreadList(input.retrieval)),
    section("They asked and you haven't answered yet", questionList(input.openQuestions)),
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

function memorySection(retrieval: RetrievalResult, now: Date): string | null {
  const lists = [
    factList("About them", retrieval.facts.user, now),
    factList("About you", retrieval.facts.self, now),
    factList("Between you", retrieval.facts.shared, now),
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

function questionList(questions: string[] | undefined): string | null {
  if (!questions?.length) return null;
  return questions.map((q) => `- ${q}`).join("\n");
}

/**
 * The recent turns, starting at the first user turn. The window can span days, so a user turn
 * after a long gap is marked; without the marker the model carries on from the old moment.
 */
function conversationMessages(input: AssembleInput): ChatMessage[] {
  const firstUser = input.recentTurns.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : input.recentTurns.slice(firstUser);

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
