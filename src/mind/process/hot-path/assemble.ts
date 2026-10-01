import { relativeDate } from "@/mind/platform/relative-date";
import type { ChatMessage } from "@/mind/platform/llm/types";
import type { RecalledFact } from "@/mind/memory/shared/types";
import { HOUR } from "@/mind/platform/time";

export type RetrievedFact = { id: string; content: string; when: Date; onMind?: boolean };
export type DueThread = { id: string; title: string; detail?: string | null };

export interface RetrievalResult {
  facts: { user: RetrievedFact[]; self: RetrievedFact[]; shared: RetrievedFact[] };
  dueThreads: DueThread[];
  /** Everything included in the prompt, for the cold path's recall write-back and trace. */
  recalled: RecalledFact[];
}

/** Retrieval output as the prompt sees it; empty when retrieval is degraded. */
export function emptyRetrieval(): RetrievalResult {
  return { facts: { user: [], self: [], shared: [] }, dueThreads: [], recalled: [] };
}

export interface AssembleInput {
  valuesDoc: string;
  egoLine: string | null;
  relationshipSummary: string | null;
  /** Her day: what she is doing now and next. */
  lifeState?: string | null;
  retrieval: RetrievalResult;
  recentTurns: { role: "user" | "companion"; text: string; created_at?: Date }[];
  now: Date;
  /** Mark the first user message after a gap of at least this many hours ("[7 days later] …"). */
  gapMarkerMinHours?: number;
  /** The user's unanswered questions. */
  openQuestions?: string[];
  /** Slot 7b: why she's writing first, and the trailing user-role cue the model answers. */
  reachOut?: { slot: string; cue: string } | null;
}

function factList(title: string, facts: RetrievedFact[], now: Date): string | null {
  if (facts.length === 0) return null;
  return `### ${title}\n${facts.map((f) => `- ${f.content} (${relativeDate(f.when, now)})${f.onMind ? " (on your mind lately)" : ""}`).join("\n")}`;
}

/** Fixed slot order of the reply prompt. Empty slots are skipped. */
export function assemblePrompt(input: AssembleInput): { system: string; messages: ChatMessage[] } {
  const { retrieval, now } = input;
  const memory = [
    factList("About them", retrieval.facts.user, now),
    factList("About you", retrieval.facts.self, now),
    factList("Between you", retrieval.facts.shared, now),
  ].filter((s): s is string => s !== null);

  const slots = [
    input.valuesDoc,
    input.egoLine ? `## How you're feeling\n${input.egoLine}` : null,
    input.relationshipSummary ? `## You and them\n${input.relationshipSummary}` : null,
    input.lifeState
      ? `## Your day
${input.lifeState}`
      : null,
    memory.length ? `## What you remember\n${memory.join("\n\n")}` : null,
    retrieval.dueThreads.length
      ? `## Things you might naturally ask about\n${retrieval.dueThreads.map((t) => `- ${t.title}${t.detail ? ` (latest: ${t.detail})` : ""}`).join("\n")}`
      : null,
    input.openQuestions?.length
      ? `## They asked and you haven't answered yet\n${input.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : null,
    input.reachOut ? `## Why you're writing\n${input.reachOut.slot}` : null,
  ].filter((s): s is string => s !== null);

  const firstUser = input.recentTurns.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : input.recentTurns.slice(firstUser);
  // The window can span days; without a marker the model carries on from the old moment.
  const messages: ChatMessage[] = turns.map((t, i) => {
    const prev = turns[i - 1];
    const gapHours =
      prev?.created_at && t.created_at
        ? (t.created_at.getTime() - prev.created_at.getTime()) / HOUR
        : 0;
    const marked =
      t.role === "user" &&
      input.gapMarkerMinHours !== undefined &&
      gapHours >= input.gapMarkerMinHours;
    return {
      role: t.role === "user" ? "user" : "assistant",
      content: marked ? `[${elapsed(gapHours)} later] ${t.text}` : t.text,
    };
  });

  if (input.reachOut) {
    const last = messages.at(-1);
    if (last?.role === "user")
      messages[messages.length - 1] = {
        role: "user",
        content: `${last.content}\n\n${input.reachOut.cue}`,
      };
    else messages.push({ role: "user", content: input.reachOut.cue });
  }

  return { system: slots.join("\n\n"), messages };
}

function elapsed(hours: number): string {
  const days = Math.round(hours / 24);
  if (days <= 1) return "1 day";
  if (days < 14) return `${days} days`;
  return `about ${Math.round(days / 7)} weeks`;
}

/** Factual relationship line: how well she knows them, so she doesn't guess. */
export function relationshipLine(
  s: { sessions: number; days: number; first: Date | null },
  now: Date,
): string {
  if (!s.first || s.sessions <= 1) return "This is your first conversation with them.";
  if (s.days <= 1) return "You've already talked earlier today.";
  return `You first talked ${relativeDate(s.first, now)}, and have talked on ${s.days} different days.`;
}

/** The gap line: time since the previous turn, omitted under `minHours`. */
export function gapLine(prevAt: Date | null, now: Date, minHours: number): string | null {
  if (!prevAt) return null;
  const hours = (now.getTime() - prevAt.getTime()) / HOUR;
  if (hours < minHours) return null;
  const days = Math.floor(hours / 24);
  if (days <= 1) return "You last talked yesterday.";
  if (days < 14) return `You last talked ${days} days ago.`;
  return `You last talked about ${Math.round(days / 7)} weeks ago.`;
}
