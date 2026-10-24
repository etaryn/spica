/**
 * Phase 16c exit, all fake, from the 16b close run: anchoring keeps every word, a day said twice
 * is one token, a fact keeps its own weekday, her loops date a weekday by the day they were shown,
 * a row's own date wins, and a part of the day with a clock time anchors. A's data never reaches
 * a core loop, and A's fact leaves core unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { anchorExtraction } from "@/mind/memory/user/extract";
import { coreDepsOf } from "@/mind/platform/deps";
import { anchorTimes, renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import { coreWander } from "@/mind/process/core/wander";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const day = (d: Date | undefined | null) => d?.toISOString().slice(0, 10) ?? null;

test("1: the swallowed summary keeps every word", () => {
  const at = new Date("2026-01-05T10:21:40Z");
  const text =
    "Sam has a design job interview at a small studio on the afternoon of Thursday 8 January, in 3 days, and they're feeling nervous about it.";
  expect(renderTimes(anchorTimes(text, { at, zone: "UTC" }), at, 6)).toBe(text);
});

test("2: 'yesterday, Thursday 8 January' and an ISO twin are one date each", () => {
  const ctx = { at: new Date("2026-01-09T20:00:00Z"), zone: "UTC" };
  expect(tokenDates(anchorTimes("Interview yesterday, Thursday 8 January.", ctx))).toHaveLength(1);
  expect(tokenDates(anchorTimes("Interview on Thursday afternoon, 2026-01-08.", ctx))).toHaveLength(
    1,
  );
});

test("3: the interview stays on Thursday when their message says 'that's sunday'", () => {
  const sent = new Date("2026-01-05T15:43:00Z");
  const fact = {
    subject: "user",
    kind: "event",
    content: "The user has a design job interview on Thursday afternoon.",
    occurred_at: null,
    when_direction: "upcoming",
    salience: 0.7,
    valence: 0,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
  };
  const out = anchorExtraction(
    {
      facts: [fact],
      entities: [],
      threads: [],
      relationship: null,
      intimacy: null,
      bid: null,
    } as never,
    [{ role: "user", text: "no half marathon yet lol, that's sunday", created_at: sent }],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-08");
});

test("4: a seed's own date dates its words", async () => {
  const u = await createTestUser();
  const r = await insertFact(getTestDb(), u, {
    subject: "user",
    kind: "event",
    content: "The user is running a half marathon on Sunday morning.",
    embedding: vec(),
    created_at: new Date("2026-01-04T10:00:00Z"),
    occurred_at: new Date("2026-01-11T09:00:00Z"),
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  expect(day(tokenDates(r.content)[0])).toBe("2026-01-11");
});

test("5: 'tonight at 20:45' anchors", () => {
  const at = new Date("2026-01-09T09:00:00Z");
  expect(anchorTimes("tonight at 20:45", { at, zone: "UTC" })).toBe("⟦2026-01-09T20:45|time|UTC⟧");
});

const CANARY = "CANARY-16c7d2";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("6: wander shown Tuesday 6 January stores 'tuesday night' on it; A's fact never reaches it", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const deps = coreDepsOf(d);
  const thu = new Date("2026-01-08T09:00:00Z");
  d.clock.set(thu);
  const a = await createTestUser("alice");
  await insertFact(d.db, a, {
    subject: "user",
    kind: "event",
    content: `The user's gig ${CANARY} is tomorrow.`,
    embedding: vec(),
    created_at: thu,
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 1,
    source: "turn",
  });
  await deps.core.world.insertPlan({
    date: "2026-01-08",
    plan: { blocks: [] },
    source: "scripted",
    model: "fake",
    prompt_version: "v1",
    generated_at: thu,
  });
  await deps.core.memory.insert({
    kind: "episode",
    content: "The remote telescope booking came through.",
    payload: {},
    embedding: vec(),
    entity_refs: [],
    occurred_at: new Date("2026-01-06T12:00:00Z"),
    created_at: new Date(thu.getTime() - 3_600_000),
    status: "resolved",
    salience: 0.6,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  d.llm.handlers.core_wander = () => ({
    items: [
      {
        kind: "thought",
        content: "the telescope booking came through for tuesday night",
        salience: "low",
      },
    ],
  });
  const before = await coreDump();
  expect(before).not.toContain(CANARY);
  const out = await coreWander(deps, thu);
  expect(out.status).toBe("done");
  const thought = await deps.core.memory.get(out.ids[0]!);
  expect(thought!.content).toContain("⟦2026-01-06|night|UTC⟧");
  for (const c of d.llm.structuredCalls) expect(JSON.stringify(c)).not.toContain(CANARY);
  expect(await coreDump()).not.toContain(CANARY);
});
