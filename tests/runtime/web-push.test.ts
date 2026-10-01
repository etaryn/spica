import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { WebPushPusher } from "@/runtime/web-push";
import { listPushSubscriptions, upsertPushSubscription } from "@/db/repos/push";
import { silentLogger } from "@/core/log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const cfg = {
  publicKey: "pub",
  privateKey: "priv",
  subject: "mailto:x@y.z",
  ttlSeconds: 60,
  timeoutMs: 1000,
};
const t = new Date("2026-01-05T09:00:00Z");

test("sends to every subscription of the user with the payload, and deletes on 404/410", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await upsertPushSubscription(db, u, { endpoint: "https://p/1", p256dh: "a", auth: "b" }, t);
  await upsertPushSubscription(db, u, { endpoint: "https://p/2", p256dh: "c", auth: "d" }, t);
  const send = vi.fn(async (sub: { endpoint: string }, _payload?: string, _opts?: unknown) => {
    if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return { statusCode: 201 };
  });
  await new WebPushPusher(db, cfg, silentLogger, send as never).push(u, {
    tag: "t1",
    body: "hey",
    url: "/chat",
  });
  expect(send).toHaveBeenCalledTimes(2);
  const [sub, payload, opts] = send.mock.calls[0]!;
  expect(sub).toMatchObject({ endpoint: "https://p/1", keys: { p256dh: "a", auth: "b" } });
  expect(JSON.parse(payload as string)).toEqual({
    title: "Spica",
    tag: "t1",
    body: "hey",
    url: "/chat",
  });
  expect(opts).toMatchObject({
    TTL: 60,
    vapidDetails: { subject: cfg.subject, publicKey: "pub", privateKey: "priv" },
  });
  expect((await listPushSubscriptions(db, u)).map((s) => s.endpoint)).toEqual(["https://p/1"]);
});

test("other errors keep the subscription and don't throw", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await upsertPushSubscription(db, u, { endpoint: "https://p/1", p256dh: "a", auth: "b" }, t);
  const send = vi.fn(async () => {
    throw Object.assign(new Error("5xx"), { statusCode: 503 });
  });
  await expect(
    new WebPushPusher(db, cfg, silentLogger, send as never).push(u, {
      tag: "t",
      body: "x",
      url: "/chat",
    }),
  ).resolves.toBeUndefined();
  expect(await listPushSubscriptions(db, u)).toHaveLength(1);
});
