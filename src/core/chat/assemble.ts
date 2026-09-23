import type { ChatMessage } from "../llm/types";

export type RetrievedFact = { content: string; when: Date };
export type DueThread = { title: string };

export interface RetrievalResult {
  facts: { user: RetrievedFact[]; self: RetrievedFact[]; shared: RetrievedFact[] };
  dueThreads: DueThread[];
}

/** Phase 0 has no retrieval; Phase 1 fills this without changing the pipeline. */
export function emptyRetrieval(): RetrievalResult {
  return { facts: { user: [], self: [], shared: [] }, dueThreads: [] };
}

export interface AssembleInput {
  valuesDoc: string;
  egoLine: string | null;
  relationshipSummary: string | null;
  retrieval: RetrievalResult;
  recentTurns: { role: "user" | "companion"; text: string }[];
  now: Date;
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

/** Fixed slot order from spec §4.1 step 3. Empty slots are skipped. */
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
      ? `## Things you might naturally ask about\n${retrieval.dueThreads.map((t) => `- ${t.title}`).join("\n")}`
      : null,
  ].filter((s): s is string => s !== null);

  const firstUser = input.recentTurns.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : input.recentTurns.slice(firstUser);
  const messages: ChatMessage[] = turns.map((t) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.text,
  }));

  return { system: slots.join("\n\n"), messages };
}
