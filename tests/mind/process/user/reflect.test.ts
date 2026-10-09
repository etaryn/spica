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
