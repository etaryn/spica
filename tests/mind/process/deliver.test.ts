import { expect, test } from "vitest";
import { deliverPart } from "@/mind/process/deliver";
import { makeTestDeps } from "../../helpers/deps";

test("emits the SSE part, then pushes with the parts so far under one tag", async () => {
  const deps = makeTestDeps();
  await deliverPart(deps, "u1", { turnId: "t1", part: 0, parts: ["hey", "how did it go?"] });
  await deliverPart(deps, "u1", { turnId: "t1", part: 1, parts: ["hey", "how did it go?"] });
  expect(deps.events.events.map((e) => e.event)).toEqual([
    { type: "message", turnId: "t1", part: 0 },
    { type: "message", turnId: "t1", part: 1 },
  ]);
  expect(deps.pusher.pushes).toEqual([
    { userId: "u1", msg: { tag: "t1", body: "hey", url: "/chat" } },
    { userId: "u1", msg: { tag: "t1", body: "hey\nhow did it go?", url: "/chat" } },
  ]);
});

test("generic: the push body is push.generic_body, never the message text; SSE is unchanged", async () => {
  const deps = makeTestDeps();
  await deliverPart(deps, "u1", {
    turnId: "t1",
    part: 0,
    parts: ["please call 988"],
    generic: true,
  });
  expect(deps.events.events.map((e) => e.event)).toEqual([
    { type: "message", turnId: "t1", part: 0 },
  ]);
  expect(deps.pusher.pushes).toEqual([
    { userId: "u1", msg: { tag: "t1", body: deps.config.push.generic_body, url: "/chat" } },
  ]);
});

test("a rejected or hanging push never fails or delays delivery", async () => {
  const deps = makeTestDeps({ push: { timeout_ms: 10 } });
  deps.pusher.failNext = true;
  await expect(
    deliverPart(deps, "u1", { turnId: "t", part: 0, parts: ["a"] }),
  ).resolves.toBeUndefined();
  const hanging = { push: () => new Promise<void>(() => {}) };
  const started = Date.now();
  await deliverPart({ ...deps, pusher: hanging }, "u1", { turnId: "t", part: 0, parts: ["a"] });
  expect(Date.now() - started).toBeLessThan(50); // not awaited in the pacing path
});

test("M3: the push body is capped at push.body_max_chars with an ellipsis (Web Push payload limit); SSE is untouched", async () => {
  const deps = makeTestDeps({ push: { body_max_chars: 10 } });
  await deliverPart(deps, "u1", { turnId: "t", part: 1, parts: ["hey there", "how did it go?"] });
  expect(deps.pusher.pushes[0]!.msg.body).toBe("hey there…");
  expect([...deps.pusher.pushes[0]!.msg.body].length).toBe(10);
  await deliverPart(deps, "u1", { turnId: "u", part: 0, parts: ["😀😀😀😀😀😀😀😀😀😀😀😀"] }); // never splits a surrogate pair
  expect(deps.pusher.pushes[1]!.msg.body).toBe("😀😀😀😀😀😀😀😀😀…");
  await deliverPart(deps, "u1", { turnId: "v", part: 0, parts: ["short"] });
  expect(deps.pusher.pushes[2]!.msg.body).toBe("short");
  expect(deps.events.events).toHaveLength(3);
});

test("push.enabled false: SSE only", async () => {
  const deps = makeTestDeps({ push: { enabled: false } });
  await deliverPart(deps, "u1", { turnId: "t", part: 0, parts: ["a"] });
  expect(deps.pusher.pushes).toEqual([]);
  expect(deps.events.events).toHaveLength(1);
});
