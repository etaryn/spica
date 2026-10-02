/**
 * `core_world_tick`, every hour: what happens in her life, in two steps.
 *
 * Once per her local day, events are generated once for everyone and recorded in her world. A
 * planned one is on her mind from then on: its people join her entities, its thought becomes an
 * open intention (and a strong one takes over her mind), but her mood waits for the outcome. A
 * spontaneous one leaves nothing in her memory, her people or her state until it happens.
 *
 * Every run, first, each event whose time has come lands with her once: appraisal writes the
 * episode, brings a surprise's people into her life, moves her mood and resolves the plan it
 * fulfils. An event generated after its own time lands on the next run.
 *
 * Model and embedder calls run outside the transactions; each apply holds a global lock and
 * re-checks what it's about to do, so a retry never doubles a day or an event and a failure writes
 * nothing.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import { generateCoreEvents, type InjectedEvent } from "@/mind/world/events";
import { appraiseEvent, eventRef } from "./appraise";

export type WorldTickOptions = { inject?: (day: string) => InjectedEvent | null };
export type WorldTickResult = { generated: boolean; appraised: number };

const LOCK = "core_world_tick";
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
  await core.state.ensure(config.core.state.baseline);
  if (!due((await core.state.get())?.last_event_day ?? null, day)) return false;

  const { accepted, attempts } = await generateCoreEvents(deps, day, now, opts.inject);

  return core.transaction(async (tx) => {
    await tx.lock(LOCK);
    const row = await tx.state.lock();
    if (!due(row.last_event_day, day)) return false;

    const eventIds = new Map<string, string>();
    const intentionIds: string[] = [];
    let preoccupation: string | null = null;
    for (const e of accepted) {
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
        decision: a.decision,
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
    await tx.traces.insert({
      loop: "core_world_tick",
      inputs: { day, attempts: attempts.length },
      outputs: { world_events: [...eventIds.values()], intentions: intentionIds },
      model: config.models.life,
      prompt_version: config.prompts.life_event,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 0,
      status: "done",
      error: null,
      created_at: now,
    });
    return true;
  });
}

/** Lands every event whose time has come. Returns how many landed in this run. */
async function appraiseDue(deps: CoreDeps, now: Date): Promise<number> {
  const { core, config, embedder } = deps;
  const pending = await core.world.dueUnappraised(now);
  if (!pending.length) return 0;
  await core.state.ensure(config.core.state.baseline);
  const vectors = await embedder.embed(
    pending.map((e) => e.content),
    "document",
  );
  const embeddings = new Map(pending.map((e, i) => [e.id, vectors[i]]));

  return core.transaction(async (tx) => {
    await tx.lock(LOCK);
    const episodes: string[] = [];
    const resolved: string[] = [];
    const landed: string[] = [];
    // Re-read under the lock: another run may have landed some of these already.
    for (const event of await tx.world.dueUnappraised(now)) {
      const embedding = embeddings.get(event.id);
      // Became due after the embed (a concurrent generation); the next run takes it.
      if (!embedding) continue;
      const agents = event.agent_names.length
        ? await tx.memory.addEntities(event.agent_names, config.core.world.entity_salience, now)
        : event.agents;
      await tx.world.setAgents(event.id, agents);
      const out = await appraiseEvent(
        tx,
        deps,
        {
          worldEventId: event.id,
          content: event.content,
          valence: event.valence,
          stakes: event.stakes,
          at: event.at,
          embedding,
          agents,
        },
        now,
      );
      landed.push(event.id);
      episodes.push(out.episodeId);
      if (out.intentionId) resolved.push(out.intentionId);
    }
    if (!landed.length) return 0;
    await tx.traces.insert({
      loop: "core_appraise_due",
      inputs: { world_events: landed },
      outputs: { episodes, resolved_intentions: resolved },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 0,
      status: "done",
      error: null,
      created_at: now,
    });
    return landed.length;
  });
}
