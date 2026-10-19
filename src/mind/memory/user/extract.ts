/**
 * Extraction: the cold path's first step. One strict-JSON model call reads a finished exchange and
 * returns candidate memories, the people and things mentioned, thread updates, the relationship
 * signals from how the user treated her and how much they opened up, and how they met her last
 * bid.
 */
import { z } from "zod";
import type { EntityMention } from "@/db/repos/user/entities";
import type { Turn } from "@/db/repos/user/session-log";
import { claimKind, entityType, factKind } from "@/db/schema";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import { formatLocal, isValidTimeZone } from "@/mind/platform/timezone";
import {
  BidResponseSchema,
  IntimacySchema,
  normalizeBid,
  normalizeIntimacy,
  normalizeSignals,
  RelationshipSignalsSchema,
  type BidResponse,
  type Signals,
} from "@/mind/state/user/relationship/signals";
import type { Intimacy } from "@/mind/state/user/relationship/types";
import { clamp } from "@/mind/platform/math";
import {
  IDIOLECT_STARTERS,
  IDIOLECT_TYPES,
  idiolectPayload,
  type IdiolectStarter,
  type IdiolectType,
} from "./idiolect";
import { applyWhen } from "./when";

const subject = z.enum(["user", "self", "shared"]);
// Summaries, reflections and ideas are hers to write after a big event, never read off one exchange.
const extractableKind = z
  .enum(factKind.enumValues)
  .exclude(["summary", "reflection", "idea", "episode", "model", "belief"]);

/**
 * The output format sent to the model. It carries no numeric or length bounds (the model API
 * doesn't support them); values are clamped after parsing instead.
 */
const FactSchema = z.object({
  subject,
  kind: extractableKind,
  content: z.string(),
  occurred_at: z.string().nullable(),
  // The time words as said; code turns them into a date. Fixtures without it read as null.
  when: z.string().nullable().default(null),
  salience: z.number(),
  valence: z.number(),
  confidence: z.number(),
  entity_names: z.array(z.string()),
  thread_title: z.string().nullable(),
  // Required for the model, so it never skips the label; fixtures without it read as null.
  claim_kind: z.enum(claimKind.enumValues).nullable().default(null),
  // Only idiolect facts carry these; fixtures without them read as null.
  idiolect_type: z.enum(IDIOLECT_TYPES).nullable().default(null),
  started_by: z.enum(IDIOLECT_STARTERS).nullable().default(null),
});

export const ExtractionSchema = z.object({
  facts: z.array(FactSchema),
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
      checkpoint_when: z.string().nullable().default(null),
      thread_id: z.string().nullable(),
    }),
  ),
  relationship: RelationshipSignalsSchema.nullable(),
  // Required for the model; fixtures without it read as null.
  intimacy: IntimacySchema.nullable().default(null),
  // Required for the model; fixtures without it read as null.
  bid_response: BidResponseSchema.default(null),
});

type RawExtraction = z.infer<typeof ExtractionSchema>;

export type ExtractedFact = Omit<
  RawExtraction["facts"][number],
  "occurred_at" | "claim_kind" | "idiolect_type" | "started_by" | "when"
> & {
  occurred_at: Date | null;
  /** The time words as said; facts code writes (her hurt) have none. */
  when?: string | null;
  /** Only her own facts carry one; facts code writes (her hurt) leave it out. */
  claim_kind?: RawExtraction["facts"][number]["claim_kind"];
  /** Only idiolect facts carry these. */
  idiolect_type?: IdiolectType | null;
  started_by?: IdiolectStarter | null;
};
export type ExtractedEntity = EntityMention;
export type ExtractedThread = Omit<
  RawExtraction["threads"][number],
  "next_checkpoint" | "checkpoint_when"
> & {
  next_checkpoint: Date | null;
  checkpoint_when?: string | null;
};

export type Extraction = {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  threads: ExtractedThread[];
  relationship: Signals | null;
  intimacy: Intimacy | null;
  bid: BidResponse | null;
};

export type ExtractArgs = {
  newTurns: Turn[];
  contextTurns: Turn[];
  openThreads: { id: string; title: string }[];
  timezone: string | null;
  /** Her snapshot's Interests, so her own film and book titles read right. */
  herInterests?: string[];
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

function idiolectFields(fact: { kind: string; idiolect_type?: unknown; started_by?: unknown }): {
  idiolect_type: IdiolectType | null;
  started_by: IdiolectStarter | null;
} {
  if (fact.kind !== "idiolect") return { idiolect_type: null, started_by: null };
  const payload = idiolectPayload(fact);
  return { idiolect_type: payload.type, started_by: payload.started_by };
}

export function buildExtractionInput(args: ExtractArgs): string {
  const zone = args.timezone && isValidTimeZone(args.timezone) ? args.timezone : "UTC";
  const line = (turn: Turn) => {
    const speaker = turn.role === "user" ? "User" : "Spica";
    return `[${formatLocal(turn.created_at, zone)}] ${speaker}: ${turn.text}`;
  };

  const sections = [`User's timezone: ${zone}`];

  // Her film and book titles read as apps or games without this ("Mirror", "Stalker").
  if (args.herInterests?.length) {
    sections.push(
      `What Spica is into (to read her own words right):\n${args.herInterests.map((i) => `- ${i}`).join("\n")}`,
    );
  }

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
  // Lenient about the relationship, intimacy and bid blocks, unlike the schema sent to the model: a
  // malformed block must never fail the memory write. Their normalisers turn anything invalid
  // into null.
  const raw = ExtractionSchema.extend({
    // An idiolect fact with a bad label falls back rather than failing the whole write.
    facts: z.array(
      FactSchema.extend({
        idiolect_type: z.unknown().optional(),
        started_by: z.unknown().optional(),
      }),
    ),
    relationship: z.unknown().optional(),
    intimacy: z.unknown().optional(),
    bid_response: z.unknown().optional(),
  }).parse(input);

  const facts = raw.facts
    .map((fact) => ({
      ...fact,
      // What is theirs alone is between them, whoever the model credits it to.
      subject: fact.kind === "idiolect" ? ("shared" as const) : fact.subject,
      content: tidy(fact.content),
      occurred_at: parseDate(fact.occurred_at),
      when: fact.when && tidy(fact.when) ? tidy(fact.when) : null,
      salience: clamp(fact.salience, 0, 1),
      valence: clamp(fact.valence, -1, 1),
      confidence: clamp(fact.confidence, 0, 1),
      entity_names: fact.entity_names.map(tidy).filter(Boolean),
      thread_title: fact.thread_title && tidy(fact.thread_title) ? tidy(fact.thread_title) : null,
      // Only her own statements are claims; a mislabelled user or shared fact carries none.
      claim_kind:
        fact.subject === "self" && fact.kind !== "idiolect" ? (fact.claim_kind ?? null) : null,
      ...idiolectFields(fact),
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
      checkpoint_when:
        thread.checkpoint_when && tidy(thread.checkpoint_when)
          ? tidy(thread.checkpoint_when)
          : null,
    }))
    .filter((thread) => thread.title.length > 0);

  return {
    facts,
    entities,
    threads,
    relationship: normalizeSignals(raw.relationship ?? null),
    intimacy: normalizeIntimacy(raw.intimacy ?? null),
    bid: normalizeBid(raw.bid_response),
  };
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
    cache: config.models.extract_cache,
  });

  const zone = args.timezone && isValidTimeZone(args.timezone) ? args.timezone : "UTC";
  // Their own last message dates "tomorrow"; a reach-out exchange falls back to its last turn.
  const ref =
    [...args.newTurns].reverse().find((t) => t.role === "user")?.created_at ??
    args.newTurns.at(-1)?.created_at ??
    null;
  return applyWhen(normalizeExtraction(raw, config.extraction.max_candidates), ref, zone);
}
