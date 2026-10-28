/** Two local nights exercise the core-only nightly pipeline and its durable evidence. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  core_loop_trace,
  core_memory,
  core_self_line,
  core_snapshot,
  drift_log,
  session_log,
  world_event,
} from "@/db/schema";
import { insertTurn } from "@/db/repos/user/session-log";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreNightly } from "@/mind/process/core/nightly";
import { closeTestDb, createTestUser, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const first = new Date("2026-01-20T19:00:00Z"); // Jan 21, 03:00 in Singapore.
const second = new Date("2026-01-21T19:00:00Z");
const old = new Date("2026-01-05T09:00:00Z");
const canary = "CANARY-8c91a7";

test("two nights render self, track drift, gist once, decay selectively and keep users separate", async () => {
  const all = makeTestDeps();
  const core = coreDepsOf(all);
  await seedSnapshot(core);
  const alice = await createTestUser("alice");
  const bob = await createTestUser("bob");
  await insertTurn(all.db, alice, {
    id: "00000000-0000-4000-8000-000000000011",
    session_id: "00000000-0000-4000-8000-000000000001",
    role: "user",
    text: `Alice's private word is ${canary}.`,
    created_at: old,
  });
  await insertTurn(all.db, bob, {
    id: "00000000-0000-4000-8000-000000000012",
    session_id: "00000000-0000-4000-8000-000000000002",
    role: "user",
    text: "Bob asks about the stars.",
    created_at: old,
  });

  async function memory(
    kind: "episode" | "intention" | "narrative",
    content: string,
    status: "resolved" | "open" | "recurring",
    source_ref: string | null = null,
  ) {
    return core.core.memory.insert({
      kind,
      content,
      embedding: vec(),
      occurred_at: old,
      created_at: old,
      status,
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: source_ref ? "world" : "loop",
      source_ref,
    });
  }
  const sourceIds = [];
  sourceIds.push(await memory("episode", "She watched an old film on Monday.", "resolved"));
  sourceIds.push(await memory("episode", "She read a star atlas on Tuesday.", "resolved"));
  sourceIds.push(await memory("episode", "She discussed the night sky on Wednesday.", "resolved"));
  const ordinary = await memory("episode", "An older solitary memory.", "open");
  const intention = await memory("intention", "She plans to read again.", "open");
  const narrative = await memory(
    "narrative",
    "She is learning to notice small things.",
    "recurring",
  );
  const preoccupied = await memory("episode", "A recurring concern.", "open");
  const goalId = await core.core.goals.insert({
    title: "Study the sky",
    why: "She wants to understand the stars.",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: "exit",
    started_at: old,
    target_at: null,
    embedding: vec(),
  });
  const eventId = "00000000-0000-4000-8000-000000000021";
  await all.db.insert(world_event).values({
    id: eventId,
    at: old,
    kind: "planned",
    content: "Spica studies a star chart.",
    valence: 0.2,
    stakes: "low",
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    goal_ref: goalId,
    created_at: old,
  });
  const goalLinked = await memory(
    "episode",
    "A goal-linked but unresolved episode.",
    "open",
    `world_event:${eventId}`,
  );
  await core.core.state.ensure(all.config.core.state.baseline, {
    autonomy: 0.5,
    competence: 0.5,
  });
  await core.core.state.update({ preoccupation: preoccupied, preoccupation_since: first });

  expect(await coreNightly(core, first)).toBe(true);
  expect(await coreNightly(core, first)).toBe(false);
  expect(await coreNightly(core, second)).toBe(true);

  const snapshots = await all.db.select().from(core_snapshot);
  expect(snapshots.map((row) => row.version).sort()).toEqual([0, 1, 2]);
  const lines = await all.db.select().from(core_self_line);
  for (const version of [1, 2]) {
    const snapshot = snapshots.find((row) => row.version === version)!;
    const versionLines = lines.filter((line) => line.version === version);
    expect(versionLines.length).toBeGreaterThan(0);
    expect(snapshot.content).toContain("### Habits of speech");
    for (const line of versionLines) expect(snapshot.content).toContain(line.text);
    const drift = (await all.db.select().from(drift_log)).filter((row) => row.version === version);
    expect(drift.map((row) => row.check).sort()).toEqual(["diff", "trend", "values"]);
    expect(drift.find((row) => row.check === "values")?.verdict).toBe("ok");
    for (const check of ["diff", "trend"])
      expect(Number.isFinite(drift.find((row) => row.check === check)?.score)).toBe(true);
  }

  const memories = await all.db.select().from(core_memory);
  const gists = memories.filter((row) => row.source_ref?.startsWith("core_consolidate:"));
  expect(gists).toHaveLength(1);
  expect((gists[0]!.payload as { gist_of: string[] }).gist_of).toEqual(
    expect.arrayContaining(sourceIds),
  );
  for (const id of sourceIds)
    expect((await core.core.memory.get(id))?.payload).toMatchObject({ gisted_into: gists[0]!.id });
  expect((await core.core.memory.get(ordinary))!.salience).toBeLessThan(0.5);
  for (const id of [intention, narrative, preoccupied, goalLinked])
    expect((await core.core.memory.get(id))!.salience).toBe(0.5);

  const traces = await all.db.select().from(core_loop_trace);
  for (const night of [first, second]) {
    const daily = traces.filter(
      (row) => row.created_at.toISOString().slice(0, 10) === night.toISOString().slice(0, 10),
    );
    expect(daily.reduce((sum, row) => sum + row.calls, 0)).toBeLessThanOrEqual(24);
    expect(daily.map((row) => row.loop)).toEqual([
      "core_reflect",
      "core_consolidate",
      "core_render_snapshot",
      "core_drift_watch",
    ]);
  }
  expect(all.llm.structuredCalls.map((call) => call.purpose).sort()).toEqual(
    [
      "core_consolidate",
      "core_drift_watch",
      "core_drift_watch",
      "core_reflect",
      "core_reflect",
      "core_render_snapshot",
      "core_render_snapshot",
    ].sort(),
  );
  const reflectCalls = all.llm.structuredCalls.filter((call) => call.purpose === "core_reflect");
  expect(reflectCalls).toHaveLength(2);
  // The model sees memories under m-ids, so the gist is found by its words.
  expect(
    JSON.parse(reflectCalls[1]!.input).inputs.map((item: { content: string }) => item.content),
  ).toContain(gists[0]!.content);
  for (const call of all.llm.structuredCalls)
    expect(`${call.system}\n${call.input}`).not.toContain(canary);
  for (const table of [
    "core_memory",
    "core_goal",
    "core_state",
    "core_snapshot",
    "core_self_line",
    "drift_log",
    "core_loop_trace",
    "world_event",
  ]) {
    const rows = await all.db.execute(
      sql.raw(`SELECT row_to_json(x)::text AS row FROM ${table} x`),
    );
    expect(JSON.stringify(rows.rows), table).not.toContain(canary);
  }
  expect(
    (await all.db.select().from(session_log).where(eq(session_log.user_id, alice)))[0]!.text,
  ).toContain(canary);
  expect(
    JSON.stringify(await all.db.select().from(session_log).where(eq(session_log.user_id, bob))),
  ).not.toContain(canary);
});
