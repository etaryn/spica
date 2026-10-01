import { afterAll, beforeEach, expect, test } from "vitest";
import { createHistoryHandler } from "@/app/api/chat/history/handler";
import { createEventsHandler } from "@/app/api/events/handler";
import type { ChatEvent } from "@/core/events";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function readFrames(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const f = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!f.startsWith(":")) frames.push(f);
    }
  }
  await reader.cancel();
  return frames;
}

test("401 without a session", async () => {
  const h = createEventsHandler({
    getUserId: async () => null,
    getDeps: () => makeTestDeps(),
    subscribe: () => () => {},
  });
  expect((await h(new Request("http://x/api/events"))).status).toBe(401);
});

test("streams typing and message events; message text is read from session_log for this user only", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertTurn(getTestDb(), u, {
    id: id(1),
    session_id: SESSION,
    role: "companion",
    text: "WAIT.\n\npromotion??",
    created_at: deps.clock.now(),
  });
  let push: (e: ChatEvent) => void = () => {};
  const h = createEventsHandler({
    getUserId: async () => u,
    getDeps: () => deps,
    subscribe: (_u, fn) => {
      push = fn;
      return () => {};
    },
  });
  const res = await h(new Request("http://x/api/events"));
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const frames = readFrames(res, 3);
  push({ type: "typing", on: true });
  push({ type: "message", turnId: id(1), part: 1 });
  push({ type: "message", turnId: id(999), part: 0 }); // unknown / foreign turn: skipped
  push({ type: "typing", on: false });
  expect(await frames).toEqual([
    `event: typing\ndata: {"type":"typing","on":true}`,
    `event: message\ndata: {"turnId":"${id(1)}","part":1,"of":2,"text":"promotion??","role":"companion","crisisCard":null,"trigger":null}`,
    `event: typing\ndata: {"type":"typing","on":false}`,
  ]);
});

test("onReset closes the stream so EventSource reconnects and the client re-catches-up", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  let reset: (() => void) | undefined;
  const h = createEventsHandler({
    getUserId: async () => u,
    getDeps: () => deps,
    subscribe: (_u, _fn, onReset) => {
      reset = onReset;
      return () => {};
    },
  });
  const res = await h(new Request("http://x/api/events"));
  const reader = res.body!.getReader();
  await reader.read(); // the initial ": connected" comment
  expect(reset).toBeDefined();
  reset!();
  const { done } = await reader.read();
  expect(done).toBe(true);
});

test("a rejecting ready() returns 503 before the stream opens", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const h = createEventsHandler({
    getUserId: async () => u,
    getDeps: () => deps,
    subscribe: () => () => {},
    ready: async () => {
      throw new Error("event hub unavailable");
    },
  });
  const res = await h(new Request("http://x/api/events"));
  expect(res.status).toBe(503);
});

test("history returns turns after the given id, user-scoped", async () => {
  const deps = makeTestDeps();
  const [u, other] = [await createTestUser("u"), await createTestUser("o")];
  for (const [n, role, text] of [
    [1, "user", "hi"],
    [2, "companion", "hey!"],
    [3, "user", "so"],
  ] as const) {
    await insertTurn(getTestDb(), u, {
      id: id(n),
      session_id: SESSION,
      role,
      text,
      created_at: deps.clock.now(),
    });
    deps.clock.advance(1000);
  }
  await insertTurn(getTestDb(), other, {
    id: id(50),
    session_id: SESSION,
    role: "user",
    text: "secret",
    created_at: deps.clock.now(),
  });
  const h = createHistoryHandler({ getUserId: async () => u, getDeps: () => deps });
  const body = await (await h(new Request(`http://x/api/chat/history?after=${id(1)}`))).json();
  expect(body.messages.map((m: { id: string }) => m.id)).toEqual([id(2), id(3)]);
  expect(JSON.stringify(body)).not.toContain("secret");
  expect((await h(new Request("http://x/api/chat/history?after=nope"))).status).toBe(400);
});
