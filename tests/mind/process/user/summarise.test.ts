import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { forgetFact, insertFact } from "@/db/repos/user/facts";
import { insertThread } from "@/db/repos/user/threads";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
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

test("writes one live summary from the user's memories and her snapshot", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  expect(await userSummarise(deps, await run("exchange:a"))).toBe("done");
  const s = (await liveSummary(deps.db, userId))!;
  expect(s).toMatchObject({ kind: "summary", subject: "shared", source: "generated" });
  expect(s.content).toContain("Osaka");
  expect(s.content).not.toContain("Private crisis");
  expect(s.payload).toHaveProperty("how_i_feel");
  const prompt = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  expect(prompt.input).toContain("She loves old films.");
});

test("a second run supersedes the first; one stays live", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:a"));
  const first = (await liveSummary(deps.db, userId))!;
  deps.clock.advance(60_000);
  await fact("They moved to Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:b"));
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

test("after the user deletes the summary, the next run writes a fresh one", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:a"));
  await forgetFact(deps.db, userId, (await liveSummary(deps.db, userId))!.id);
  expect(await liveSummary(deps.db, userId)).toBeNull();
  expect(await userSummarise(deps, await run("exchange:b"))).toBe("done");
  expect(await liveSummary(deps.db, userId)).not.toBeNull();
});

test("overlong parts are fitted; empty output fails and keeps the old summary", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "x".repeat(900),
    whats_live: "a",
    how_i_feel: "b",
  });
  expect(await userSummarise(deps, await run("exchange:a"))).toBe("done");
  const kept = (await liveSummary(deps.db, userId))!;
  expect((kept.payload as { where_things_stand: string }).where_things_stand.length).toBe(
    deps.config.user_mind.summarise.max_chars,
  );
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "",
    whats_live: "",
    how_i_feel: "",
  });
  expect(await userSummarise(deps, await run("exchange:b"))).toBe("failed");
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
  await userSummarise(deps, await run("exchange:a"));
  const input = JSON.parse(
    deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!.input,
  );
  expect(input.open_threads).toEqual(["The Osaka move"]);
});

test("a memory committed after a summary but dated before it is still summarised, once", async () => {
  const { deps, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  deps.clock.advance(60_000);
  await userSummarise(deps, await run("exchange:a"));
  deps.clock.advance(60_000);
  // A late cold path: the exchange began before the summary, so its fact is dated then.
  await fact("They adopted a cat.", 0.8, null, {
    created_at: new Date(deps.clock.now().getTime() - 90_000),
  });
  await userSummarise(deps, await run("exchange:b"));
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise")[1]!;
  const contents = JSON.parse(second.input).new_memories.map((m: { content: string }) => m.content);
  expect(contents).toEqual(["They adopted a cat."]);
});
