import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveIdeas } from "@/db/repos/user/user-mind";
import { userReflect } from "@/mind/process/user/reflect";
import { userSummarise } from "@/mind/process/user/summarise";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { ideaCutoff, userIdeate } from "@/mind/process/user/ideate";
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
    content: "They have an audition on Friday.",
    embedding: vec(),
    created_at: base.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.2,
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

test("writes one open idea; null writes nothing; live ideas are passed back", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_ideate = sequence(
    { idea: "Ask how the audition went; they were nervous." },
    { idea: null },
  );
  const inputs = await loadRunInputs(deps, userId);
  expect(await userIdeate(deps, run, inputs)).toBe("done");
  expect(await userIdeate(deps, run, inputs)).toBe("done");
  const now = deps.clock.now();
  const ideas = await liveIdeas(deps.db, userId, ideaCutoff(now, 3), 5);
  expect(ideas).toHaveLength(1);
  expect(ideas[0]).toMatchObject({ kind: "idea", subject: "shared", status: "open" });
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate")[1]!;
  expect(JSON.parse(second.input).already_planned).toEqual([
    "Ask how the audition went; they were nervous.",
  ]);
});

test("ideaCutoff is ttl days back", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  expect(ideaCutoff(now, 3).toISOString()).toBe("2026-01-07T00:00:00.000Z");
});

test("only a reflection from this run counts as noticed", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_ideate = () => ({ idea: null });
  const reflect = (content: string, createdAt: Date) =>
    insertFact(deps.db, userId, {
      subject: "user",
      kind: "reflection",
      content,
      embedding: vec(),
      created_at: createdAt,
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const inputs = await loadRunInputs(deps, userId);
  const noticed = () =>
    JSON.parse(deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate").at(-1)!.input)
      .noticed;
  await reflect("An old thought.", new Date(run.created_at.getTime() - 3_600_000));
  await userIdeate(deps, run, inputs);
  expect(noticed()).toBeNull();
  await reflect("A fresh thought.", run.created_at);
  await userIdeate(deps, run, inputs);
  expect(noticed()).toBe("A fresh thought.");
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

test("ideate never sees a sensitive memory, summary or reflection", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence({ reflection: "SECRET-REFLECTION", subject: "user" });
  await sensitiveFact(deps, userId, "SECRET-FACT thinking of ending it");
  const inputs = await loadRunInputs(deps, userId);
  await userSummarise(deps, run, inputs);
  await userReflect(deps, run, inputs);
  await userIdeate(deps, run, inputs);
  const call = deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate").at(-1)!;
  expect(call.input).not.toContain("SECRET");
  expect(call.input).toContain("audition");
  // The only summary read the sensitive memory, so ideate gets none.
  expect(JSON.parse(call.input).summary).toBeNull();
  expect(JSON.parse(call.input).noticed).toBeNull();
});
