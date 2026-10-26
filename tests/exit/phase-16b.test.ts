/**
 * Phase 16b exit, all fake: every prompt reads a stored date token on its own day, on its
 * owner's calendar; extract dates from the message's own time; her view glosses older messages; a reach-out on the
 * wrong day is dropped. A's dates never reach B, no raw token reaches a model, core is unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun } from "@/db/repos/user/user-mind";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { renderTimes } from "@/mind/platform/time-anchors";
import { viewTurns } from "@/mind/process/hot-path/assemble";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

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

test("4: her view keeps an older message's words and says what they mean now", () => {
  const now = new Date("2026-01-13T09:00:00Z");
  // The gloss comes from the message's time label, resolved from its own send time.
  const [line] = viewTurns(
    [{ id: "a", text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") }],
    now,
    "UTC",
    [{ turnId: "a", start: 11, end: 19, token: "⟦2026-01-13|day|UTC|tomorrow⟧" }],
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
