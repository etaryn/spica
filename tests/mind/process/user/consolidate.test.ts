import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { getFact, insertFact, setFactStatus } from "@/db/repos/user/facts";
import { insertThread, resolveThread } from "@/db/repos/user/threads";
import { setTimezone } from "@/db/repos/user/users";
import { insertRun } from "@/db/repos/user/user-mind";
import { oldestGistGroup } from "@/db/repos/user/gist";
import { userConsolidate } from "@/mind/process/user/consolidate";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

// The test clock is Monday 2026-01-05 09:00 UTC, so the cutoff is 2025-12-29: weeks starting
// 2025-12-15 and 2025-12-22 are old enough.
async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  const run = (await insertRun(base.db, userId, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: base.clock.now(),
    cap: 9,
  }))!;
  return { deps, userId, run };
}

type Extra = Partial<Parameters<typeof insertFact>[2]>;
function memory(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  content: string,
  at: string,
  extra: Extra = {},
) {
  return insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content,
    embedding: vec(),
    occurred_at: new Date(at),
    created_at: new Date(at),
    status: "open",
    salience: 0.6,
    valence: 0.2,
    confidence: 0.9,
    source: "turn",
    ...extra,
  });
}

test("folds the oldest old-enough week into one gist and weighs its sources down once", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_consolidate = sequence(
    { gist: "The week they started packing.", times: [] },
    { gist: "The week of the farewells.", times: [] },
  );
  const a = await memory(deps, userId, "They bought boxes.", "2025-12-16T10:00:00Z");
  const b = await memory(deps, userId, "They felt torn.", "2025-12-17T10:00:00Z", {
    kind: "feeling",
  });
  const c = await memory(deps, userId, "They packed books.", "2025-12-18T10:00:00Z");
  for (const d of ["2025-12-22", "2025-12-23", "2025-12-24"])
    await memory(deps, userId, `Farewell on ${d}.`, `${d}T10:00:00Z`);

  expect(await userConsolidate(deps, run)).toBe("done");
  const gists = await deps.db.execute(
    sql`SELECT * FROM fact WHERE kind = 'episode' ORDER BY created_at`,
  );
  expect(gists.rows).toHaveLength(1);
  const gist = gists.rows[0]!;
  expect(gist).toMatchObject({
    subject: "shared",
    source: "generated",
    status: "recurring",
    content: "The week they started packing.",
    salience: 0.6,
  });
  expect(String(gist.source_ref)).toMatch(/^user_consolidate:/);
  expect(new Date(String(gist.occurred_at)).toISOString()).toBe("2025-12-16T10:00:00.000Z");
  expect((gist.payload as { gist_of: string[] }).gist_of.sort()).toEqual([a.id, b.id, c.id].sort());
  for (const id of [a.id, b.id, c.id]) {
    const f = (await getFact(deps.db, userId, id))!;
    expect(f.salience).toBeCloseTo(0.3);
    expect(f.payload).toMatchObject({ gisted_into: gist.id });
  }
  const call = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(call.week).toBe("2025-12-15");
  expect(call.sources.map((s: { content: string }) => s.content)).toEqual([
    "They bought boxes.",
    "They felt torn.",
    "They packed books.",
  ]);

  // The next run takes the next week; a third finds nothing and makes no call.
  expect(await userConsolidate(deps, run)).toBe("done");
  const calls = deps.llm.structuredCalls.length;
  expect(await userConsolidate(deps, run)).toBe("done");
  expect(deps.llm.structuredCalls.length).toBe(calls);
  const traces = await deps.db.execute(
    sql`SELECT calls, outputs FROM user_loop_trace WHERE loop = 'user_consolidate' ORDER BY created_at, id`,
  );
  expect(traces.rows.map((r) => Number(r.calls))).toContain(0);
  expect((await getFact(deps.db, userId, a.id))!.salience).toBeCloseTo(0.3);
});

test("too recent, sensitive, on an open storyline, already gisted, wrong kind or inactive stay out", async () => {
  const { deps, userId, run } = await setup();
  const at = "2025-12-23T10:00:00Z";
  await memory(deps, userId, "They moved desks.", at);
  await memory(deps, userId, "They had a hard night.", at, { payload: { sensitive: true } });
  await memory(deps, userId, "They like tea.", at, { kind: "preference" });
  await memory(deps, userId, "Old news.", at, { status: "superseded" });
  await memory(deps, userId, "Already folded.", at, { payload: { gisted_into: "x" } });
  await memory(deps, userId, "Too recent.", "2025-12-29T10:00:00Z");
  const thread = await insertThread(
    deps.db,
    userId,
    { title: "The audition", subject: "user", stakes: "med", next_checkpoint: null },
    new Date(at),
  );
  await memory(deps, userId, "They practised lines.", at, { thread_id: thread.id });
  await memory(deps, userId, "They felt ready.", at, { kind: "feeling" });

  expect(await userConsolidate(deps, run)).toBe("done");
  expect(deps.llm.structuredCalls.some((c) => c.purpose === "user_consolidate")).toBe(false);

  // Once the storyline closes, its memory is history and the week has three.
  await resolveThread(deps.db, userId, thread.id, deps.clock.now());
  deps.llm.handlers.user_consolidate = sequence({ gist: "The audition week.", times: [] });
  expect(await userConsolidate(deps, run)).toBe("done");
  const input = JSON.parse(
    deps.llm.structuredCalls.find((c) => c.purpose === "user_consolidate")!.input,
  );
  expect(input.sources.map((s: { content: string }) => s.content).sort()).toEqual([
    "They felt ready.",
    "They moved desks.",
    "They practised lines.",
  ]);
});

test("weeks and the cutoff follow the user's timezone, and UTC when it is invalid", async () => {
  const { deps, userId } = await setup();
  // Sunday 12:00 UTC is already Monday 01:00 in Auckland.
  for (const content of ["One.", "Two.", "Three."])
    await memory(deps, userId, content, "2025-12-21T12:00:00Z");
  const w = { before: "2025-12-29", minGroup: 3, maxSources: 12 };
  await setTimezone(deps.db, userId, "Pacific/Auckland");
  expect((await oldestGistGroup(deps.db, userId, { ...w, tz: "Pacific/Auckland" }))!.week).toBe(
    "2025-12-22",
  );
  expect((await oldestGistGroup(deps.db, userId, { ...w, tz: "UTC" }))!.week).toBe("2025-12-15");

  const { deps: d2, userId: u2, run: r2 } = await setup();
  await setTimezone(d2.db, u2, "Not/AZone");
  for (const content of ["A.", "B.", "C."]) await memory(d2, u2, content, "2025-12-21T12:00:00Z");
  d2.llm.handlers.user_consolidate = sequence({ gist: "Gist.", times: [] });
  expect(await userConsolidate(d2, r2)).toBe("done");
  const input = JSON.parse(d2.llm.structuredCalls.at(-1)!.input);
  expect(input.week).toBe("2025-12-15");
});

test("at most max_sources, the most salient; a group that changed while she wrote leaves no gist", async () => {
  const { deps, userId, run } = await setup();
  deps.config.user_mind.consolidate.max_sources = 3;
  const rows: Awaited<ReturnType<typeof memory>>[] = [];
  for (const [i, s] of [0.2, 0.9, 0.8, 0.7].entries())
    rows.push(await memory(deps, userId, `M${i}.`, `2025-12-2${2 + i}T10:00:00Z`, { salience: s }));
  deps.llm.handlers.user_consolidate = async () => {
    // Reconcile supersedes a source while the model writes.
    await setFactStatus(deps.db, userId, rows[1]!.id, "superseded");
    return { gist: "A week.", times: [] };
  };
  expect(await userConsolidate(deps, run)).toBe("done");
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.sources.map((s: { content: string }) => s.content)).toEqual(["M1.", "M2.", "M3."]);
  const gists = await deps.db.execute(sql`SELECT id FROM fact WHERE kind = 'episode'`);
  expect(gists.rows).toHaveLength(0);
  expect((await getFact(deps.db, userId, rows[2]!.id))!.salience).toBeCloseTo(0.8);
});

test("empty output fails the loop and writes nothing", async () => {
  const { deps, userId, run } = await setup();
  for (const d of ["2025-12-22", "2025-12-23", "2025-12-24"])
    await memory(deps, userId, `On ${d}.`, `${d}T10:00:00Z`);
  deps.llm.handlers.user_consolidate = sequence({ gist: "", times: [] });
  expect(await userConsolidate(deps, run)).toBe("failed");
  const gists = await deps.db.execute(sql`SELECT id FROM fact WHERE kind = 'episode'`);
  expect(gists.rows).toHaveLength(0);
});

test("a gist cites its sources by id and keeps them", async () => {
  const { deps, userId, run } = await setup();
  const a = await memory(deps, userId, "They bought boxes.", "2025-12-16T10:00:00Z");
  await memory(deps, userId, "They felt torn.", "2025-12-17T10:00:00Z", { kind: "feeling" });
  await memory(deps, userId, "They packed books.", "2025-12-18T10:00:00Z");
  deps.llm.handlers.user_consolidate = () => ({ gist: "The week of [m1].", times: [] });
  await userConsolidate(deps, run);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_consolidate")!;
  expect(JSON.parse(call.input).sources[0]).toMatchObject({ id: "m1", subject: "user" });
  const gists = await deps.db.execute(sql`SELECT * FROM fact WHERE kind = 'episode'`);
  const gist = gists.rows[0]!;
  expect(gist.payload).toMatchObject({ cites: [a.id] });
  expect(String(gist.content)).toBe(
    "The week of (They bought boxes. ⟦2025-12-16|day|UTC⟧, theirs).",
  );
});
