import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { createChatHandler } from "@/app/api/chat/handler";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const post = (body: unknown) =>
  new Request("http://x/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

test("401 without a session", async () => {
  const h = createChatHandler({ getUserId: async () => null, getDeps: () => makeTestDeps() });
  expect((await h(post({ clientMessageId: randomUUID(), text: "hi" }))).status).toBe(401);
});

test("400 on malformed body", async () => {
  const u = await createTestUser();
  const h = createChatHandler({ getUserId: async () => u, getDeps: () => makeTestDeps() });
  expect((await h(post({ clientMessageId: "not-a-uuid", text: "hi" }))).status).toBe(400);
  expect((await h(new Request("http://x", { method: "POST", body: "{" }))).status).toBe(400);
  expect((await h(post({ clientMessageId: randomUUID(), text: "   " }))).status).toBe(400);
});

test("202 accepts a normal message; the reply arrives later over SSE", async () => {
  const u = await createTestUser();
  const deps = makeTestDeps();
  const h = createChatHandler({ getUserId: async () => u, getDeps: () => deps });
  const res = await h(post({ clientMessageId: randomUUID(), text: "hi there friend" }));
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ status: "accepted" });
});

test("200 returns a crisis reply immediately, with the card", async () => {
  const u = await createTestUser();
  const deps = makeTestDeps();
  deps.llm.classify = () => ({ flag: true, category: "self_harm" });
  deps.llm.replies.push("I'm here with you.");
  const h = createChatHandler({ getUserId: async () => u, getDeps: () => deps });
  const res = await h(post({ clientMessageId: randomUUID(), text: "i want to end my life" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "replied",
    parts: ["I'm here with you."],
    crisisCard: { title: expect.any(String) },
  });
});

test("503 carries crisisCard when the reply fails on a flagged message", async () => {
  const u = await createTestUser();
  const deps = makeTestDeps();
  deps.llm.failReplies = 1;
  deps.llm.classify = () => ({ flag: true, category: "self_harm" });
  const h = createChatHandler({ getUserId: async () => u, getDeps: () => deps });
  const res = await h(post({ clientMessageId: randomUUID(), text: "I want to end my life" }));
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toBe("reply_failed");
  expect(body.crisisCard.lines.length).toBeGreaterThan(0);
});

test("409 on another user's message id", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const deps = makeTestDeps();
  const id = randomUUID();
  await createChatHandler({ getUserId: async () => a, getDeps: () => deps })(
    post({ clientMessageId: id, text: "a" }),
  );
  const res = await createChatHandler({ getUserId: async () => b, getDeps: () => deps })(
    post({ clientMessageId: id, text: "b" }),
  );
  expect(res.status).toBe(409);
});

test("timezone is accepted in the body", async () => {
  const u = await createTestUser();
  const h = createChatHandler({ getUserId: async () => u, getDeps: () => makeTestDeps() });
  expect(
    (await h(post({ clientMessageId: randomUUID(), text: "hi", timezone: "Europe/London" })))
      .status,
  ).toBe(202);
  expect((await h(post({ clientMessageId: randomUUID(), text: "hi", timezone: 42 }))).status).toBe(
    400,
  );
});
