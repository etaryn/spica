/**
 * Extraction: the cold path's first step. One strict-JSON model call reads a finished exchange and
 * returns candidate memories, the people and things mentioned, thread updates, and the
 * relationship signals from how the user treated her.
 */
import { z } from "zod";
import type { EntityMention } from "@/db/repos/user/entities";
import type { Turn } from "@/db/repos/user/session-log";
import { claimKind, entityType, factKind } from "@/db/schema";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import { formatLocal, isValidTimeZone } from "@/mind/platform/timezone";
import {
  normalizeSignals,
  RelationshipSignalsSchema,
  type Signals,
} from "@/mind/state/user/relationship/signals";
import { clamp } from "@/mind/platform/math";

const subject = z.enum(["user", "self", "shared"]);
// Summaries, reflections and ideas are hers to write after a big event, never read off one exchange.
const extractableKind = z.enum(factKind.enumValues).exclude(["summary", "reflection", "idea"]);

/**
 * The output format sent to the model. It carries no numeric or length bounds (the model API
 * doesn't support them); values are clamped after parsing instead.
 */
export const ExtractionSchema = z.object({
  facts: z.array(
    z.object({
      subject,
      kind: extractableKind,
      content: z.string(),
      occurred_at: z.string().nullable(),
      salience: z.number(),
      valence: z.number(),
      confidence: z.number(),
      entity_names: z.array(z.string()),
      thread_title: z.string().nullable(),
      // Required for the model, so it never skips the label; fixtures without it read as null.
      claim_kind: z.enum(claimKind.enumValues).nullable().default(null),
    }),
  ),
  entities: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()),
      type: z.enum(entityType.enumValues),
      subject: z.enum(["user", "self"]),
      relation: z.string().nullable(),
    }),
  ),
  threads: z.array(
    z.object({
      action: z.enum(["open", "touch", "resolve"]),
      title: z.string(),
      subject,
      stakes: z.enum(["low", "med", "high"]),
      next_checkpoint: z.string().nullable(),
      thread_id: z.string().nullable(),
    }),
  ),
  relationship: RelationshipSignalsSchema.nullable(),
});

type RawExtraction = z.infer<typeof ExtractionSchema>;

export type ExtractedFact = Omit<RawExtraction["facts"][number], "occurred_at" | "claim_kind"> & {
  occurred_at: Date | null;
  /** Only her own facts carry one; facts code writes (her hurt) leave it out. */
  claim_kind?: RawExtraction["facts"][number]["claim_kind"];
};
export type ExtractedEntity = EntityMention;
export type ExtractedThread = Omit<RawExtraction["threads"][number], "next_checkpoint"> & {
  next_checkpoint: Date | null;
};

export type Extraction = {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  threads: ExtractedThread[];
  relationship: Signals | null;
};

export type ExtractArgs = {
  newTurns: Turn[];
  contextTurns: Turn[];
  openThreads: { id: string; title: string }[];
  timezone: string | null;
};

/** Clamps into [low, high]; anything not finite becomes `low`. */
function tidy(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function parseDate(text: string | null): Date | null {
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildExtractionInput(args: ExtractArgs): string {
  const zone = args.timezone && isValidTimeZone(args.timezone) ? args.timezone : "UTC";
  const line = (turn: Turn) => {
    const speaker = turn.role === "user" ? "User" : "Spica";
    return `[${formatLocal(turn.created_at, zone)}] ${speaker}: ${turn.text}`;
  };

  const sections = [`User's timezone: ${zone}`];

  sections.push(
    args.openThreads.length
      ? `Open threads (id | title):\n${args.openThreads.map((t) => `- ${t.id} | ${t.title}`).join("\n")}`
      : "Open threads: none",
  );

  if (args.contextTurns.length) {
    sections.push(
      `Earlier conversation (context only, do not extract from it):\n${args.contextTurns.map(line).join("\n")}`,
    );
  }

  sections.push(`New exchange (extract from this):\n${args.newTurns.map(line).join("\n")}`);
  return sections.join("\n\n");
}

/**
 * Validates the model's output (or an already-typed value), then clamps numbers, parses dates
 * and drops empty entries.
 */
export function normalizeExtraction(input: unknown, maxCandidates: number): Extraction {
  // Lenient about the relationship block, unlike the schema sent to the model: a malformed block
  // must never fail the memory write. normalizeSignals turns anything invalid into null.
  const raw = ExtractionSchema.extend({ relationship: z.unknown().optional() }).parse(input);

  const facts = raw.facts
    .map((fact) => ({
      ...fact,
      content: tidy(fact.content),
      occurred_at: parseDate(fact.occurred_at),
      salience: clamp(fact.salience, 0, 1),
      valence: clamp(fact.valence, -1, 1),
      confidence: clamp(fact.confidence, 0, 1),
      entity_names: fact.entity_names.map(tidy).filter(Boolean),
      thread_title: fact.thread_title && tidy(fact.thread_title) ? tidy(fact.thread_title) : null,
      // Only her own statements are claims; a mislabelled user or shared fact carries none.
      claim_kind: fact.subject === "self" ? (fact.claim_kind ?? null) : null,
    }))
    .filter((fact) => fact.content.length > 0)
    .slice(0, maxCandidates);

  const entities = raw.entities
    .map((entity) => ({
      ...entity,
      name: tidy(entity.name),
      aliases: entity.aliases.map(tidy).filter(Boolean),
    }))
    .filter((entity) => entity.name.length > 0);

  const threads = raw.threads
    .map((thread) => ({
      ...thread,
      title: tidy(thread.title),
      next_checkpoint: parseDate(thread.next_checkpoint),
    }))
    .filter((thread) => thread.title.length > 0);

  return { facts, entities, threads, relationship: normalizeSignals(raw.relationship ?? null) };
}

export async function extract(
  deps: Pick<Deps, "llm" | "config">,
  args: ExtractArgs,
): Promise<Extraction> {
  const { config } = deps;

  const raw = await deps.llm.classifyJson({
    purpose: "extract",
    model: "extract",
    system: loadPrompt("extract", config.prompts.extract),
    input: buildExtractionInput(args),
    schema: ExtractionSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.models.extract_max_tokens,
  });

  return normalizeExtraction(raw, config.extraction.max_candidates);
}
