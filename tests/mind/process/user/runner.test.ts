import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertRun } from "@/db/repos/user/user-mind";
import { runUserLoop } from "@/mind/process/user/runner";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const deps = makeTestDeps();
  const userId = await createTestUser();
  const run = (await insertRun(deps.db, userId, {
    sourceRef: "exchange:x",
    triggers: [{ kind: "make_up_done" }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 3,
  }))!;
  return { deps: { ...deps, snapshot: null }, run };
}

test("a successful loop writes one done trace with its calls", async () => {
  const { deps, run } = await setup();
  deps.llm.handlers.probe = () => ({ ok: true });
  const status = await runUserLoop(deps, run, "user_summarise", async (ctx) => {
    await ctx.deps.llm.classifyJson({
      purpose: "probe",
      model: "user_mind",
      system: "s",
      input: "i",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 1000,
      maxTokens: 10,
    });
    return { inputs: { a: 1 }, outputs: { b: 2 }, promptVersion: "v1" };
  });
  expect(status).toBe("done");
  const rows = await getTestDb().execute(sql`SELECT * FROM user_loop_trace`);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]).toMatchObject({
    loop: "user_summarise",
    status: "done",
    calls: 1,
    prompt_version: "v1",
    run_id: run.id,
    user_id: run.user_id,
  });
});

test("a throwing loop is traced failed with its error class and does not throw", async () => {
  const { deps, run } = await setup();
  class Boom extends Error {}
  const status = await runUserLoop(deps, run, "user_summarise", async () => {
    throw new Boom("secret content");
  });
  expect(status).toBe("failed");
  const rows = await getTestDb().execute(sql`SELECT status, error FROM user_loop_trace`);
  expect(rows.rows[0]).toMatchObject({ status: "failed", error: "Boom" });
  expect(JSON.stringify(rows.rows)).not.toContain("secret content");
});
