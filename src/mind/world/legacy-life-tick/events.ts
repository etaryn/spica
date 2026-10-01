import { z } from "zod";
import {
  latestSelfEntityFirstSeen,
  listSelfEntityNames,
  normalizeName,
} from "@/db/repos/user/entities";
import { listRecentSelfFacts, nearFacts } from "@/db/repos/user/facts";
import { lastAcceptedHighStakes } from "@/db/repos/user/life-event-log";
import type { LifePlan } from "@/db/schema";
import type { LifeConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { relativeDate } from "@/mind/platform/relative-date";
import type { ExtractedFact } from "@/mind/memory/user/extract";
import { reconcileAgainstNeighbours, type Decision } from "@/mind/memory/shared/reconcile";
import { loadPrompt } from "@/mind/platform/prompts";
import { seededUnit } from "@/mind/platform/seeded-random";
import { lifeInstant } from "@/mind/world/her-clock";

/** Sent to the model. No numeric bounds (unsupported); `checkEvent` validates and clamps. */
export const EventSchema = z.object({
  content: z.string(),
  at: z.string(),
  valence: z.number(),
  stakes: z.enum(["low", "high"]),
  entity_names: z.array(z.string()),
});
export type EventCandidate = z.infer<typeof EventSchema>;
export type InjectedEvent = { content: string; valence: number };
export type EventDecision =
  | "accepted"
  | "resolves"
  | "duplicate"
  | "contradicts"
  | "rule:new_entity"
  | "rule:high_stakes"
  | "invalid";
export type EventAttempt = {
  key: string;
  attempt: number;
  candidate: unknown;
  decision: EventDecision;
  targetFactId: string | null;
  source: "model" | "injected";
};
export type AcceptedEvent = {
  key: string;
  candidate: EventCandidate;
  fact: ExtractedFact;
  embedding: number[];
  decision: Decision;
  newEntity: boolean;
};
export type LifeContext = {
  plan: LifePlan | null;
  selfFacts: { content: string; when: Date }[];
  selfEntities: string[];
};

const DAY = 86_400_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * What the event generator sees for one user's day. This is the future-plans seam:
 * later, her stated plans for `day` (self facts with `occurred_at` on it) join this context.
 */
export async function lifeContext(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  _day: string,
  plan: LifePlan | null,
): Promise<LifeContext> {
  const names = await listSelfEntityNames(deps.db, userId);
  return {
    plan,
    selfFacts: await listRecentSelfFacts(deps.db, userId, deps.config.life.event_context_facts),
    selfEntities: [...new Set([...deps.config.life.canon_entities, ...names])],
  };
}

export function buildEventInput(
  ctx: LifeContext,
  day: string,
  rejected: { candidate: unknown; reason: string }[],
  now: Date,
): string {
  const parts = [`Today is ${day} in her zone.`];
  parts.push(
    ctx.plan
      ? `Her plan today:\n${ctx.plan.blocks.map((b) => `- ${b.start}-${b.end} ${b.kind}: ${b.label}`).join("\n")}`
      : "Her plan today: unknown, keep the event generic.",
  );
  parts.push(
    ctx.selfFacts.length
      ? `What she has already said or done with this friend (never contradict):\n${ctx.selfFacts.map((f) => `- ${f.content} (${relativeDate(f.when, now)})`).join("\n")}`
      : "What she has already said or done with this friend: nothing yet.",
  );
  parts.push(`People she knows: ${ctx.selfEntities.join(", ") || "none"}.`);
  if (rejected.length)
    parts.push(
      `Rejected attempts (write something different):\n${rejected.map((r) => `- ${JSON.stringify(r.candidate)}: ${r.reason}`).join("\n")}`,
    );
  return parts.join("\n\n");
}

export function checkEvent(raw: EventCandidate, maxChars: number): EventCandidate | null {
  const content = tidy(raw.content);
  if (!content || content.length > maxChars || !HHMM.test(raw.at)) return null;
  const valence = Number.isFinite(raw.valence) ? Math.min(1, Math.max(-1, raw.valence)) : 0;
  return {
    content,
    at: raw.at,
    valence,
    stakes: raw.stakes,
    entity_names: raw.entity_names.map(tidy).filter(Boolean),
  };
}

/** Code-enforced generator rules. `known` holds normalized names. */
export function checkRules(
  c: EventCandidate,
  ctx: { known: Set<string>; lastNewEntityAt: Date | null; lastHighStakesAt: Date | null },
  now: Date,
  cfg: LifeConfig,
): "rule:new_entity" | "rule:high_stakes" | null {
  const unknown = c.entity_names.filter((n) => !ctx.known.has(normalizeName(n)));
  const within = (d: Date | null, days: number) => !!d && now.getTime() - d.getTime() < days * DAY;
  if (
    unknown.length > 1 ||
    (unknown.length === 1 && within(ctx.lastNewEntityAt, cfg.new_entity_days))
  )
    return "rule:new_entity";
  if (c.stakes === "high" && within(ctx.lastHighStakesAt, cfg.high_stakes_min_days))
    return "rule:high_stakes";
  return null;
}

const REASON: Record<Exclude<EventDecision, "accepted" | "resolves">, string> = {
  invalid: "it wasn't a valid event (one sentence, a time HH:MM between 00:00 and 23:59)",
  "rule:new_entity": "it introduces a new person too soon; use people she already knows",
  "rule:high_stakes": "it's high-stakes too soon after the last one; keep it small",
  duplicate: "it repeats something she already did or said",
  contradicts: "it contradicts something she already said",
};

/**
 * Personal events for one user's day: generate → rules → reconcile (the cold path's `reconcileAgainstNeighbours`),
 * rejecting duplicates and contradictions and regenerating up to `life.regen_attempts` times. Read-only: the
 * caller applies the accepted events. An LLM or embed error propagates (the user's tick is retried next hour).
 */
export async function generateEvents(
  deps: Deps,
  userId: string,
  day: string,
  plan: LifePlan | null,
  now: Date,
  inject?: (userId: string, day: string) => InjectedEvent | null,
): Promise<{ accepted: AcceptedEvent[]; attempts: EventAttempt[] }> {
  const { db, config, llm, embedder } = deps;
  const cfg = config.life;
  const injected = inject?.(userId, day) ?? null;
  const n = Math.max(cfg.events_per_day_max, injected ? 1 : 0);
  const draws = Array.from(
    { length: n },
    (_, i) =>
      (i === 0 && !!injected) || seededUnit(`${userId}:${day}:${i}`) < cfg.event_probability,
  );
  const accepted: AcceptedEvent[] = [];
  const attempts: EventAttempt[] = [];
  if (!draws.some(Boolean)) return { accepted, attempts };

  const ctx = await lifeContext(deps, userId, day, plan);
  const known = new Set(ctx.selfEntities.map(normalizeName));
  let lastNewEntityAt = await latestSelfEntityFirstSeen(db, userId);
  let lastHighStakesAt = await lastAcceptedHighStakes(db, userId);
  const system = `${loadPrompt("persona", config.prompts.persona)}\n\n${loadPrompt("life/event", config.prompts.life_event)}`;

  for (const [i, kept] of draws.entries()) {
    if (!kept) continue;
    const rejected: { candidate: unknown; reason: string }[] = [];
    for (let attempt = 1; attempt <= 1 + cfg.regen_attempts; attempt++) {
      const key = `${i}:${attempt}`;
      const useInjected = !!injected && i === 0 && attempt === 1;
      const raw: EventCandidate = useInjected
        ? {
            content: injected!.content,
            at: cfg.injected_event_at,
            valence: injected!.valence,
            stakes: "low",
            entity_names: [],
          }
        : await llm.classifyJson({
            purpose: "life_event",
            model: "life",
            system,
            input: buildEventInput(ctx, day, rejected, now),
            schema: EventSchema,
            timeoutMs: config.models.structured_timeout_ms,
            maxTokens: cfg.event_max_tokens,
          });
      const source = useInjected ? ("injected" as const) : ("model" as const);
      const reject = (decision: keyof typeof REASON, targetFactId: string | null = null) => {
        attempts.push({ key, attempt, candidate: raw, decision, targetFactId, source });
        rejected.push({ candidate: raw, reason: REASON[decision] });
      };
      const c = checkEvent(raw, cfg.event_max_chars);
      if (!c) {
        reject("invalid");
        continue;
      }
      const rule = checkRules(c, { known, lastNewEntityAt, lastHighStakesAt }, now, cfg);
      if (rule) {
        reject(rule);
        continue;
      }
      const fact: ExtractedFact = {
        subject: "self",
        kind: "event",
        content: c.content,
        occurred_at: lifeInstant(cfg, day, c.at),
        salience: cfg.event_salience,
        valence: c.valence,
        confidence: cfg.event_confidence,
        entity_names: c.entity_names,
        thread_title: c.stakes === "high" ? c.content : null,
      };
      const [embedding] = await embedder.embed([c.content], "document");
      if (!embedding) throw new Error("embedder returned no vector");
      const neighbors = await nearFacts(
        db,
        userId,
        "self",
        embedding,
        config.reconcile.neighbor_k,
        config.reconcile.near_match_similarity,
      );
      const decision = await reconcileAgainstNeighbours(
        deps,
        { label: `${fact.subject}, ${fact.kind}`, content: fact.content },
        neighbors,
      );
      if (decision.relation === "duplicate" || decision.relation === "contradicts") {
        reject(decision.relation, decision.targetId);
        continue;
      }
      const newEntity = c.entity_names.some((name) => !known.has(normalizeName(name)));
      attempts.push({
        key,
        attempt,
        candidate: c,
        decision: decision.relation === "resolves" ? "resolves" : "accepted",
        targetFactId: decision.targetId,
        source,
      });
      accepted.push({ key, candidate: c, fact, embedding, decision, newEntity });
      if (newEntity) {
        lastNewEntityAt = now;
        for (const name of c.entity_names) known.add(normalizeName(name));
      }
      if (c.stakes === "high") lastHighStakesAt = now;
      break;
    }
  }
  return { accepted, attempts };
}
