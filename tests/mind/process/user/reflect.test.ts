import { afterAll, beforeEach, expect, test } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { user_loop_trace } from "@/db/schema";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, recentReflections } from "@/db/repos/user/user-mind";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userReflect } from "@/mind/process/user/reflect";
import { closeTestDb, createTestUser, openCrisisWindow, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  await insertFact(base.db, userId, {
    subject: "user",
    kind: "event",
    content: "They quit the band.",
    embedding: vec(),
    created_at: base.clock.now(),
    status: "open",
    salience: 0.9,
    valence: -0.2,
    confidence: 0.9,
    source: "turn",
  });
  const run = (await insertRun(base.db, userId, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: base.clock.now(),
    cap: 9,
  }))!;
  return { deps, userId, run };
}

test("writes one reflection from the run's memories, fitted, with her chosen subject", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence({
    reflection: "They walk away from things right before they matter. ".repeat(20),
    subject: "user",
    times: [],
  });
  expect(await userReflect(deps, run, await loadRunInputs(deps, userId))).toBe("done");
  const [r] = await recentReflections(deps.db, userId, 5);
  expect(r).toMatchObject({ kind: "reflection", subject: "user", source: "generated" });
  expect(r!.content.length).toBeLessThanOrEqual(deps.config.user_mind.reflect.max_chars);
  expect(r!.source_ref).toMatch(/^user_reflect:/);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_reflect")!;
  expect(call.input).toContain("They quit the band.");
  expect(call.input).toContain("She loves old films.");
});

test("null writes nothing and is still done; earlier reflections are passed back", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence(
    { reflection: "They hide hurt behind jokes.", subject: "user", times: [] },
    { reflection: null, subject: "user", times: [] },
  );
  const inputs = await loadRunInputs(deps, userId);
  await userReflect(deps, run, inputs);
  expect(await userReflect(deps, run, inputs)).toBe("done");
  expect(await recentReflections(deps.db, userId, 5)).toHaveLength(1);
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_reflect")[1]!;
  expect(JSON.parse(second.input).already_noticed).toEqual(["They hide hurt behind jokes."]);
});

async function sensitiveFact(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  content: string,
) {
  return insertFact(deps.db, userId, {
    subject: "user",
    kind: "feeling",
    content,
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.95,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
  });
}

test("a reflection that read a sensitive memory is marked; one that didn't is not", async () => {
  const { deps, userId, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  deps.llm.handlers.user_reflect = sequence(
    { reflection: "They quit things before they matter.", subject: "user", times: [] },
    { reflection: "They carry more than they show.", subject: "user", times: [] },
  );
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  expect((await recentReflections(deps.db, userId, 1))[0]!.payload).toBeNull();

  deps.clock.advance(60_000);
  await sensitiveFact(deps, userId, "They said they'd been thinking of ending it.");
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  expect((await recentReflections(deps.db, userId, 1))[0]!.payload).toMatchObject({
    sensitive: true,
  });
});

test("a reflection that read a sensitive earlier reflection is marked too", async () => {
  const { deps, userId, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  deps.llm.handlers.user_reflect = sequence({
    reflection: "They keep going quiet.",
    subject: "user",
    times: [],
  });
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "reflection",
    content: "They were in a very dark place.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.clock.advance(60_000);
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  const [latest] = await recentReflections(deps.db, userId, 1);
  expect(latest!.content).toBe("They keep going quiet.");
  expect(latest!.payload).toMatchObject({ sensitive: true });
});

test("outside a crisis window a sensitive earlier reflection isn't shown, and nothing is marked", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence({
    reflection: "They keep going quiet.",
    subject: "user",
    times: [],
  });
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "reflection",
    content: "They were in a very dark place.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.clock.advance(60_000);
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_reflect")!;
  expect(call.input).not.toContain("dark place");
  expect((await recentReflections(deps.db, userId, 1))[0]!.payload).toBeNull();
});

const latestTrace = async (deps: ReturnType<typeof makeTestDeps>, u: string, loop: string) =>
  (
    await deps.db
      .select()
      .from(user_loop_trace)
      .where(and(eq(user_loop_trace.user_id, u), eq(user_loop_trace.loop, loop)))
      .orderBy(desc(user_loop_trace.created_at))
      .limit(1)
  )[0];

test("a reflection about them that cites only her own life isn't written", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "self",
    kind: "event",
    content: "telescope booking, planned",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.99,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_reflect = () => ({
    reflection: "They seem really into [m1].",
    subject: "user",
    times: [],
  });
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  expect(await recentReflections(deps.db, userId, 5)).toEqual([]);
  const trace = await latestTrace(deps, userId, "user_reflect");
  expect(trace!.outputs).toMatchObject({ reflection_id: null, not_written: "subject_mismatch" });
});

test("an uncited reflection is written; a cited one keeps its cites", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence(
    { reflection: "I get the sense they like plans.", subject: "user", times: [] },
    { reflection: "They light up about [m1].", subject: "user", times: [] },
  );
  const inputs = await loadRunInputs(deps, userId);
  await userReflect(deps, run, inputs);
  await userReflect(deps, run, inputs);
  const rows = await recentReflections(deps.db, userId, 5);
  expect(rows.map((r) => r.payload)).toEqual(
    expect.arrayContaining([null, { cites: [inputs.facts[0]!.id] }]),
  );
});
