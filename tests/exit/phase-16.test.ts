/**
 * Phase 16 exit, all fake: dates count by the calendar in the reader's zone, across midnight and a
 * DST change; an idea about an event retires once it has passed and never reaches a reach-out; an
 * undated idea keeps its few days; an anticipation past its plan is no reach-out topic; a slipped
 * relative word is stored and logged. A's idea never reaches B, and an idea run and the sweep
 * leave core unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertRun, liveIdeas } from "@/db/repos/user/user-mind";
import { decayPass } from "@/mind/memory/user/decay";
import { dayInWords, relativeDate } from "@/mind/platform/relative-date";
import { loadCandidateInputs } from "@/mind/process/outreach/inputs";
import { ideaStaleAfter, userIdeate } from "@/mind/process/user/ideate";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const D = 24 * H;
type TestDeps = ReturnType<typeof makeTestDeps>;
const loopDeps = (d: TestDeps) => ({ ...d, snapshot: null });

test("1: day counts follow the reader's calendar across midnight and DST", () => {
  expect(
    relativeDate(new Date("2026-01-11T23:30:00Z"), new Date("2026-01-12T00:10:00Z"), "UTC"),
  ).toBe("yesterday");
  expect(
    relativeDate(
      new Date("2026-01-10T23:30:00Z"),
      new Date("2026-01-12T01:00:00Z"),
      "Asia/Singapore",
    ),
  ).toBe("yesterday");
  expect(
    relativeDate(
      new Date("2026-03-28T12:00:00Z"),
      new Date("2026-03-30T00:30:00Z"),
      "Europe/London",
    ),
  ).toBe("2 days ago");
  expect(
    dayInWords(new Date("2026-01-14T09:00:00Z"), new Date("2026-01-12T10:00:00Z"), "UTC"),
  ).toBe("Wednesday 14 January, in 2 days");
});

async function ideaRun(d: TestDeps, u: string, ref: string) {
  return (await insertRun(d.db, u, {
    sourceRef: ref,
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-06",
    now: d.clock.now(),
    cap: 9,
  }))!;
}

test("2: an idea for tonight retires after tonight and never reaches a reach-out", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const tue = new Date("2026-01-06T09:00:00Z");
  d.clock.set(tue);
  const u = await createTestUser();
  await ensureRelationship(d.db, u, tue, d.config.relationship);
  await insertFact(d.db, u, {
    subject: "self",
    kind: "event",
    content: "Spica said the sky would be clear for Orion on Tuesday 6 January.",
    embedding: vec(),
    created_at: tue,
    occurred_at: new Date("2026-01-06T22:00:00Z"),
    status: "open",
    salience: 0.7,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  d.llm.handlers.user_ideate = () => ({ idea: "Ask if they saw Orion with the clear sky." });
  const run = await ideaRun(d, u, "exchange:a");
  expect(await userIdeate(loopDeps(d), run, await loadRunInputs(d, u))).toBe("done");
  const [idea] = await liveIdeas(d.db, u, tue, 5);
  expect(idea!.stale_after).toEqual(new Date("2026-01-07T00:00:00Z"));

  const wed = new Date("2026-01-07T09:00:00Z");
  expect((await loadCandidateInputs(d, u, wed)).userIdeas).toEqual([]);
  await decayPass(d, wed);
  expect(await liveIdeas(d.db, u, wed, 5)).toEqual([]);
});

test("3: an undated idea keeps its few days", () => {
  const at = new Date("2026-01-06T09:00:00Z");
  expect(ideaStaleAfter(at, [], 3, "UTC")).toEqual(new Date(at.getTime() + 3 * D));
});

test("4: an anticipation past its plan is no reach-out topic", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const now = new Date("2026-01-10T12:00:00Z");
  const u = await createTestUser();
  const memory = (kind: "intention" | "thought", content: string, payload: unknown) =>
    d.core.memory.insert({
      kind,
      content,
      payload,
      embedding: vec(),
      occurred_at: new Date(now.getTime() - 4 * H),
      created_at: new Date(now.getTime() - 4 * H),
      status: "open",
      salience: 0.4,
      valence: 0,
      confidence: 1,
      source: "loop",
      source_ref: null,
    });
  const plan = await memory("intention", "Gallery opening.", {
    event_at: new Date(now.getTime() - H).toISOString(),
  });
  const thought = await memory("thought", "Nervous about the gallery.", { anticipates: plan });
  const ids = (await loadCandidateInputs(d, u, now)).coreThoughts.map((t) => t.id);
  expect(ids).not.toContain(thought);
});

test("5: a slipped relative word is stored as written and logged", async () => {
  const d = makeTestDeps();
  const logs: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    error: () => {},
  };
  const u = await createTestUser();
  await insertFact(d.db, u, {
    subject: "user",
    kind: "event",
    content: "They have a gig.",
    embedding: vec(),
    created_at: d.clock.now(),
    status: "open",
    salience: 0.7,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  d.llm.handlers.user_ideate = () => ({ idea: "Ask how tonight's gig goes." });
  await userIdeate(
    { ...loopDeps(d), log },
    await ideaRun(d, u, "exchange:b"),
    await loadRunInputs(d, u),
  );
  expect((await liveIdeas(d.db, u, d.clock.now(), 5))[0]!.content).toBe(
    "Ask how tonight's gig goes.",
  );
  expect(logs).toContainEqual({
    msg: "relative words in stored text",
    meta: { writer: "user_ideate", words: ["tonight"] },
  });
});

const TOKEN = "CANARY-16a3f9";
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

test("6: leak canary: A's idea never reaches B; an idea run and the sweep leave core unchanged", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const at = new Date("2026-01-06T09:00:00Z");
  d.clock.set(at);
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, at, d.config.relationship);
  const fact = (u: string, content: string) =>
    insertFact(d.db, u, {
      subject: "user",
      kind: "event",
      content,
      embedding: vec(),
      created_at: at,
      occurred_at: new Date(at.getTime() + 10 * H),
      status: "open",
      salience: 0.9,
      valence: 0,
      confidence: 1,
      source: "turn",
    });
  await fact(a, `The user's gig code is ${TOKEN}.`);
  await fact(b, "The user has a gig at the Lexington.");
  const before = await coreDump();
  d.llm.handlers.user_ideate = () => ({ idea: `Ask about the gig, ${TOKEN}.` });
  await userIdeate(loopDeps(d), await ideaRun(d, a, "exchange:c"), await loadRunInputs(d, a));
  const bStart = d.llm.structuredCalls.length;
  d.llm.handlers.user_ideate = () => ({ idea: null });
  await userIdeate(loopDeps(d), await ideaRun(d, b, "exchange:d"), await loadRunInputs(d, b));
  const bCalls = d.llm.structuredCalls.slice(bStart);
  expect(bCalls.length).toBeGreaterThan(0);
  for (const c of bCalls) expect(JSON.stringify(c)).not.toContain(TOKEN);
  expect(JSON.stringify(await loadCandidateInputs(d, b, at))).not.toContain(TOKEN);
  // A's own candidates do carry the idea, and still nothing moved in core.
  expect(JSON.stringify(await loadCandidateInputs(d, a, at))).toContain(TOKEN);
  await decayPass(d, new Date(at.getTime() + 2 * D));
  expect(await coreDump()).toBe(before);
});
