import { z } from "zod";
import type { EntityMention } from "@/db/repos/entities";
import type { Turn } from "@/db/repos/session-log";
import { entityType, factKind } from "@/db/schema";
import type { Deps } from "../deps";
import { loadPrompt } from "../prompts";
import { normalizeSignals, RelationshipSignalsSchema, type Signals } from "../relationship/signals";
import { formatLocal, isValidTimeZone } from "../timezone";

const subject = z.enum(["user", "self", "shared"]);

/** Sent to the model as the output format. No numeric/length bounds (unsupported); clamped after parsing. */
export const ExtractionSchema = z.object({
  facts: z.array(z.object({
    subject, kind: z.enum(factKind.enumValues), content: z.string(), occurred_at: z.string().nullable(),
    salience: z.number(), valence: z.number(), confidence: z.number(),
    entity_names: z.array(z.string()), thread_title: z.string().nullable(),
  })),
  entities: z.array(z.object({
    name: z.string(), aliases: z.array(z.string()), type: z.enum(entityType.enumValues),
    subject: z.enum(["user", "self"]), relation: z.string().nullable(),
  })),
  threads: z.array(z.object({
    action: z.enum(["open", "touch", "resolve"]), title: z.string(), subject,
    stakes: z.enum(["low", "med", "high"]), next_checkpoint: z.string().nullable(), thread_id: z.string().nullable(),
  })),
  relationship: RelationshipSignalsSchema.nullable(),
});

type Raw = z.infer<typeof ExtractionSchema>;
export type ExtractedFact = Omit<Raw["facts"][number], "occurred_at"> & { occurred_at: Date | null };
export type ExtractedEntity = EntityMention;
export type ExtractedThread = Omit<Raw["threads"][number], "next_checkpoint"> & { next_checkpoint: Date | null };
export type Extraction = { facts: ExtractedFact[]; entities: ExtractedEntity[]; threads: ExtractedThread[]; relationship: Signals | null };
export type ExtractArgs = { newTurns: Turn[]; contextTurns: Turn[]; openThreads: { id: string; title: string }[]; timezone: string | null };

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildExtractionInput(a: ExtractArgs): string {
  const zone = a.timezone && isValidTimeZone(a.timezone) ? a.timezone : "UTC";
  const line = (t: Turn) => `[${formatLocal(t.created_at, zone)}] ${t.role === "user" ? "User" : "Spica"}: ${t.text}`;
  const parts = [`User's timezone: ${zone}`];
  parts.push(a.openThreads.length
    ? `Open threads (id | title):\n${a.openThreads.map((t) => `- ${t.id} | ${t.title}`).join("\n")}`
    : "Open threads: none");
  if (a.contextTurns.length) parts.push(`Earlier conversation (context only, do not extract from it):\n${a.contextTurns.map(line).join("\n")}`);
  parts.push(`New exchange (extract from this):\n${a.newTurns.map(line).join("\n")}`);
  return parts.join("\n\n");
}

/**
 * Validates (so callers can pass either an already-typed `Raw` value or the
 * model's raw JSON) then clamps numbers, parses dates and drops empties.
 */
export function normalizeExtraction(input: unknown, maxCandidates: number): Extraction {
  const raw = ExtractionSchema.extend({ relationship: RelationshipSignalsSchema.nullable().optional() }).parse(input);
  const facts = raw.facts
    .map((f) => ({
      ...f, content: tidy(f.content), occurred_at: parseDate(f.occurred_at),
      salience: clamp(f.salience, 0, 1), valence: clamp(f.valence, -1, 1), confidence: clamp(f.confidence, 0, 1),
      entity_names: f.entity_names.map(tidy).filter(Boolean),
      thread_title: f.thread_title && tidy(f.thread_title) ? tidy(f.thread_title) : null,
    }))
    .filter((f) => f.content.length > 0)
    .slice(0, maxCandidates);
  const entities = raw.entities
    .map((e) => ({ ...e, name: tidy(e.name), aliases: e.aliases.map(tidy).filter(Boolean) }))
    .filter((e) => e.name.length > 0);
  const threads = raw.threads
    .map((t) => ({ ...t, title: tidy(t.title), next_checkpoint: parseDate(t.next_checkpoint) }))
    .filter((t) => t.title.length > 0);
  return { facts, entities, threads, relationship: normalizeSignals(raw.relationship ?? null) };
}

/** Cold-path step 3 (v2 §6.3): strict-JSON extraction on the extract model. */
export async function extract(deps: Pick<Deps, "llm" | "config">, a: ExtractArgs): Promise<Extraction> {
  const { config } = deps;
  const raw = await deps.llm.classifyJson({
    purpose: "extract",
    model: "extract",
    system: loadPrompt("extract", config.prompts.extract),
    input: buildExtractionInput(a),
    schema: ExtractionSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.models.extract_max_tokens,
  });
  return normalizeExtraction(raw, config.extraction.max_candidates);
}
