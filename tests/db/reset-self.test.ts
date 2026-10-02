import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { adminResetSelf, assertLocalDatabase } from "@/db/reset-self";
import { core_memory, entity, fact, thread, world_event } from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

const t0 = new Date("2026-01-05T10:00:00Z");
beforeEach(resetDb);
afterAll(closeTestDb);

test("refuses a non-local database", () => {
  expect(() => assertLocalDatabase("postgres://u:p@db.example.com:5432/spica")).toThrow(
    /non-local/,
  );
  expect(() => assertLocalDatabase("postgres://u:p@localhost:5432/spica")).not.toThrow();
  expect(() => assertLocalDatabase("postgres://u:p@127.0.0.1:5432/spica")).not.toThrow();
});

test("deletes self facts, entities and threads for every user, keeps user facts, clears her core mind", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const base = {
    kind: "event" as const,
    embedding: vec(),
    created_at: t0,
    status: "open" as const,
    salience: 0.5,
    valence: 0,
    confidence: 1,
    source: "turn" as const,
  };
  await insertFact(db, u, {
    ...base,
    subject: "self",
    content: "Spica has a cat called Pesto.",
  });
  await insertFact(db, u, { ...base, subject: "user", content: "The user likes tea." });
  await db.insert(entity).values({
    user_id: u,
    name: "Theo",
    type: "person",
    subject: "self",
    salience: 0.5,
    first_seen: t0,
    last_mentioned: t0,
  });
  await db.insert(thread).values({
    user_id: u,
    title: "Theo's move",
    subject: "self",
    status: "open",
    stakes: "low",
    opened_at: t0,
    last_touched: t0,
  });
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const episode = await deps.core.memory.insert({
    kind: "episode",
    content: "She rewatched Solaris.",
    embedding: vec(),
    occurred_at: t0,
    created_at: t0,
    status: "open",
    salience: 0.5,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  await deps.core.state.update({ preoccupation: episode, last_event_day: "2026-01-05" });
  await deps.core.world.recordEvent({
    at: t0,
    kind: "planned",
    content: "She rewatched Solaris.",
    valence: 0.6,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: t0,
  });
  expect(await adminResetSelf(db)).toEqual({ facts: 1, entities: 1, threads: 1 });
  expect((await db.select().from(fact)).map((f) => f.content)).toEqual(["The user likes tea."]);
  expect(await db.select().from(core_memory)).toEqual([]);
  expect(await db.select().from(world_event)).toEqual([]);
  expect(await deps.core.state.get()).toBeNull();
});
