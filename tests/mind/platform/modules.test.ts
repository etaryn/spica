/** The bus refuses a core module that would hear a user, and one bad module never stops the rest. */
import { afterAll, expect, test, vi } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import type { Module } from "@/mind/platform/modules";
import { closeTestDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

afterAll(closeTestDb);

const turn = { type: "turn.received", userId: "u1", turnId: "t1" } as const;
const snapshot = { type: "core.snapshot", version: 3 } as const;

test("a core module that lists a user event is refused", () => {
  const leaky = {
    name: "leaky",
    scope: "core",
    on: { "turn.received": async () => {} },
  } as unknown as Module;
  expect(() => makeTestDeps({}, [leaky])).toThrow("core module leaky cannot hear turn.received");
});

test("two modules with one name are refused", () => {
  const m: Module = { name: "m", scope: "user", on: {} };
  expect(() => makeTestDeps({}, [m, m])).toThrow("duplicate module m");
});

test("emit reaches only that event's subscribers, in order, each with its own scope's deps", async () => {
  const seen: string[] = [];
  let coreKeys: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "a",
      scope: "user",
      on: {
        "turn.received": async (e, d) => {
          seen.push(`a:${e.turnId}:${typeof d.db}`);
        },
      },
    },
    {
      name: "b",
      scope: "core",
      on: {
        "core.snapshot": async (e, d) => {
          seen.push(`b:${e.version}`);
          coreKeys = Object.keys(d);
        },
      },
    },
    {
      name: "c",
      scope: "user",
      on: {
        "core.snapshot": async (e) => {
          seen.push(`c:${e.version}`);
        },
      },
    },
  ]);
  await deps.modules.emit(turn);
  await deps.modules.emit(snapshot);
  expect(seen).toEqual(["a:t1:object", "b:3", "c:3"]);
  expect(coreKeys).not.toContain("db");
  expect(coreKeys).not.toContain("modules");
});

test("a throwing handler is logged without content and the next one still runs", async () => {
  const seen: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "boom",
      scope: "user",
      on: {
        "turn.received": async () => {
          throw new TypeError("secret text");
        },
      },
    },
    {
      name: "next",
      scope: "user",
      on: {
        "turn.received": async () => {
          seen.push("next");
        },
      },
    },
  ]);
  const log = { info: vi.fn(), error: vi.fn() };
  deps.log = log;
  await expect(deps.modules.emit(turn)).resolves.toBeUndefined();
  expect(seen).toEqual(["next"]);
  expect(log.error).toHaveBeenCalledWith("module handler failed", {
    module: "boom",
    event: "turn.received",
    error: "TypeError",
  });
  expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret text");
});

test("core code can announce core events only", async () => {
  const seen: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "c",
      scope: "core",
      on: {
        "world.event": async (e) => {
          seen.push(e.outcome);
        },
      },
    },
  ]);
  const core = coreDepsOf(deps);
  await core.emitCore({ type: "world.event", eventId: "w1", outcome: "happened" });
  // @ts-expect-error core code can't announce a user event
  await core.emitCore(turn);
  expect(seen).toEqual(["happened"]);
});
