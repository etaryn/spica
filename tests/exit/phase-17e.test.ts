/**
 * Phase 17e exit, all fake (scripted core loops, fake reply, fake guard), real DB: her core loops
 * label their own time words and cite her memories, and code makes both dates; nothing reads her
 * prose for dates. A user's data never reaches a core loop, and a user's run leaves core unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_goal, core_memory } from "@/db/schema";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun } from "@/db/repos/user/user-mind";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreReflect } from "@/mind/process/core/reflect";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { coreWander } from "@/mind/process/core/wander";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { runUserMind } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
type D = ReturnType<typeof makeTestDeps>;

const utc = { life: { timezone: "UTC" } };
const thu = new Date("2026-01-08T09:00:00Z");
const time = (field: string, words: string, meaning: object) => ({
  field,
  words,
  from: "",
  unit: "day",
  shift: 0,
  weekday: null,
  month: null,
  day_of_month: null,
  part: null,
  clock: "",
  span: "at",
  rough: false,
  ...meaning,
});

async function plan(d: D, date: string, at: Date) {
  await coreDepsOf(d).core.world.insertPlan({
    date,
    plan: { blocks: [] },
    source: "scripted",
    model: "fake",
    prompt_version: "v1",
    generated_at: at,
  });
}

async function episode(d: D, content: string, occurred: Date, created = occurred) {
  return coreDepsOf(d).core.memory.insert({
    kind: "episode",
    content,
    payload: {},
    embedding: vec(),
    entity_refs: [],
    occurred_at: occurred,
    created_at: created,
    status: "resolved",
    salience: 0.6,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("1: wander's 'tomorrow night' is stored as tomorrow's night, and [m1] as the seed's date", async () => {
  const d = makeTestDeps(utc);
  d.clock.set(thu);
  await plan(d, "2026-01-08", thu);
  const seed = await episode(
    d,
    "The remote telescope booking came through.",
    new Date("2026-01-06T12:00:00Z"),
    new Date(thu.getTime() - 3_600_000),
  );
  d.llm.handlers.core_wander = () => ({
    items: [
      { kind: "thought", content: "the telescope [m1], again tomorrow night", salience: "low" },
    ],
    times: [time("item_1", "tomorrow night", { shift: 1, part: "night" })],
  });
  const out = await coreWander(coreDepsOf(d), thu);
  expect(out.status).toBe("done");
  const thought = (await coreDepsOf(d).core.memory.get(out.ids[0]!))!;
  expect(thought.content).toBe(
    "the telescope (⟦2026-01-06|day|UTC⟧), again ⟦2026-01-09|night|UTC|tomorrow night⟧",
  );
  expect(thought.payload).toMatchObject({ cites: [seed] });
});

test("2: an unlabelled weekday stays as written", async () => {
  const d = makeTestDeps(utc);
  d.clock.set(thu);
  await plan(d, "2026-01-08", thu);
  await episode(d, "The screening club met.", new Date("2026-01-06T12:00:00Z"), thu);
  d.llm.handlers.core_wander = () => ({
    items: [{ kind: "thought", content: "the screening on tuesday", salience: "low" }],
  });
  const out = await coreWander(coreDepsOf(d), thu);
  expect((await coreDepsOf(d).core.memory.get(out.ids[0]!))!.content).toBe(
    "the screening on tuesday",
  );
});

test("3: a planned event's thought and a reflected goal carry tokens", async () => {
  const d = makeTestDeps({
    ...utc,
    core: { world: { event_probability: 1, events_per_day_max: 1, fallthrough_probability: 0 } },
  });
  const morning = new Date("2026-01-05T01:00:00Z");
  d.llm.handlers.life_event = () => ({
    content: "Spica rewatched Solaris.",
    at: "20:00",
    valence: 0.3,
    stakes: "low",
    entity_names: [],
    kind: "planned",
    thought: "Spica is thinking of rewatching Solaris tonight.",
    times: [time("thought", "tonight", { part: "night" })],
  });
  await coreWorldTick(coreDepsOf(d), morning);
  const rows = await d.db.select().from(core_memory);
  expect(rows.find((m) => m.kind === "intention")!.content).toBe(
    "Spica is thinking of rewatching Solaris ⟦2026-01-05|night|UTC|tonight⟧.",
  );

  d.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [{ title: "Finish the essay by Sunday", why: "it matters" }], drop: [] },
    narrative: null,
    times: [time("goal_1_title", "Sunday", { unit: "weekday", weekday: "sunday", shift: 1 })],
  });
  await episode(d, "She started an essay on Solaris.", morning);
  expect(await coreReflect(coreDepsOf(d), new Date("2026-01-05T19:00:00Z"))).toBe("done");
  const goal = (await d.db.select().from(core_goal)).find((g) => g.source === "reflect")!;
  expect(goal.title).toBe("Finish the essay by ⟦2026-01-11|day|UTC|Sunday⟧");
});

test("4: the snapshot labels a new line and keeps a kept line byte for byte", async () => {
  const d = makeTestDeps(utc);
  const blank = { Lately: [], Opinions: [], Interests: [], Goals: [], People: [] };
  const kept = "Stargazing (⟦2026-01-03|day|UTC⟧)";
  d.llm.handlers.core_render_snapshot = () => ({
    ...blank,
    Interests: [{ text: kept, depth: null }],
    "Habits of speech": [],
  });
  await coreRenderSnapshot(coreDepsOf(d), thu);
  d.llm.handlers.core_render_snapshot = () => ({
    ...blank,
    Lately: [{ text: "Screenings all this weekend", depth: null }],
    "Habits of speech": [],
    times: [time("Lately 1", "this weekend", { unit: "weekend" })],
  });
  await coreRenderSnapshot(coreDepsOf(d), new Date(thu.getTime() + 86_400_000));
  const snap = (await coreDepsOf(d).core.memory.latestSnapshot())!;
  expect(snap.sections.Interests).toBe(`- ${kept}`);
  expect(snap.sections.Lately).toBe("- Screenings all ⟦2026-01-10|weekend|UTC|this weekend⟧");
});

const TOKEN = "CANARY-17e4c1";
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

test("5: leak canary: A's data never reaches a core loop; A's run leaves core unchanged", async () => {
  const base = makeTestDeps(utc);
  const llm = new CapturingLLM();
  const d = { ...base, llm };
  d.clock.set(thu);
  const a = await createTestUser("alice");
  const before = await coreDump();

  await insertFact(d.db, a, {
    subject: "user",
    kind: "event",
    content: `the code word is ${TOKEN}`,
    embedding: vec(),
    created_at: thu,
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  const row = (await insertRun(d.db, a, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-08",
    now: thu,
    cap: 9,
  }))!;
  expect(await runUserMind(d, { runId: row.id })).toBe("done");
  // The canary reached A's loops, so a leak would be visible.
  expect(llm.seen.some((c) => c.purpose === "user_summarise" && c.text.includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);

  await plan(d, "2026-01-08", thu);
  await episode(d, "The telescope booking came through.", thu, new Date(thu.getTime() - 3_600_000));
  const core = coreDepsOf(d);
  const seen = llm.seen.length;
  expect((await coreWander(core, thu)).status).toBe("done");
  expect(await coreReflect(core, thu)).toBe("done");
  expect(await coreRenderSnapshot(core, thu)).toBe("done");
  const coreCalls = llm.seen.slice(seen);
  expect(coreCalls.map((c) => c.purpose)).toEqual(
    expect.arrayContaining(["core_wander", "core_reflect", "core_render_snapshot"]),
  );
  for (const c of coreCalls) expect(c.text).not.toContain(TOKEN);
  expect(await coreDump()).not.toContain(TOKEN);
});
