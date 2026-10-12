/** A stored message and each delivered bubble are announced once. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { deliverPart } from "@/mind/process/deliver";
import { receiveTurn } from "@/mind/process/receive/receive-turn";
import { closeTestDb, createTestUser, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";
import { recordingModule } from "../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

test("a stored turn is announced once; a retried POST is not announced again", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const userId = await createTestUser("Sam");
  const input = { clientMessageId: randomUUID(), text: "hey" };
  const { turn } = await receiveTurn(deps, userId, input);
  expect((await receiveTurn(deps, userId, input)).existed).toBe(true);
  expect(rec.events).toEqual([{ type: "turn.received", userId, turnId: turn.id }]);
});

test("each delivered bubble is announced with its part", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  await deliverPart(deps, "u1", { turnId: "t1", part: 0, parts: ["hey", "you"] });
  await deliverPart(deps, "u1", { turnId: "t1", part: 1, parts: ["hey", "you"] });
  expect(rec.of("reply.sent")).toEqual([
    { type: "reply.sent", userId: "u1", turnId: "t1", part: 0 },
    { type: "reply.sent", userId: "u1", turnId: "t1", part: 1 },
  ]);
});
