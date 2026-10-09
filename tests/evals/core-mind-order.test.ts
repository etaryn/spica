/** The eval life loop uses production hourly order and preserves injected fallthrough choices. */
import { afterEach, expect, test, vi } from "vitest";
import { RecordingQueue } from "@/mind/platform/jobs";
import { makeLifeLoop } from "../../evals/lib/life-loop";
import { LifeScript, type OutreachScript } from "../../evals/lib/script";
import { ALL_PURPOSES, resolveProfile } from "../../evals/lib/profile";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { makeTestDeps } from "../helpers/deps";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/mind/world/day-plan", () => ({ ensurePlans: async () => calls.push("plan") }));
vi.mock("@/mind/process/core/world-tick", () => ({
  coreWorldTick: async (_deps: unknown, _now: Date, opts: { inject: (day: string) => unknown }) => {
    calls.push("world");
    expect(opts.inject("2026-01-05")).toMatchObject({ fallthrough: false });
    expect(opts.inject("2026-01-06")).toMatchObject({ fallthrough: true });
  },
}));
vi.mock("@/mind/state/core/tick", () => ({ coreStateTick: async () => calls.push("state") }));
vi.mock("@/mind/process/core/mind-tick", () => ({
  coreMindTick: async () => calls.push("mind"),
}));
vi.mock("@/mind/process/core/nightly", () => ({
  coreNightly: async () => calls.push("nightly"),
}));
vi.mock("@/mind/process/outreach/tick", () => ({
  outreachTick: async () => {
    calls.push("outreach");
    return { failed: 0, users: 0 };
  },
}));
vi.mock("@/mind/process/user/tick", () => ({
  userMindTick: async () => {
    calls.push("user_mind");
    return { recorded: 0, failed: 0 };
  },
}));
vi.mock("../../evals/lib/scheduler", () => ({
  runDueJobs: async () => {},
  drainUserMind: async () => calls.push("user_mind_runs"),
}));

afterEach(() => calls.splice(0));

test("each eval hour runs world, state, mind, nightly, the user mind, then outreach and passes both fallthrough overrides", async () => {
  const now = new Date("2026-01-05T09:00:00Z");
  const deps = makeTestDeps();
  const clock = deps.clock;
  const life = LifeScript.parse({
    inject: [
      { day: 0, content: "A cancelled plan", fallthrough: false },
      { day: 1, content: "Another cancelled plan", fallthrough: true },
    ],
  });
  const outreach: OutreachScript = { user_replies: "never", reply_text: "hello" };
  const loop = makeLifeLoop(deps, clock, life, now, {
    queue: new RecordingQueue(),
    script: outreach,
    userIds: () => [],
  });
  await loop.start();
  expect(calls).toEqual([
    "plan",
    "world",
    "state",
    "mind",
    "nightly",
    "user_mind",
    "user_mind_runs",
    "outreach",
  ]);
  expect(loop.hours).toBe(1);
});

test("the new core purposes can be selected without enabling real reply scripts", () => {
  const purposes =
    "core_resolve,core_appraise,core_anticipate,core_ruminate,core_wander,core_reflect," +
    "core_consolidate,core_render_snapshot,core_drift_watch";
  const profile = resolveProfile({ llm: "fake", real: purposes });
  expect([...profile.realPurposes]).toEqual(purposes.split(","));
  expect(profile.realScripts).toBe(false);
});

test("every core and user loop purpose the fake model answers can be made real", () => {
  const fake = new FakeLLMProvider();
  for (const p of Object.keys(fake.handlers).filter((k) => /^(core|user)_/.test(k)))
    expect(ALL_PURPOSES, p).toContain(p);
});
