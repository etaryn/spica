import type { ChatMessage } from "../llm/types";
import type { RecalledFact } from "../memory/types";

export type RetrievedFact = { id: string; content: string; when: Date };
export type DueThread = { id: string; title: string; detail?: string | null };

export interface RetrievalResult {
  facts: { user: RetrievedFact[]; self: RetrievedFact[]; shared: RetrievedFact[] };
  dueThreads: DueThread[];
  /** Everything included in the prompt, for the cold path's recall write-back and trace. */
  recalled: RecalledFact[];
}

/** Phase 0 has no retrieval; Phase 1 fills this without changing the pipeline. */
export function emptyRetrieval(): RetrievalResult {
  return { facts: { user: [], self: [], shared: [] }, dueThreads: [], recalled: [] };
}

export interface AssembleInput {
  valuesDoc: string;
  egoLine: string | null;
  relationshipSummary: string | null;
  retrieval: RetrievalResult;
  recentTurns: { role: "user" | "companion"; text: string; created_at?: Date }[];
  now: Date;
  /** Mark the first user message after a gap of at least this many hours ("[7 days later] …"). */
  gapMarkerMinHours?: number;
}

const DAY = 86_400_000;

export function relativeDate(d: Date, now: Date): string {
  const startOf = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.round((startOf(now) - startOf(d)) / DAY);
  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function factList(title: string, facts: RetrievedFact[], now: Date): string | null {
  if (facts.length === 0) return null;
  return `### ${title}\n${facts.map((f) => `- ${f.content} (${relativeDate(f.when, now)})`).join("\n")}`;
}

/** Fixed slot order from v2 §6.2 step 2. Empty slots are skipped. */
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
    memory.length ? `## What you remember\n${memory.join("\n\n")}` : null,
    retrieval.dueThreads.length
      ? `## Things you might naturally ask about\n${retrieval.dueThreads.map((t) => `- ${t.title}${t.detail ? ` (latest: ${t.detail})` : ""}`).join("\n")}`
      : null,
  ].filter((s): s is string => s !== null);

  const firstUser = input.recentTurns.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : input.recentTurns.slice(firstUser);
  // The window can span days; without a marker the model carries on from the old moment.
  const messages: ChatMessage[] = turns.map((t, i) => {
    const prev = turns[i - 1];
    const gapHours = prev?.created_at && t.created_at ? (t.created_at.getTime() - prev.created_at.getTime()) / 3_600_000 : 0;
    const marked = t.role === "user" && input.gapMarkerMinHours !== undefined && gapHours >= input.gapMarkerMinHours;
    return { role: t.role === "user" ? "user" : "assistant", content: marked ? `[${elapsed(gapHours)} later] ${t.text}` : t.text };
  });

  return { system: slots.join("\n\n"), messages };
}

function elapsed(hours: number): string {
  const days = Math.round(hours / 24);
  if (days <= 1) return "1 day";
  if (days < 14) return `${days} days`;
  return `about ${Math.round(days / 7)} weeks`;
}

/** Factual relationship line (spec §6): how well she knows them, so she doesn't guess. */
export function relationshipLine(s: { sessions: number; days: number; first: Date | null }, now: Date): string {
  if (!s.first || s.sessions <= 1) return "This is your first conversation with them.";
  if (s.days <= 1) return "You've already talked earlier today.";
  return `You first talked ${relativeDate(s.first, now)}, and have talked on ${s.days} different days.`;
}

/** Phase 1 relationship line: time since the previous turn, omitted under `minHours` (v2 §6.2 slot 3). */
export function gapLine(prevAt: Date | null, now: Date, minHours: number): string | null {
  if (!prevAt) return null;
  const hours = (now.getTime() - prevAt.getTime()) / 3_600_000;
  if (hours < minHours) return null;
  const days = Math.floor(hours / 24);
  if (days <= 1) return "You last talked yesterday.";
  if (days < 14) return `You last talked ${days} days ago.`;
  return `You last talked about ${Math.round(days / 7)} weeks ago.`;
}
