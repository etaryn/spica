import { afterAll, beforeEach, expect, test } from "vitest";
import { checkEvent, checkRules, generateEvents } from "@/mind/world/legacy-life-tick/events";
import { lifeTickUser } from "@/mind/world/legacy-life-tick/tick";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { insertFact } from "@/db/repos/facts";
import { getIdentityRow } from "@/db/repos/identity";
import { listLifeEventLogs } from "@/db/repos/life-event-log";
import { ensureRelationship } from "@/db/repos/relationship";
import { fact, thread } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const D = 1024;
const at = new Date("2026-01-05T18:00:00Z"); // 02:00 on 2026-01-06 in Singapore
const DAY = 86_400_000;

function deps(over: unknown = {}) {
  const d = makeTestDeps(deepOver(over));
  const embedder = new ScriptedEmbedder(D);
  return { ...d, embedder };
}
function deepOver(over: unknown) {
  return { life: { events_per_day_max: 1, event_probability: 1 }, ...(over as object) };
}

async function user(d: ReturnType<typeof deps>) {
  const u = await createTestUser();
  await ensureRelationship(d.db, u, at, d.config.relationship);
  return u;
}

test("checkEvent rejects bad times and empty content, clamps valence", () => {
  expect(
    checkEvent({ content: " ", at: "10:00", valence: 0, stakes: "low", entity_names: [] }, 300),
  ).toBeNull();
  expect(
    checkEvent(
      { content: "Spica read.", at: "24:00", valence: 0, stakes: "low", entity_names: [] },
      300,
    ),
  ).toBeNull();
  expect(
    checkEvent(
      { content: "Spica read.", at: "10:00", valence: 3, stakes: "low", entity_names: [" Alcor "] },
      300,
    ),
  ).toEqual({
    content: "Spica read.",
    at: "10:00",
    valence: 1,
    stakes: "low",
    entity_names: ["Alcor"],
  });
});

test("checkEvent enforces the configured content cap; config defaults", () => {
  const cfg = makeTestDeps().config.life;
  expect(cfg.event_max_chars).toBe(300);
  expect(cfg.injected_event_at).toBe("12:00");
  const c = {
    content: "Spica read a long book.",
    at: "10:00",
    valence: 0,
    stakes: "low" as const,
    entity_names: [],
  };
  expect(checkEvent(c, 10)).toBeNull();
  expect(checkEvent(c, cfg.event_max_chars)).not.toBeNull();
});

test("checkRules: one new entity a week, one high-stakes event per window, canon is known", () => {
  const cfg = makeTestDeps().config.life;
  const known = new Set(["alcor"]);
  const c = (names: string[], stakes: "low" | "high" = "low") => ({
    content: "x",
    at: "10:00",
    valence: 0,
    stakes,
    entity_names: names,
  });
  expect(
    checkRules(c(["Alcor"]), { known, lastNewEntityAt: at, lastHighStakesAt: null }, at, cfg),
  ).toBeNull();
  expect(
    checkRules(c(["Mira"]), { known, lastNewEntityAt: null, lastHighStakesAt: null }, at, cfg),
  ).toBeNull();
  expect(
    checkRules(
      c(["Mira"]),
      { known, lastNewEntityAt: new Date(at.getTime() - DAY), lastHighStakesAt: null },
      at,
      cfg,
    ),
  ).toBe("rule:new_entity");
  expect(
    checkRules(
      c(["Mira", "Oren"]),
      { known, lastNewEntityAt: null, lastHighStakesAt: null },
      at,
      cfg,
    ),
  ).toBe("rule:new_entity");
  expect(
    checkRules(
      c([], "high"),
      { known, lastNewEntityAt: null, lastHighStakesAt: new Date(at.getTime() - DAY) },
      at,
      cfg,
    ),
  ).toBe("rule:high_stakes");
});

test("a contradicting injected event is rejected, logged and regenerated; the regeneration is stored", async () => {
  const d = deps();
  const u = await user(d);
  // The seed and the injected contradiction are near neighbours; the regeneration is not.
  d.embedder.set("Spica finished reading Middlemarch last week.", ScriptedEmbedder.axis(D, 1));
  d.embedder.set(
    "Spica hasn't started reading Middlemarch yet.",
    ScriptedEmbedder.near(D, 1, 2, 0.9),
  );
  const seed = await insertFact(d.db, u, {
    subject: "self",
    kind: "event",
    content: "Spica finished reading Middlemarch last week.",
    embedding: ScriptedEmbedder.axis(D, 1),
    created_at: new Date(at.getTime() - DAY),
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 1,
    source: "turn",
  });
  d.llm.handlers.reconcile = (input: string) =>
    input.includes("hasn't started")
      ? { relation: "contradicts", target_fact_id: seed.id }
      : { relation: "new", target_fact_id: null };
  expect(
    await lifeTickUser(d, u, at, {
      inject: () => ({ content: "Spica hasn't started reading Middlemarch yet.", valence: 0 }),
    }),
  ).toBe("done");
  const logs = (await listLifeEventLogs(d.db, u, 10)).reverse();
  expect(logs.map((l) => l.decision)).toEqual(["contradicts", "accepted"]);
  expect(logs[0]!.target_fact_id).toBe(seed.id);
  expect(logs[1]!.fact_id).not.toBeNull();
  const contents = (await d.db.select().from(fact).where(eq(fact.user_id, u))).map(
    (f) => f.content,
  );
  expect(contents).not.toContain("Spica hasn't started reading Middlemarch yet.");
  expect(contents).toContain("Spica found an old film she'd forgotten she loved.");
  expect(d.llm.structuredCalls.find((c) => c.purpose === "life_event")!.input).toMatch(
    /contradicts something she already said/,
  );
});

test("after regen_attempts rejections there is no event that day, and the tick still completes", async () => {
  const d = deps({ life: { events_per_day_max: 1, event_probability: 1, regen_attempts: 1 } });
  const u = await user(d);
  d.llm.handlers.life_event = () => ({
    content: "",
    at: "10:00",
    valence: 0,
    stakes: "low",
    entity_names: [],
  });
  expect(await lifeTickUser(d, u, at)).toBe("done");
  expect((await listLifeEventLogs(d.db, u, 10)).map((l) => l.decision)).toEqual([
    "invalid",
    "invalid",
  ]);
  expect((await getIdentityRow(d.db, u))?.life_last_date).toBe("2026-01-06");
});

test("a strong event becomes the preoccupation and nudges mood; high stakes opens a self thread", async () => {
  const d = deps();
  const u = await user(d);
  d.llm.handlers.life_event = () => ({
    content: "Spica finally got the telescope images she'd waited months for.",
    at: "11:00",
    valence: 0.8,
    stakes: "high",
    entity_names: [],
  });
  await lifeTickUser(d, u, at);
  const row = await getIdentityRow(d.db, u);
  const stored = (
    await d.db
      .select()
      .from(fact)
      .where(and(eq(fact.user_id, u), isNull(fact.payload)))
  )[0]!;
  expect(row?.preoccupation).toBe(stored.id);
  expect(row?.mood_valence).toBeCloseTo(
    d.config.ego.baseline.mood_valence + 0.8 * d.config.ego.event_gain,
  );
  expect(stored.occurred_at?.toISOString()).toBe("2026-01-06T03:00:00.000Z");
  const threads = await d.db.select().from(thread).where(eq(thread.user_id, u));
  expect(threads).toHaveLength(1);
  expect(threads[0]).toMatchObject({ subject: "self", stakes: "high", status: "open" });
});

test("no draw → no event call", async () => {
  const d = deps({ life: { events_per_day_max: 1, event_probability: 0 } });
  const u = await user(d);
  const r = await generateEvents(d, u, "2026-01-06", null, at);
  expect(r).toEqual({ accepted: [], attempts: [] });
  expect(d.llm.structuredCalls.some((c) => c.purpose === "life_event")).toBe(false);
});

test("an injected event forces the draw even at probability 0", async () => {
  const d = deps({ life: { events_per_day_max: 1, event_probability: 0 } });
  const u = await user(d);
  const r = await generateEvents(d, u, "2026-01-06", null, at, () => ({
    content: "Spica argued with Alcor about a film.",
    valence: 0.1,
  }));
  expect(r.attempts.map((a) => [a.source, a.decision])).toEqual([["injected", "accepted"]]);
});
