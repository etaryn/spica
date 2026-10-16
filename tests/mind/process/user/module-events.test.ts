/**
 * A user-mind run is announced once when it is claimed, and every fact its loops wrote is
 * announced; so is every profile card fact.
 */
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import * as s from "@/db/schema";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { submitCard } from "@/mind/process/onboarding/submit";
import { recordBigEvents, runUserMind } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

test("a run is announced once when claimed, with every fact its loops wrote", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They passed the exam.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", [
    { kind: "salient_fact", salience: 0.9 },
  ]))!;
  expect(await runUserMind(deps, { runId })).toBe("done");
  expect(await runUserMind(deps, { runId })).toBe("skipped");
  expect(rec.of("user_mind.triggered")).toEqual([
    { type: "user_mind.triggered", userId: u, runId, triggers: ["salient_fact"] },
  ]);
  const generated = await getTestDb()
    .select({ id: s.fact.id, kind: s.fact.kind })
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "generated")));
  expect(generated.length).toBeGreaterThan(0);
  const announced = rec.of("fact.written").map((e) => ({ id: e.factId, kind: e.kind }));
  expect(announced.sort(byId)).toEqual(generated.sort(byId));
});

test("every profile card fact is announced after the card is saved", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser("Sam");
  const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
  let w = 0;
  const answers = Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? 0 : ["a", "b", "c"][w++]!]),
  );
  const r = await submitCard(
    deps,
    { id: u, name: "Sam", gender: "unspecified" },
    { quiz_version: "v1", answers },
  );
  expect(r.status).toBe(201);
  const cards = await getTestDb()
    .select({ id: s.fact.id, kind: s.fact.kind })
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "onboarding")));
  const announced = rec.of("fact.written").map((e) => ({ id: e.factId, kind: e.kind }));
  expect(announced.sort(byId)).toEqual(cards.sort(byId));
  expect(cards.length).toBeGreaterThan(0);
});
