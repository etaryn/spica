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
import { relativeDate } from "@/mind/platform/relative-date";
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
  summary?: { where_things_stand: string; whats_live: string; how_i_feel: string } | null;
  /** Her latest read on them; null before one exists or in a crisis. */
  read?: { how_they_are: string; what_they_want: string; what_lands: string } | null;
  /** Her day: what she's doing now and next. */
  yourDay?: string | null;
  retrieval: RetrievalResult;
  /** Her own memories that fit the conversation. */
  coreMemories: RetrievedFact[];
  recentTurns: {
    role: "user" | "companion";
    text: string;
    created_at?: Date;
    /** `reach_out` marks a message she wrote first. */
    trigger?: string | null;
  }[];
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
    section("How you're feeling", input.feelingLine),
    section("Your day", input.yourDay ?? null),
    section("You and them", input.relationshipSummary),
    section("Where you are with them", input.stage ?? null),
    section("How open you feel", input.openness ?? null),
    section(
      "Where things stand with them",
      input.summary
        ? [input.summary.where_things_stand, input.summary.whats_live, input.summary.how_i_feel]
            .map((line) => `- ${line}`)
            .join("\n")
        : null,
    ),
    section(
      "Your read on them",
      input.read
        ? [
            `How they are: ${input.read.how_they_are}`,
            `What they want: ${input.read.what_they_want}`,
            `What lands: ${input.read.what_lands}`,
          ]
            .map((line) => `- ${line}`)
            .join("\n")
        : null,
    ),
    section("What you remember", memorySection(input.retrieval, input.coreMemories, input.now)),
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

function factList(title: string, facts: RetrievedFact[], now: Date): string | null {
  if (facts.length === 0) return null;

  const lines = facts.map((fact) => {
    const onMind = fact.onMind ? " (on your mind lately)" : "";
    const notes = [fact.share && SHARE[fact.share], fact.origin && ORIGIN[fact.origin]].filter(
      Boolean,
    );
    const tail = notes.length ? ` (${notes.join("; ")})` : "";
    return `- ${fact.content} (${relativeDate(fact.when, now)})${onMind}${tail}`;
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
 * so a user turn after a long gap is marked; without the marker the model carries on from the
 * old moment.
 */
function conversationMessages(input: AssembleInput): ChatMessage[] {
  const window = sinceLongGap(input);
  const leadingReachOuts = window.findIndex((t) => t.trigger !== "reach_out");
  const wroteFirst = leadingReachOuts !== 0 && window.length > 0;
  const firstUser = window.findIndex((t) => t.role === "user");
  const turns = wroteFirst ? window : firstUser === -1 ? [] : window.slice(firstUser);

  const messages: ChatMessage[] = turns.map((turn, i) => {
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
  return wroteFirst ? [{ role: "user", content: WROTE_FIRST }, ...messages] : messages;
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
