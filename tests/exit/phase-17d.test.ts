/**
 * Phase 17d exit, all fake (scripted loops, fake reply, fake guard), real DB: her notes cite the
 * memories they rest on and label their own time words, and code renders both. An idea about them
 * resting only on her own life isn't written, but an uncited one is. Superseding a cited memory
 * retires the idea, not the summary. A reach-out reads an idea's cited dates. Stored words are
 * kept as given. A's notes never reach B, and A's run leaves core unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { getFact, insertFact, setFactStatus } from "@/db/repos/user/facts";
import { insertRun, liveIdeas, liveSummary } from "@/db/repos/user/user-mind";
import { loadCandidateInputs } from "@/mind/process/outreach/inputs";
import { runUserMind } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CapturingLLM, sequence } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
type D = ReturnType<typeof makeTestDeps>;

const tonight = {
  field: "whats_live",
  words: "tonight",
  from: "",
  unit: "day",
  shift: 0,
  weekday: null,
  month: null,
  day_of_month: null,
  part: "night",
  clock: "",
  span: "at",
  rough: false,
};

async function memory(d: D, u: string, subject: "user" | "self", content: string, extra = {}) {
  return insertFact(d.db, u, {
    subject,
    kind: "event",
    content,
    embedding: vec(),
    created_at: d.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 0.9,
    source: "turn",
    ...extra,
  });
}

async function run(d: D, u: string, ref: string) {
  const row = (await insertRun(d.db, u, {
    sourceRef: ref,
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: d.clock.now(),
    cap: 9,
  }))!;
  expect(await runUserMind(d, { runId: row.id })).toBe("done");
}

test("1: a summary cites a memory with whose it is, and her 'tonight' is a token", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const interview = await memory(d, u, "user", 'design interview, planned — the user said "thu"', {
    occurred_at: new Date("2026-01-08T14:00:00Z"),
  });
  d.llm.handlers.user_summarise = () => ({
    where_things_stand: "They have [m1].",
    whats_live: "Check in tonight.",
    how_i_feel: "Fond.",
    times: [tonight],
  });
  await run(d, u, "exchange:1");
  const s = (await liveSummary(d.db, u))!;
  expect(s.payload).toMatchObject({
    where_things_stand: "They have (design interview, planned ⟦2026-01-08|day|UTC⟧, theirs).",
    whats_live: "Check in ⟦2026-01-05|night|UTC|tonight⟧.",
    cites: [interview.id],
  });
});

test("2: an idea about them resting only on her life isn't written; an uncited one is", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await memory(d, u, "self", "telescope booking, planned");
  d.llm.handlers.user_ideate = sequence(
    { idea: "Ask whether [m1] turned up Orion's belt.", about: "them", times: [] },
    { idea: "Ask what they're reading lately.", about: "them", times: [] },
  );
  await run(d, u, "exchange:2a");
  expect(await liveIdeas(d.db, u, d.clock.now(), 5)).toEqual([]);
  await memory(d, u, "user", "a new book");
  await run(d, u, "exchange:2b");
  const ideas = await liveIdeas(d.db, u, d.clock.now(), 5);
  expect(ideas.map((i) => [i.subject, i.content])).toEqual([
    ["user", "Ask what they're reading lately."],
  ]);
});

test("3: superseding a cited memory retires the idea, not the summary; outreach read its date", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const when = new Date("2026-01-08T14:00:00Z");
  const interview = await memory(d, u, "user", "design interview, planned", { occurred_at: when });
  d.llm.handlers.user_summarise = () => ({
    where_things_stand: "They have [m1].",
    whats_live: "Nothing else.",
    how_i_feel: "Fond.",
    times: [],
  });
  d.llm.handlers.user_ideate = () => ({ idea: "Ask how [m1] goes.", about: "them", times: [] });
  await run(d, u, "exchange:3");
  const [idea] = await liveIdeas(d.db, u, d.clock.now(), 5);
  const [shown] = (await loadCandidateInputs(d, u, d.clock.now())).userIdeas;
  expect(shown!.notes).toEqual([expect.objectContaining({ at: when.toISOString(), dated: true })]);

  const moved = await memory(d, u, "user", "design interview, moved");
  await setFactStatus(d.db, u, interview.id, "superseded", moved.id);
  expect((await getFact(d.db, u, idea!.id))!.status).toBe("stale");
  expect((await liveSummary(d.db, u))!.status).toBe("open");
});

test("4: stored words are kept as given", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const row = await memory(d, u, "user", "see you tomorrow on Friday");
  expect(row.content).toBe("see you tomorrow on Friday");
});

const TOKEN = "CANARY-17d9b3";
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

test("5: leak canary: A's notes never reach B; A's run leaves core unchanged", async () => {
  const base = makeTestDeps();
  const llm = new CapturingLLM();
  const d = { ...base, llm };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  const before = await coreDump();

  await memory(d, a, "user", `the code word is ${TOKEN}`);
  await run(d, a, "exchange:a");
  // The canary reached A's loops, so a leak would be visible.
  expect(llm.seen.some((c) => c.purpose === "user_summarise" && c.text.includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);

  const seen = llm.seen.length;
  await memory(d, b, "user", "they bought a plant");
  await run(d, b, "exchange:b");
  const bCalls = llm.seen.slice(seen);
  expect(bCalls.some((c) => c.purpose === "user_summarise")).toBe(true);
  for (const c of bCalls) expect(c.text).not.toContain(TOKEN);
  expect(await coreDump()).toBe(before);
});
