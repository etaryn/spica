/**
 * Her public self is her values, her public voice, her surface lines and her day as it went;
 * never a deeper line or an event that hasn't happened.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { lifeDate } from "@/mind/world/her-clock";
import { publicPersona } from "@/mind/process/core/public-persona";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("core values, public voice, the fixed lines and the latest snapshot's surface lines only", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await seedSnapshot(deps);
  await deps.core.memory.insertSelfLines([
    { version: 0, text: "PUBLIC-LINE", depth: 1, embedding: vec() },
    { version: 0, text: "PERSONAL-LINE", depth: 2, embedding: vec() },
    { version: 0, text: "INTIMATE-LINE", depth: 3, embedding: vec() },
  ]);
  const self = await publicPersona(deps);
  const persona = loadPersona(deps.config);
  expect(self.coreValues).toBe(persona.coreValues);
  expect(self.publicVoice).toBe(persona.publicVoice);
  expect(self.publicVoice).not.toBeNull();
  expect(self.version).toBe(0);
  const fixed = (await deps.core.memory.selfLines(null)).map((l) => l.text);
  expect(fixed.length).toBeGreaterThan(0);
  for (const text of [...fixed, "PUBLIC-LINE"]) expect(self.lines).toContain(text);
  const deep = (await deps.core.memory.selfLines(0)).filter((l) => l.depth > 1).map((l) => l.text);
  expect(deep).toContain("INTIMATE-LINE");
  for (const text of deep) expect(self.lines).not.toContain(text);
});

test("before any snapshot, only the fixed lines", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const self = await publicPersona(deps);
  expect(self.version).toBeNull();
  expect(self.lines).toEqual((await deps.core.memory.selfLines(null)).map((l) => l.text));
});

test("today: the plan and everything that landed, never what's pending or fell through", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const now = deps.clock.now();
  const date = lifeDate(deps.config.life, now);
  const hour = 60 * 60 * 1000;
  const plan = {
    blocks: [{ start: "09:00", end: "12:00", kind: "busy" as const, busy: 0.5, label: "reading" }],
  };
  await deps.core.world.insertPlan({
    date,
    plan,
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: now,
  });
  // As the world tick leaves them: a landed event is appraised; only a plan carries an outcome.
  const event = async (
    content: string,
    kind: "planned" | "surprise" | "resolution",
    outcome: "happened" | "fell_through" | null,
    landed: boolean,
  ) => {
    const id = await deps.core.world.recordEvent({
      at: new Date(now.getTime() + (landed ? -hour : hour)),
      kind,
      content,
      valence: 0,
      stakes: "low",
      agents: [],
      life_day: date,
      created_at: now,
      outcome,
    });
    if (landed) await deps.core.world.markAppraised(id, now);
  };
  await event("PLAN-HAPPENED", "planned", "happened", true);
  await event("SURPRISE", "surprise", null, true);
  await event("FELL-THROUGH", "planned", "fell_through", true);
  await event("INSTEAD", "resolution", null, true);
  await event("PENDING", "planned", null, false);
  const self = await publicPersona(deps);
  expect(self.today.date).toBe(date);
  expect(self.today.plan).toEqual(plan);
  expect([...self.today.happened].sort()).toEqual(["INSTEAD", "PLAN-HAPPENED", "SURPRISE"]);
});
