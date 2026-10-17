/**
 * Her events, generated once for her whole world, not per user. A candidate is generated from her
 * plan, her recent episodes and the people she knows, checked by rules (how often someone new
 * appears, how often something big happens), and reconciled against her core memory; a duplicate
 * or contradiction is regenerated. A planned event comes with her thought about it now (the plan
 * is on her mind before it happens); a spontaneous one has none, since nobody sees a surprise
 * coming. Read-only: the world tick applies what's accepted.
 */
import { z } from "zod";
import type { LifePlan } from "@/db/schema";
import { reconcileAgainstNeighbours } from "@/mind/memory/shared/reconcile";
import type { Config } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import type { CoreGoal, CoreNeeds } from "@/mind/state/core/types";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { relativeDate } from "@/mind/platform/relative-date";
import { seededUnit } from "@/mind/platform/seeded-random";
import { lifeInstant, lifeTimezone } from "@/mind/world/her-clock";
import { DAY } from "@/mind/platform/time";
import { shiftLocalDate } from "@/mind/platform/timezone";

/** Sent to the model. No numeric bounds (unsupported); `checkEvent` validates and clamps. */
const EventSchema = z.object({
  content: z.string(),
  at: z.string(),
  valence: z.number(),
  stakes: z.enum(["low", "high"]),
  entity_names: z.array(z.string()),
  kind: z.enum(["planned", "spontaneous"]),
  thought: z.string().nullable(),
});
export type EventCandidate = z.infer<typeof EventSchema>;
/** An eval's scripted event: spontaneous with no thought unless it says otherwise. */
export type InjectedEvent = {
  content: string;
  valence: number;
  kind?: EventCandidate["kind"];
  thought?: string | null;
  fallthrough?: boolean;
};
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
  targetMemoryId: string | null;
  source: "model" | "injected";
};
export type AcceptedEvent = {
  key: string;
  candidate: EventCandidate;
  embedding: number[];
  /** The thought's embedding for a planned event; null for a spontaneous one. */
  thoughtEmbedding: number[] | null;
  at: Date;
  goalRef: string | null;
  /** The subject key it was drawn about; null for an injected event. */
  subject: string | null;
  resolvesMemoryId: string | null;
  fallthrough: boolean | null;
};
export type CoreEventContext = {
  plan: LifePlan | null;
  episodes: { content: string; when: Date }[];
  people: string[];
  subject: EventSubject;
  needs: CoreNeeds;
};
export type EventSubject =
  | { kind: "goal"; goal: CoreGoal }
  | { kind: "interest"; id: string; content: string }
  | { kind: "person"; name: string }
  | { kind: "everyday" };
type WorldConfig = Config["core"]["world"];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const normalizeName = (s: string) => tidy(s).toLowerCase();

export function subjectKey(s: EventSubject): string {
  if (s.kind === "goal") return `goal:${s.goal.id}`;
  if (s.kind === "interest") return `interest:${s.id}`;
  if (s.kind === "person") return `person:${s.name}`;
  return "everyday";
}

/**
 * What today's event is about, drawn in code so her days don't narrow to one theme: one of her
 * goals, an interest, someone she knows, or an ordinary thing, by weight, with anything used in
 * the last few days drawn less. Day-stable, and independent of repository order.
 */
export function selectEventSubject(
  options: { goals: CoreGoal[]; interests: { id: string; content: string }[]; people: string[] },
  recentKeys: string[],
  day: string,
  cfg: WorldConfig,
): EventSubject {
  const w = cfg.subject_weights;
  const goals = options.goals
    .filter((goal) => goal.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id));
  // Goals further from done are drawn more, the share of all goals staying w.goal.
  const goalWeights = goals.map((goal) => 1 - goal.progress + cfg.goal_weight_floor);
  const goalTotal = goalWeights.reduce((sum, x) => sum + x, 0);
  const pool: { subject: EventSubject; weight: number }[] = [
    ...goals.map((goal, i) => ({
      subject: { kind: "goal" as const, goal },
      weight: (w.goal * goalWeights[i]!) / goalTotal,
    })),
    ...options.interests.map((it) => ({
      subject: { kind: "interest" as const, id: it.id, content: it.content },
      weight: w.interest / options.interests.length,
    })),
    ...options.people.map((name) => ({
      subject: { kind: "person" as const, name },
      weight: w.person / options.people.length,
    })),
    { subject: { kind: "everyday" as const }, weight: w.everyday },
  ].map((o) => ({
    ...o,
    weight: recentKeys.includes(subjectKey(o.subject))
      ? o.weight * cfg.subject_recent_penalty
      : o.weight,
  }));
  const total = pool.reduce((sum, o) => sum + o.weight, 0);
  let position = seededUnit(`${day}:subject`) * total;
  for (const o of pool) {
    position -= o.weight;
    if (position < 0) return o.subject;
  }
  return { kind: "everyday" };
}

async function coreEventContext(
  deps: CoreDeps,
  day: string,
  now: Date,
  subject: EventSubject,
): Promise<CoreEventContext> {
  const cfg = deps.config.core.world;
  const from = new Date(now.getTime() - cfg.event_context_days * DAY);
  const episodes = await deps.core.memory.recentEpisodes(from, now, cfg.event_context_items);
  const known = (await deps.core.memory.entities()).map((e) => e.name);
  return {
    plan: await deps.core.world.plan(day),
    episodes: episodes.map((e) => ({ content: e.content, when: e.occurred_at ?? e.created_at })),
    people: [...new Set([...cfg.canon_entities, ...known])],
    subject,
    needs: (await deps.core.state.get())?.needs ?? {
      autonomy: deps.config.core.state.needs_baseline,
      competence: deps.config.core.state.needs_baseline,
    },
  };
}

export function buildEventInput(
  ctx: CoreEventContext,
  day: string,
  rejected: { candidate: unknown; reason: string }[],
  now: Date,
  tz: string,
  targetChars: number,
): string {
  const parts = [`Today is ${day} in her zone.`];
  parts.push(
    ctx.plan
      ? `Her plan today:\n${ctx.plan.blocks.map((b) => `- ${b.start}-${b.end} ${b.kind}: ${b.label}`).join("\n")}`
      : "Her plan today: unknown, keep the event generic.",
  );
  parts.push(
    ctx.episodes.length
      ? `What has happened in her life lately (never contradict):\n${ctx.episodes.map((e) => `- ${e.content} (${relativeDate(e.when, now, tz)})`).join("\n")}`
      : "What has happened in her life lately: nothing yet.",
  );
  parts.push(`People she knows: ${ctx.people.join(", ") || "none"}.`);
  parts.push(
    `Current needs: autonomy: ${ctx.needs.autonomy}; competence: ${ctx.needs.competence}.`,
  );
  parts.push(
    ctx.subject.kind === "goal"
      ? `Today's event is about her goal: ${ctx.subject.goal.title}. Why: ${ctx.subject.goal.why}. Progress: ${ctx.subject.goal.progress}. Let it advance or block it.`
      : ctx.subject.kind === "interest"
        ? `Today's event is about something she loves: ${ctx.subject.content}.`
        : ctx.subject.kind === "person"
          ? `Today's event is about: ${ctx.subject.name}. Something happens with them.`
          : "Today's event is about something ordinary, not her goals or usual interests.",
  );
  parts.push(
    `Write the event as one plain sentence, under ${targetChars} characters: what happened, no feelings.`,
  );
  if (rejected.length)
    parts.push(
      `Rejected attempts (write something different):\n${rejected.map((r) => `- ${JSON.stringify(r.candidate)}: ${r.reason}`).join("\n")}`,
    );
  return parts.join("\n\n");
}

export function checkEvent(raw: EventCandidate, maxChars: number): EventCandidate | null {
  const content = tidy(raw.content);
  if (!content || content.length > maxChars || !HHMM.test(raw.at)) return null;
  const thought = raw.kind === "planned" ? tidy(raw.thought ?? "") : null;
  if (thought !== null && (!thought || thought.length > maxChars)) return null;
  const valence = Number.isFinite(raw.valence) ? Math.min(1, Math.max(-1, raw.valence)) : 0;
  return {
    content,
    at: raw.at,
    valence,
    stakes: raw.stakes,
    entity_names: raw.entity_names.map(tidy).filter(Boolean),
    kind: raw.kind,
    thought,
  };
}

/** Code-enforced generator rules. `known` holds normalized names. */
export function checkRules(
  c: EventCandidate,
  ctx: { known: Set<string>; lastNewEntityAt: Date | null; lastHighStakesAt: Date | null },
  now: Date,
  cfg: WorldConfig,
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
  invalid:
    "it wasn't a valid event (one sentence, a time HH:MM between 00:00 and 23:59, and a thought if it's planned)",
  "rule:new_entity": "it introduces a new person too soon; use people she already knows",
  "rule:high_stakes": "it's high-stakes too soon after the last one; keep it small",
  duplicate: "it repeats something that already happened to her",
  contradicts: "it contradicts something that already happened to her",
};

/**
 * Her events for one day: generate → rules → reconcile against her core memory, rejecting
 * duplicates and contradictions and regenerating up to `core.world.regen_attempts` times. The
 * draws depend on the day alone, so every user shares them. An LLM or embed error propagates
 * (the tick retries next hour).
 */
export async function generateCoreEvents(
  deps: CoreDeps,
  day: string,
  now: Date,
  canCall: () => boolean,
  inject?: (day: string) => InjectedEvent | null,
): Promise<{ accepted: AcceptedEvent[]; attempts: EventAttempt[]; budgetExhausted: boolean }> {
  const { config, llm, embedder } = deps;
  const cfg = config.core.world;
  const injected = inject?.(day) ?? null;
  const n = Math.max(cfg.events_per_day_max, injected ? 1 : 0);
  const draws = Array.from(
    { length: n },
    (_, i) => (i === 0 && !!injected) || seededUnit(`${day}:${i}`) < cfg.event_probability,
  );
  const accepted: AcceptedEvent[] = [];
  const attempts: EventAttempt[] = [];
  if (!draws.some(Boolean)) return { accepted, attempts, budgetExhausted: false };

  const subject = selectEventSubject(
    {
      goals: await deps.core.goals.active(),
      interests: (await deps.core.memory.activeByKind("interest", cfg.event_context_items)).map(
        (m) => ({ id: m.id, content: m.content }),
      ),
      people: [
        ...new Set([
          ...cfg.canon_entities,
          ...(await deps.core.memory.entities()).map((e) => e.name),
        ]),
      ],
    },
    await deps.core.world.recentSubjects(shiftLocalDate(day, -cfg.subject_recent_days)),
    day,
    cfg,
  );
  const goal = subject.kind === "goal" ? subject.goal : null;
  const ctx = await coreEventContext(deps, day, now, subject);
  const known = new Set(ctx.people.map(normalizeName));
  let lastNewEntityAt = await deps.core.memory.latestEntityFirstSeen(cfg.canon_entities);
  let lastHighStakesAt = await deps.core.world.lastHighStakesAt();
  // Events are written for who she is lately; before any snapshot exists that's the seed self.
  const persona = loadPersona(config);
  const self = (await deps.core.memory.latestSnapshot())?.content ?? persona.seedSelf;
  const system = [
    persona.coreValues,
    self,
    loadPrompt("life/event", config.prompts.life_event),
  ].join("\n\n");

  for (const [i, kept] of draws.entries()) {
    if (!kept) continue;
    const rejected: { candidate: unknown; reason: string }[] = [];
    for (let attempt = 1; attempt <= 1 + cfg.regen_attempts; attempt++) {
      const key = `${i}:${attempt}`;
      const useInjected = !!injected && i === 0 && attempt === 1;
      if (!useInjected && !canCall()) return { accepted, attempts, budgetExhausted: true };
      const raw: EventCandidate = useInjected
        ? {
            content: injected!.content,
            at: cfg.injected_event_at,
            valence: injected!.valence,
            stakes: "low",
            entity_names: [],
            kind: injected!.kind ?? "spontaneous",
            thought: injected!.thought ?? null,
          }
        : await llm.classifyJson({
            purpose: "life_event",
            model: "life",
            system,
            input: buildEventInput(
              ctx,
              day,
              rejected,
              now,
              lifeTimezone(config.life, now),
              cfg.event_target_chars,
            ),
            schema: EventSchema,
            timeoutMs: config.models.structured_timeout_ms,
            maxTokens: cfg.event_max_tokens,
          });
      const source = useInjected ? ("injected" as const) : ("model" as const);
      const reject = (decision: keyof typeof REASON, targetMemoryId: string | null = null) => {
        attempts.push({ key, attempt, candidate: raw, decision, targetMemoryId, source });
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
      const [embedding] = await embedder.embed([c.content], "document");
      if (!embedding) throw new Error("embedder returned no vector");
      const neighbors = await deps.core.memory.near(
        embedding,
        config.reconcile.neighbor_k,
        config.reconcile.contradiction_similarity,
      );
      if (neighbors.length && !canCall()) return { accepted, attempts, budgetExhausted: true };
      const decision = await reconcileAgainstNeighbours(
        deps,
        { label: "episode", content: c.content },
        neighbors,
      );
      if (decision.relation === "duplicate" || decision.relation === "contradicts") {
        reject(decision.relation, decision.targetId);
        continue;
      }
      attempts.push({
        key,
        attempt,
        candidate: c,
        decision: decision.relation === "resolves" ? "resolves" : "accepted",
        targetMemoryId: decision.targetId,
        source,
      });
      let thoughtEmbedding: number[] | null = null;
      if (c.thought !== null) {
        [thoughtEmbedding = null] = await embedder.embed([c.thought], "document");
        if (!thoughtEmbedding) throw new Error("embedder returned no vector");
      }
      accepted.push({
        key,
        candidate: c,
        embedding,
        thoughtEmbedding,
        at: lifeInstant(config.life, day, c.at),
        goalRef: useInjected ? null : (goal?.id ?? null),
        subject: useInjected ? null : subjectKey(subject),
        resolvesMemoryId: decision.relation === "resolves" ? decision.targetId : null,
        fallthrough: useInjected ? (injected!.fallthrough ?? null) : null,
      });
      if (c.entity_names.some((name) => !known.has(normalizeName(name)))) {
        lastNewEntityAt = now;
        for (const name of c.entity_names) known.add(normalizeName(name));
      }
      if (c.stakes === "high") lastHighStakesAt = now;
      break;
    }
  }
  return { accepted, attempts, budgetExhausted: false };
}
