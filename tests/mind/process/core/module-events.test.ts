/**
 * Her life is announced to modules: each event as it lands (happened or fell through) and each
 * new self snapshot, once; a render that writes no version announces nothing.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));
const PLANNED = "00000000-0000-4000-8000-000000000001";
const SURPRISE = "00000000-0000-4000-8000-000000000002";

function event(id: string, kind: "planned" | "surprise", fallthrough: boolean | null) {
  return {
    id,
    at: at(10),
    kind,
    content: kind === "planned" ? "to collect telescope images." : "a meteor over the harbour.",
    valence: 0.7,
    stakes: "high" as const,
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: at(9),
    fallthrough,
  };
}

test("each landed event is announced once with its outcome", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps(
    { life: { timezone: "UTC" }, core: { world: { events_local_hour: 20 } } },
    [rec.module],
  );
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica saw the observatory close and found another way to study the stars.",
    valence: 0.8,
    stakes: "high",
  });
  await deps.db
    .insert(world_event)
    .values([event(PLANNED, "planned", true), event(SURPRISE, "surprise", null)]);
  const core = coreDepsOf(deps);
  expect((await coreWorldTick(core, at(10))).appraised).toBe(2);
  await coreWorldTick(core, at(10));
  const sorted = rec.of("world.event").sort((a, b) => a.eventId.localeCompare(b.eventId));
  expect(sorted).toEqual([
    { type: "world.event", eventId: PLANNED, outcome: "fell_through" },
    { type: "world.event", eventId: SURPRISE, outcome: "happened" },
  ]);
});

test("a new snapshot version is announced; a render that writes none is not", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const core = coreDepsOf(deps);
  await seedSnapshot(core);
  expect(await coreRenderSnapshot(core, at(9))).toBe("done");
  expect(rec.of("core.snapshot")).toEqual([{ type: "core.snapshot", version: 1 }]);

  deps.llm.handlers.core_render_snapshot = () => {
    throw new Error("model down");
  };
  await coreRenderSnapshot(core, at(10)).catch(() => {});
  expect(rec.of("core.snapshot")).toHaveLength(1);
});
