import { afterAll, beforeEach, expect, test } from "vitest";
import { createPushHandler } from "@/app/api/push/subscribe/handler";
import { listPushSubscriptions } from "@/db/repos/push";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const req = (method: string, body: unknown) => new Request("http://x/api/push/subscribe", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

test("401 without a session; 400 on a bad body", async () => {
  const deps = makeTestDeps();
  const h = createPushHandler({ getUserId: async () => null, getDeps: () => deps });
  expect((await h.POST(req("POST", sub))).status).toBe(401);
  const u = await createTestUser();
  const h2 = createPushHandler({ getUserId: async () => u, getDeps: () => deps });
  expect((await h2.POST(req("POST", { endpoint: "not a url" }))).status).toBe(400);
});

test("review focus 4: subscribe is scoped to the caller; unsubscribe removes only the caller's endpoint", async () => {
  const deps = makeTestDeps();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const asA = createPushHandler({ getUserId: async () => a, getDeps: () => deps });
  const asB = createPushHandler({ getUserId: async () => b, getDeps: () => deps });
  expect((await asA.POST(req("POST", sub))).status).toBe(204);
  expect((await asB.DELETE(req("DELETE", { endpoint: sub.endpoint }))).status).toBe(204); // no-op for b
  expect(await listPushSubscriptions(deps.db, a)).toHaveLength(1);
  expect((await asB.POST(req("POST", sub))).status).toBe(204); // same browser, now b's
  expect(await listPushSubscriptions(deps.db, a)).toHaveLength(0);
  expect((await asB.DELETE(req("DELETE", { endpoint: sub.endpoint }))).status).toBe(204);
  expect(await listPushSubscriptions(deps.db, b)).toHaveLength(0);
});
