/**
 * `core_world_tick`: once per her local day, what happens in her life. Events are generated once
 * for everyone, recorded in her world, appraised into her memory and mood, and every attempt is
 * logged. Generation runs outside the transaction; the apply holds a global lock and re-checks the
 * day, so a retry never doubles a day and a failure writes nothing.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import { generateCoreEvents, type InjectedEvent } from "@/mind/world/events";
import { appraiseEvent } from "./appraise";

export type WorldTickOptions = { inject?: (day: string) => InjectedEvent | null };

const due = (lastDay: string | null, day: string) => !lastDay || lastDay < day;

export async function coreWorldTick(
  deps: CoreDeps,
  now: Date,
  opts: WorldTickOptions = {},
): Promise<"not_due" | "done"> {
  const { core, config } = deps;
  if (lifeHour(config.life, now) < config.core.world.events_local_hour) return "not_due";
  const day = lifeDate(config.life, now);
  await core.state.ensure(config.core.state.baseline);
  if (!due((await core.state.get())?.last_event_day ?? null, day)) return "not_due";

  const { accepted, attempts } = await generateCoreEvents(deps, day, now, opts.inject);

  return core.transaction(async (tx) => {
    await tx.lock("core_world_tick");
    const row = await tx.state.lock();
    if (!due(row.last_event_day, day)) return "not_due" as const;

    const eventIds = new Map<string, string>();
    const episodeIds: string[] = [];
    for (const e of accepted) {
      const agents = await tx.memory.addEntities(
        e.candidate.entity_names,
        config.core.world.entity_salience,
        now,
      );
      const worldEventId = await tx.world.recordEvent({
        at: e.at,
        kind: "planned",
        content: e.candidate.content,
        valence: e.candidate.valence,
        stakes: e.candidate.stakes,
        agents,
        life_day: day,
        created_at: now,
      });
      eventIds.set(e.key, worldEventId);
      episodeIds.push(
        await appraiseEvent(
          tx,
          deps,
          {
            worldEventId,
            content: e.candidate.content,
            valence: e.candidate.valence,
            stakes: e.candidate.stakes,
            at: e.at,
            embedding: e.embedding,
            agents,
          },
          now,
        ),
      );
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
    await tx.state.update({ last_event_day: day });
    await tx.traces.insert({
      loop: "core_world_tick",
      inputs: { day, attempts: attempts.length },
      outputs: { world_events: [...eventIds.values()], episodes: episodeIds },
      model: config.models.life,
      prompt_version: config.prompts.life_event,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      created_at: now,
    });
    return "done" as const;
  });
}
