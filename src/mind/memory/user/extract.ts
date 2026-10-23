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
import type { Logger } from "@/mind/platform/log";
import { anchorTimes, isSingleToken, tokenDates } from "@/mind/platform/time-anchors";
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
  // Which way the fact's time words point; code dates them. Fixtures without it read as null.
  when_direction: z.enum(["past", "upcoming"]).nullable().default(null),
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
  "claim_kind" | "idiolect_type" | "started_by" | "when_direction"
> & {
  occurred_at: Date | null;
  /** Facts code writes (her hurt) have none. */
  when_direction?: "past" | "upcoming" | null;
  /** Only her own facts carry one; facts code writes (her hurt) leave it out. */
  claim_kind?: RawExtraction["facts"][number]["claim_kind"];
  /** Only idiolect facts carry these. */
  idiolect_type?: IdiolectType | null;
  started_by?: IdiolectStarter | null;
};
export type ExtractedEntity = EntityMention;
export type ExtractedThread = Omit<RawExtraction["threads"][number], "checkpoint_when"> & {
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
 * Validates the model's output (or an already-typed value), then clamps numbers and drops empty
 * entries. Dates come later, from the messages' own times.
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
      occurred_at: null,
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
      next_checkpoint: null,
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

const WEEKDAY_WORD = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const weekdaysIn = (text: string) =>
  new Set([...text.matchAll(WEEKDAY_WORD)].map((m) => m[1]!.toLowerCase()));

/**
 * Dates each fact from the moment its message was sent, in their zone, pointing the way extract
 * labelled it; the model never works out a date. When their message names exactly one weekday and
 * a fact names a different one, the fact takes theirs: a copied weekday ("friday" for their
 * "thursday"), corrected by name so a right past date is never moved.
 */
export function anchorExtraction(
  extraction: Extraction,
  turns: { role: string; text: string; created_at: Date }[],
  zone: string,
  log?: Logger,
): Extraction {
  const said = turns.filter((t) => t.role === "user");
  // A reach-out exchange has no message of theirs; its own last turn dates it.
  const at = said.at(-1)?.created_at ?? turns.at(-1)?.created_at ?? new Date(0);
  const theirs = weekdaysIn(said.map((t) => t.text).join(" "));
  const facts = extraction.facts.map((f) => {
    let content = f.content;
    const own = weekdaysIn(content);
    if (theirs.size === 1 && own.size === 1 && !theirs.has([...own][0]!)) {
      const [from, to] = [[...own][0]!, [...theirs][0]!];
      log?.info("extract weekday taken from their message", { from, to });
      content = content.replace(
        new RegExp(`\\b${from}\\b`, "i"),
        to[0]!.toUpperCase() + to.slice(1),
      );
    }
    content = anchorTimes(content, { at, zone, direction: f.when_direction ?? null });
    return { ...f, content, occurred_at: tokenDates(content)[0] ?? null };
  });
  const threads = extraction.threads.map((t) => {
    const slot = t.checkpoint_when
      ? anchorTimes(t.checkpoint_when, { at, zone, direction: "upcoming" })
      : null;
    return { ...t, next_checkpoint: slot && isSingleToken(slot) ? tokenDates(slot)[0]! : null };
  });
  return { ...extraction, facts, threads };
}

export async function extract(
  deps: Pick<Deps, "llm" | "config" | "log">,
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
  return anchorExtraction(
    normalizeExtraction(raw, config.extraction.max_candidates),
    args.newTurns,
    zone,
    deps.log,
  );
}
