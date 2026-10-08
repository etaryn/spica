/**
 * `core_world_tick`, every hour: what happens in her life, in two steps.
 *
 * Once per her local day, events are generated once for everyone and recorded in her world. A
 * planned one is on her mind from then on: its people join her entities, its thought becomes an
 * open intention (and a strong one takes over her mind), but her mood waits for the outcome. A
 * spontaneous one leaves nothing in her memory, her people or her state until it happens.
 *
 * Every run, first, each event whose time has come lands with her once: appraisal writes the
 * appraisal (a budgeted model call, with a code fallback) writes the episode in its own words,
 * brings a surprise's people into her life, moves her mood and resolves the plan it
 * fulfils. An event generated after its own time lands on the next run.
 *
 * Model and embedder calls run outside the transactions; each apply holds a global lock and
 * re-checks what it's about to do, so a retry never doubles a day or an event and a failure writes
 * nothing. Event generation is one budgeted `life_event` run; over budget the day passes with no
 * event.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { baselineNeeds } from "@/mind/state/core/core-state";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import {
  generateCoreEvents,
  type AcceptedEvent,
  type EventAttempt,
  type InjectedEvent,
} from "@/mind/world/events";
import {
  applyAppraisal,
  eventRef,
  proposeAppraisal,
  type Appraisal,
  type LandingEvent,
} from "./appraise";
import type { WorldEventRow } from "@/mind/world/types";
import { seededUnit } from "@/mind/platform/seeded-random";
import { proposeResolution, type ResolutionProposal } from "./resolve";
import { BudgetSpentError, runCoreLoop } from "./runner";
import { WORLD_LOCK } from "./thoughts";

export type WorldTickOptions = { inject?: (day: string) => InjectedEvent | null };
export type WorldTickResult = { generated: boolean; appraised: number };

const due = (lastDay: string | null, day: string) => !lastDay || lastDay < day;

export async function coreWorldTick(
  deps: CoreDeps,
  now: Date,
  opts: WorldTickOptions = {},
): Promise<WorldTickResult> {
  // Landing first means what happened overnight is in her recent life when today is generated.
  // Each step runs even if the other fails, so one broken step can't stall the other.
  let appraised = 0;
  let appraisalFailure: { error: unknown } | null = null;
  try {
    appraised = await appraiseDue(deps, now);
  } catch (error) {
    appraisalFailure = { error };
  }
  let generated = false;
  try {
    generated = await generateIfDue(deps, now, opts);
  } catch (error) {
    if (!appraisalFailure) throw error;
    deps.log.error("core world tick generation failed", { error: errorName(error) });
  }
  if (appraisalFailure) throw appraisalFailure.error;
  return { generated, appraised };
}

async function generateIfDue(deps: CoreDeps, now: Date, opts: WorldTickOptions): Promise<boolean> {
  const { core, config } = deps;
  if (lifeHour(config.life, now) < config.core.world.events_local_hour) return false;
  const day = lifeDate(config.life, now);
  await core.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));
  if (!due((await core.state.get())?.last_event_day ?? null, day)) return false;

  const run = await runCoreLoop(deps, "life_event", now, async (ctx) => {
    // Over budget the day still counts as done, so later runs don't spend past the budget.
    const overBudget = async () => {
      const out = await applyDay(ctx.deps, day, now, [], []);
      return { status: "fallback" as const, inputs: { day }, outputs: out };
    };
    if (!ctx.canCall()) return overBudget();
    let generated;
    try {
      generated = await generateCoreEvents(ctx.deps, day, now, ctx.canCall, opts.inject);
    } catch (error) {
      if (error instanceof BudgetSpentError) return overBudget();
      throw error;
    }
    const { accepted, attempts, budgetExhausted } = generated;
    const out = await applyDay(ctx.deps, day, now, accepted, attempts);
    return {
      ...(budgetExhausted ? { status: "fallback" as const } : {}),
      inputs: { day, attempts: attempts.length },
      outputs: out,
      promptVersion: config.prompts.life_event,
    };
  });
  return run.outputs?.applied ?? false;
}

type DayApplied = { applied: boolean; world_events: string[]; intentions: string[] };

async function applyDay(
  deps: CoreDeps,
  day: string,
  now: Date,
  accepted: AcceptedEvent[],
  attempts: EventAttempt[],
): Promise<DayApplied> {
  const { core, config } = deps;
  return core.transaction(async (tx) => {
    await tx.lock(WORLD_LOCK);
    const row = await tx.state.lock();
    if (!due(row.last_event_day, day)) return { applied: false, world_events: [], intentions: [] };

    const eventIds = new Map<string, string>();
    const staleGoalKeys = new Set<string>();
    const intentionIds: string[] = [];
    let preoccupation: string | null = null;
    for (const e of accepted) {
      // The goal may have completed while the model was generating this event.
      if (e.goalRef && (await tx.goals.get(e.goalRef))?.status !== "active") {
        staleGoalKeys.add(e.key);
        continue;
      }
      const c = e.candidate;
      // A plan's people are known now; a surprise's people don't exist for her until it happens.
      const agents =
        c.kind === "planned"
          ? await tx.memory.addEntities(c.entity_names, config.core.world.entity_salience, now)
          : [];
      const worldEventId = await tx.world.recordEvent({
        at: e.at,
        kind: c.kind === "planned" ? "planned" : "surprise",
        content: c.content,
        valence: c.valence,
        stakes: c.stakes,
        agents,
        agent_names: c.entity_names,
        goal_ref: e.goalRef,
        resolves_memory_id: e.resolvesMemoryId,
        fallthrough: e.fallthrough,
        life_day: day,
        created_at: now,
      });
      eventIds.set(e.key, worldEventId);
      if (c.kind !== "planned" || c.thought === null || !e.thoughtEmbedding) continue;
      const intentionId = await tx.memory.insert({
        kind: "intention",
        content: c.thought,
        payload: { event_at: e.at.toISOString() },
        embedding: e.thoughtEmbedding,
        entity_refs: agents,
        occurred_at: now,
        created_at: now,
        status: "open",
        salience: config.core.world.event_salience,
        valence: c.valence,
        confidence: config.core.world.event_confidence,
        source: "world",
        source_ref: eventRef(worldEventId),
      });
      intentionIds.push(intentionId);
      if (Math.abs(c.valence) >= config.core.state.preoccupation_min_valence)
        preoccupation = intentionId;
    }

    await tx.world.logEventAttempts(
      attempts.map((a) => ({
        life_day: day,
        attempt: a.attempt,
        candidate: { ...(a.candidate as object), source: a.source },
        decision: staleGoalKeys.has(a.key) ? "stale_goal" : a.decision,
        target_memory_id: a.targetMemoryId,
        world_event_id: eventIds.get(a.key) ?? null,
        model: a.source === "model" ? config.models.life : "injected",
        prompt_version: a.source === "model" ? config.prompts.life_event : "injected",
        created_at: now,
      })),
    );
    await tx.state.update({
      last_event_day: day,
      // Anticipation moves her mind now; her mood waits for the outcome.
      ...(preoccupation ? { preoccupation, preoccupation_since: now } : {}),
    });
    return { applied: true, world_events: [...eventIds.values()], intentions: intentionIds };
  });
}

/** Lands every event whose time has come. Returns how many landed in this run. */
async function appraiseDue(deps: CoreDeps, now: Date): Promise<number> {
  const { core, config } = deps;
  const pending = await core.world.dueUnappraised(now);
  if (!pending.length) return 0;
  await core.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));
  const resolutions = new Map<string, ResolutionProposal>();
  for (const event of pending) {
    if (event.kind !== "planned" || event.outcome !== null) continue;
    const fallsThrough =
      event.fallthrough ??
      seededUnit(`${event.id}:fallthrough`) < config.core.world.fallthrough_probability;
    if (!fallsThrough) continue;
    let proposal: ResolutionProposal | null = null;
    const run = await runCoreLoop(deps, "core_resolve", now, async (ctx) => {
      proposal = await proposeResolution(ctx, event);
      return {
        status: proposal ? "done" : "fallback",
        inputs: { world_event: event.id },
        outputs: { proposed: proposal !== null },
        promptVersion: config.prompts.core_resolve,
      };
    });
    if (run.status === "done" && proposal) resolutions.set(event.id, proposal);
  }
  const run = await runCoreLoop(deps, "core_appraise", now, async (ctx) => {
    // Model and embedder calls run before the transaction; the apply re-checks under the lock.
    const proposals = new Map<string, Appraisal>();
    for (const e of pending)
      proposals.set(e.id, await proposeAppraisal(ctx, landing(e, resolutions.get(e.id))));
    const vectors = await ctx.deps.embedder.embed(
      [...proposals.values()].map((a) => a.episode),
      "document",
    );
    const out = await core.transaction(async (tx) => {
      await tx.lock(WORLD_LOCK);
      const landed: string[] = [];
      const episodes: string[] = [];
      const resolved: string[] = [];
      // Re-read under the lock: another run may have landed some of these already.
      for (const event of await tx.world.dueUnappraised(now)) {
        const prepared = pending.find((p) => p.id === event.id);
        if (!prepared || prepared.outcome !== event.outcome) continue;
        const appraisal = proposals.get(event.id);
        const embedding = vectors[pending.findIndex((p) => p.id === event.id)];
        // Became due after the proposals (a concurrent generation); the next run takes it.
        if (!appraisal || !embedding) continue;
        const resolution = resolutions.get(event.id);
        const agents = event.agent_names.length
          ? await tx.memory.addEntities(event.agent_names, config.core.world.entity_salience, now)
          : event.agents;
        let landedEvent = landing(event, resolution);
        if (resolution) {
          const replacementId = await tx.world.recordEvent({
            at: event.at,
            kind: "resolution",
            content: resolution.content,
            valence: resolution.valence,
            stakes: resolution.stakes,
            agents,
            agent_names: event.agent_names,
            life_day: event.life_day,
            created_at: now,
            plan_ref: event.id,
            goal_ref: event.goal_ref,
            resolves_memory_id: event.resolves_memory_id,
          });
          landedEvent = { ...landedEvent, worldEventId: replacementId };
        } else {
          await tx.world.setAgents(event.id, agents);
        }
        if (event.kind === "planned" && event.outcome === null)
          await tx.world.setOutcome(event.id, resolution ? "fell_through" : "happened");
        const result = await applyAppraisal(
          tx,
          deps,
          { ...landedEvent, agents },
          appraisal,
          embedding,
          now,
        );
        if (resolution) await tx.world.markAppraised(event.id, now);
        landed.push(event.id);
        episodes.push(result.episodeId);
        if (result.intentionId) resolved.push(result.intentionId);
      }
      return { landed, episodes, resolved_intentions: resolved };
    });
    return {
      status: [...proposals.values()].some((a) => a.source === "fallback") ? "fallback" : "done",
      inputs: { world_events: pending.map((e) => e.id) },
      outputs: out,
      promptVersion: config.prompts.core_appraise,
    };
  });
  return run.outputs?.landed.length ?? 0;
}

const landing = (e: WorldEventRow, resolution?: ResolutionProposal): LandingEvent => ({
  worldEventId: e.id,
  kind: resolution ? "resolution" : e.kind,
  content: resolution?.content ?? e.content,
  valence: resolution?.valence ?? e.valence,
  stakes: resolution?.stakes ?? e.stakes,
  at: e.at,
  agents: e.agents,
  goalRef: e.goal_ref,
  intentionEventId: resolution ? e.id : undefined,
  resolvesMemoryId: e.resolves_memory_id,
});
