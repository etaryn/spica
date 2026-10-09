import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, recentReflections } from "@/db/repos/user/user-mind";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userReflect } from "@/mind/process/user/reflect";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
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
    { reflection: "They hide hurt behind jokes.", subject: "user" },
    { reflection: null, subject: "user" },
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
  deps.llm.handlers.user_reflect = sequence(
    { reflection: "They quit things before they matter.", subject: "user" },
    { reflection: "They carry more than they show.", subject: "user" },
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
  deps.llm.handlers.user_reflect = sequence({
    reflection: "They keep going quiet.",
    subject: "user",
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
