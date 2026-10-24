/**
 * Phase 16b exit, all fake: stored text keeps the date each time phrase meant and every prompt
 * reads it on its own day, each on its owner's calendar; a weekday takes the date she was shown;
 * extract dates from the message's own time; her view glosses older messages; a reach-out on the
 * wrong day is dropped. A's dates never reach B, no raw token reaches a model, core is unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { anchorExtraction } from "@/mind/memory/user/extract";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import { viewTurns } from "@/mind/process/hot-path/assemble";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const D = 86_400_000;
const row = (content: string, at: Date, kind: "summary" | "event" = "summary") => ({
  subject: (kind === "summary" ? "shared" : "user") as "shared" | "user",
  kind,
  content,
  embedding: vec(),
  created_at: at,
  status: "open" as const,
  salience: 0.5,
  valence: 0,
  confidence: 0.6,
  source: "generated" as const,
});
const runFor = async (d: ReturnType<typeof makeTestDeps>, u: string, ref: string) =>
  (await insertRun(d.db, u, {
    sourceRef: ref,
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: d.clock.now(),
    cap: 9,
  }))!;

test("1: 'tomorrow' stored on day 1 reads as today on day 2 and yesterday on day 3", async () => {
  const u = await createTestUser();
  const day1 = new Date("2026-01-12T09:00:00Z");
  const r = await insertFact(getTestDb(), u, row("Sister visits tomorrow.", day1));
  expect(renderTimes(r.content, new Date(day1.getTime() + D), 6)).toBe("Sister visits today.");
  expect(renderTimes(r.content, new Date(day1.getTime() + 2 * D), 6)).toBe(
    "Sister visits yesterday, Tuesday 13 January.",
  );
});

test("2: a weekday in her summary takes the date of the memory she was shown", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  // Last Sunday's race: read forward, "Sunday" would be the coming one.
  const race = new Date(d.clock.now().getTime() - D);
  await insertFact(d.db, u, {
    ...row("The user ran a half marathon.", d.clock.now(), "event"),
    source: "turn",
    occurred_at: race,
  });
  d.llm.handlers.user_summarise = () => ({
    where_things_stand: "Race Sunday.",
    whats_live: "Nothing new.",
    how_i_feel: "Glad.",
  });
  await userSummarise(
    { ...d, snapshot: null },
    await runFor(d, u, "exchange:a"),
    await loadRunInputs(d, u),
  );
  const [date] = tokenDates((await liveSummary(d.db, u))!.content);
  expect(date!.toISOString().slice(0, 10)).toBe(race.toISOString().slice(0, 10));
});

test("3: extract dates a fact from its message's own time, in the labelled direction", () => {
  const sent = new Date("2026-01-12T09:00:00Z");
  const fact = {
    subject: "user",
    kind: "event",
    content: "The user finished the task over the weekend.",
    occurred_at: null,
    when_direction: "past",
    salience: 0.7,
    valence: 0,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
    claim_kind: null,
    idiolect_type: null,
    started_by: null,
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
    [{ role: "user", text: "finished it over the weekend", created_at: sent }],
    "UTC",
  );
  expect(out.facts[0]!.occurred_at!.toISOString().slice(0, 10)).toBe("2026-01-10");
});

test("4: her view keeps an older message's words and says what they mean now", () => {
  const now = new Date("2026-01-13T09:00:00Z");
  const [line] = viewTurns(
    [{ text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") }],
    now,
    "UTC",
  );
  expect(renderTimes(line!, now, 6)).toBe(
    "— yesterday, Monday 12 January —\nmy race is tomorrow (that's today)",
  );
});

const CANARY = "CANARY-16b4e1";
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

test("5: leak canary: A's dates never reach B; no raw token reaches the model; core unchanged", async () => {
  const base = makeTestDeps();
  const fake = new FakeLLMProvider();
  const d = { ...base, llm: withTimeRendering(fake, base.clock, 6) };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await insertFact(d.db, a, {
    ...row(`Gig ${CANARY} tomorrow.`, d.clock.now(), "event"),
    source: "turn",
  });
  await insertFact(d.db, b, {
    ...row("Gig at the Lexington tomorrow.", d.clock.now(), "event"),
    source: "turn",
  });
  const before = await coreDump();
  fake.handlers.user_summarise = () => ({
    where_things_stand: "Fine.",
    whats_live: "Nothing new.",
    how_i_feel: "Glad.",
  });
  await userSummarise(
    { ...d, snapshot: null },
    await runFor(d, a, "exchange:a"),
    await loadRunInputs(d, a),
  );
  const bStart = fake.structuredCalls.length;
  await userSummarise(
    { ...d, snapshot: null },
    await runFor(d, b, "exchange:b"),
    await loadRunInputs(d, b),
  );
  const bCalls = fake.structuredCalls.slice(bStart);
  expect(bCalls.length).toBeGreaterThan(0);
  for (const c of bCalls) expect(JSON.stringify(c)).not.toContain(CANARY);
  for (const c of fake.structuredCalls) expect(c.input + c.system).not.toContain("⟦");
  expect(await coreDump()).toBe(before);
});
