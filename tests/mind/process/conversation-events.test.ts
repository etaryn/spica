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

test("a message and a crisis reply never wait on a module", async () => {
  const hang = () => new Promise<void>(() => {});
  const seen: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "stuck",
      scope: "user",
      on: {
        "turn.received": async (e) => {
          seen.push(e.type);
          await hang();
        },
        "reply.sent": async (e) => {
          seen.push(e.type);
          await hang();
        },
      },
    },
  ]);
  const userId = await createTestUser("Sam");
  const settled = <T>(p: Promise<T>) =>
    Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
  const input = { clientMessageId: randomUUID(), text: "hey" };
  expect(await settled(receiveTurn(deps, userId, input))).toBe(true);
  const crisis = { turnId: "t1", part: 0, parts: ["here for you"], generic: true };
  expect(await settled(deliverPart(deps, userId, crisis))).toBe(true);
  expect(seen).toEqual(["turn.received", "reply.sent"]);
});
