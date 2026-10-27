import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { insertThread } from "@/db/repos/user/threads";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userSummarise } from "@/mind/process/user/summarise";
import { nowLine } from "@/mind/platform/time-anchors";
import { dateToken, written } from "@/mind/platform/time-anchors";
import {
  closeTestDb,
  createTestUser,
  getTestDb,
  openCrisisWindow,
  resetDb,
  vec,
} from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  const fact = (
    content: string,
    salience: number,
    payload: object | null = null,
    extra: { thread_id?: string; created_at?: Date } = {},
  ) =>
    insertFact(base.db, userId, {
      subject: "user",
      kind: "event",
      content,
      payload,
      embedding: vec(),
      created_at: base.clock.now(),
      status: "open",
      salience,
      valence: 0.2,
      confidence: 0.9,
      source: "turn",
      ...extra,
    });
  const run = async (ref: string) =>
    (await insertRun(base.db, userId, {
      sourceRef: ref,
      triggers: [{ kind: "salient_fact", salience: 0.9 }],
      localDate: "2026-01-05",
      now: base.clock.now(),
      cap: 9,
    }))!;
  return { deps, userId, fact, run };
}

test("outside a crisis window, nothing sensitive is read and the summary is unmarked", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const s = (await liveSummary(deps.db, userId))!;
  expect(s).toMatchObject({ kind: "summary", subject: "shared", source: "generated" });
  expect(s.content).toContain("Osaka");
  expect(s.content).not.toContain("Private crisis");
  expect(s.payload).not.toHaveProperty("sensitive");
  const prompt = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  expect(prompt.input).toContain("She loves old films.");
});

test("inside a crisis window, sensitive memories are read and the summary is marked", async () => {
  const { deps, userId, fact, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const s = (await liveSummary(deps.db, userId))!;
  expect(s.content).toContain("Private crisis");
  expect(s.payload).toMatchObject({ sensitive: true });
});

test("after the window, a fact a marked summary read is still unread for the clean chain", async () => {
  const { deps, userId, fact, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  await fact("They started a pottery class.", 0.7);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  deps.clock.advance(2 * 3_600_000);
  const after = await loadRunInputs(deps, userId);
  expect(after.clean).toBe(true);
  expect(after.facts.map((f) => f.content)).toEqual(["They started a pottery class."]);
  expect(after.previous).toBeNull();
});

test("a fact a busy run left out is read by the next run", async () => {
  const { deps, userId, fact, run } = await setup();
  const max = deps.config.user_mind.summarise.max_facts;
  for (let i = 0; i < max; i++) await fact(`Heavy fact ${i}.`, 0.9);
  await fact("A light fact.", 0.2);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  deps.clock.advance(60_000);
  const next = await loadRunInputs(deps, userId);
  expect(next.facts.map((f) => f.content)).toEqual(["A light fact."]);
});

test("a second run supersedes the first; one stays live", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const first = (await liveSummary(deps.db, userId))!;
  deps.clock.advance(60_000);
  await fact("They moved to Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:b"), await loadRunInputs(deps, userId));
  const res = await getTestDb().execute(
    sql`SELECT id, status, superseded_by FROM fact WHERE kind = 'summary' ORDER BY created_at`,
  );
  expect(res.rows).toHaveLength(2);
  expect(res.rows[0]).toMatchObject({ id: first.id, status: "superseded" });
  expect(res.rows[0]!.superseded_by).toBe(res.rows[1]!.id);
  // The second prompt saw only the memory after the first summary, plus the previous summary.
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise")[1]!;
  expect(second.input).toContain("They moved to Osaka.");
  expect(second.input).not.toContain('"content":"They got the job in Osaka."');
  expect(JSON.parse(second.input).previous).not.toBeNull();
});

test("overlong parts are fitted; empty output fails and keeps the old summary", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "x".repeat(900),
    whats_live: "a",
    how_i_feel: "b",
    times: [],
  });
  expect(
    await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId)),
  ).toBe("done");
  const kept = (await liveSummary(deps.db, userId))!;
  expect((kept.payload as { where_things_stand: string }).where_things_stand.length).toBe(
    deps.config.user_mind.summarise.max_chars,
  );
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "",
    whats_live: "",
    how_i_feel: "",
    times: [],
  });
  expect(
    await userSummarise(deps, await run("exchange:b"), await loadRunInputs(deps, userId)),
  ).toBe("failed");
  expect((await liveSummary(deps.db, userId))!.id).toBe(kept.id);
});

test("a thread whose latest memory is sensitive stays out of the summary", async () => {
  const { deps, userId, fact, run } = await setup();
  const now = deps.clock.now();
  const thread = (title: string) =>
    insertThread(
      deps.db,
      userId,
      { title, subject: "user", stakes: "med", next_checkpoint: null },
      now,
    );
  const open = await thread("The Osaka move");
  const hidden = await thread("The hospital stay");
  await fact("Packing for Osaka.", 0.5, null, { thread_id: open.id });
  await fact("Back in hospital.", 0.5, { sensitive: true }, { thread_id: hidden.id });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const input = JSON.parse(
    deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!.input,
  );
  expect(input.open_threads).toEqual([{ id: "t1", thread: "The Osaka move" }]);
});

test("a memory committed after a summary but dated before it is still summarised, once", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  deps.clock.advance(60_000);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  deps.clock.advance(60_000);
  // A late cold path: the exchange began before the summary, so its fact is dated then.
  await fact("They adopted a cat.", 0.8, null, {
    created_at: new Date(deps.clock.now().getTime() - 90_000),
  });
  await userSummarise(deps, await run("exchange:b"), await loadRunInputs(deps, userId));
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise")[1]!;
  const contents = JSON.parse(second.input).new_memories.map((m: { content: string }) => m.content);
  expect(contents).toEqual(["They adopted a cat."]);
});

test("inside a crisis window a sensitive memory marks the summary, and the mark carries", async () => {
  const { deps, userId, fact, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  await fact("They said they'd been thinking of ending it.", 0.9, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise").at(-1)!;
  expect(call.input).toContain("thinking of ending it");
  const first = (await liveSummary(deps.db, userId))!;
  expect(first.payload).toMatchObject({ sensitive: true });

  deps.clock.advance(60_000);
  await fact("They started a pottery class.", 0.9);
  await userSummarise(deps, await run("exchange:b"), await loadRunInputs(deps, userId));
  const second = (await liveSummary(deps.db, userId))!;
  expect(second.id).not.toBe(first.id);
  expect(second.payload).toMatchObject({ sensitive: true });
});

test("a summary from ordinary memories is not marked", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They started a pottery class.", 0.9);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  expect((await liveSummary(deps.db, userId))!.payload).not.toHaveProperty("sensitive");
});

test("the loop sees now and each memory's date, in their zone", async () => {
  const { deps, userId, run } = await setup();
  const at = new Date("2026-01-08T14:00:00Z");
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "They have an interview.",
    embedding: vec(),
    created_at: deps.clock.now(),
    occurred_at: at,
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  await userSummarise(deps, await run("exchange:d"), await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  const input = JSON.parse(call.input);
  expect(input.now).toBe(nowLine(deps.clock.now(), "UTC", "Asia/Singapore"));
  expect(input.new_memories).toContainEqual(
    expect.objectContaining({
      content: "They have an interview.",
      when: dateToken(at, "UTC"),
    }),
  );
});

test("summarise reads a stamped previous note and dated threads; no zone means UTC", async () => {
  const { deps, userId, run } = await setup();
  const now = deps.clock.now();
  const D = 86_400_000;
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "Their sister is visiting.",
    embedding: vec(),
    created_at: now,
    occurred_at: new Date(now.getTime() + 2 * D),
    status: "open",
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  await insertFact(deps.db, userId, {
    subject: "shared",
    kind: "summary",
    content: "old",
    payload: { where_things_stand: "a", whats_live: "sister visits tomorrow", how_i_feel: "c" },
    embedding: vec(),
    created_at: new Date(now.getTime() - 2 * D),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  await insertThread(
    deps.db,
    userId,
    {
      title: "sister's visit",
      subject: "user",
      stakes: "med",
      next_checkpoint: new Date(now.getTime() + 2 * D),
    },
    now,
  );
  await userSummarise(deps, await run("exchange:t"), await loadRunInputs(deps, userId));
  const input = JSON.parse(
    deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise").at(-1)!.input,
  );
  const sat = dateToken(new Date(now.getTime() + 2 * D), "UTC");
  expect(input.new_memories).toContainEqual(
    expect.objectContaining({
      content: "Their sister is visiting.",
      when: sat,
    }),
  );
  expect(input.previous.written).toBe(written(new Date(now.getTime() - 2 * D), "UTC"));
  // No memory on the thread yet, so only when to ask shows.
  expect(input.open_threads).toContainEqual({
    id: "t1",
    thread: `sister's visit (ask after ${sat})`,
  });
});

test("a summary cites a memory by id and labels its own time words", async () => {
  const { deps, userId, fact, run } = await setup();
  const interview = await fact('design interview, planned — the user said "thursday"', 0.9);
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "They have [m1] coming up.",
    whats_live: "Check in tonight.",
    how_i_feel: "Fond of them.",
    times: [
      {
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
      },
    ],
  });
  await userSummarise(deps, await run("exchange:c"), await loadRunInputs(deps, userId));
  const s = (await liveSummary(deps.db, userId))!;
  expect(s.payload).toMatchObject({
    where_things_stand: "They have (design interview, planned, theirs) coming up.",
    whats_live: "Check in ⟦2026-01-05|night|UTC|tonight⟧.",
    cites: [interview.id],
  });
  expect(s.content).toContain(", theirs)");
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  expect(JSON.parse(call.input).new_memories[0].id).toBe("m1");
  expect(call.system).toContain("## Citing and times");
});

test("the next summary is shown what the last one cited, by id", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("design interview, planned", 0.9);
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "They have [m1].",
    whats_live: "Nothing open.",
    how_i_feel: "Fond.",
    times: [],
  });
  await userSummarise(deps, await run("exchange:d"), await loadRunInputs(deps, userId));
  await fact("they bought a plant", 0.5);
  await userSummarise(deps, await run("exchange:e"), await loadRunInputs(deps, userId));
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise")[1]!;
  const input = JSON.parse(second.input);
  expect(input.new_memories.map((m: { content: string }) => m.content)).toEqual([
    "they bought a plant",
  ]);
  expect(input.earlier_memories).toEqual([
    expect.objectContaining({ id: "m2", content: "design interview, planned" }),
  ]);
});
