import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { core_loop_trace } from "@/db/schema";
import { ensurePlans, fallbackPlan, validatePlan } from "@/mind/world/day-plan";
import { coreDepsOf } from "@/mind/platform/deps";
import { getLifeDay } from "@/db/repos/world/life-day";
import { closeTestDb, getTestDb, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const cfg = makeTestDeps().config.life;
const good = {
  blocks: [
    { start: "10:00", end: "13:00", kind: "busy" as const, busy: 1.4, label: " reading  " },
    {
      start: "20:00",
      end: "22:00",
      kind: "busy" as const,
      busy: 0.1,
      label: "rewatching an old film",
    },
    { start: "14:00", end: "15:00", kind: "downtime" as const, busy: 0.5, label: "coffee" },
  ],
};

test("validatePlan sorts, normalises busy levels and labels", () => {
  const r = validatePlan(good, cfg, null);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.plan.blocks.map((b) => b.start)).toEqual(["10:00", "14:00", "20:00"]);
  expect(r.plan.blocks[0]).toMatchObject({ busy: 1, label: "reading" }); // clamped to [0.3, 1]
  expect(r.plan.blocks[1]!.busy).toBe(0);
  expect(r.plan.blocks[2]!.busy).toBe(cfg.min_busy);
});

test("validatePlan rejects overlap, bad times, and no busy block", () => {
  const bad = validatePlan(
    {
      blocks: [
        { start: "00:00", end: "05:00", kind: "downtime", busy: 0, label: "offline" },
        { start: "04:00", end: "06:00", kind: "downtime", busy: 0, label: "x" },
        { start: "25:00", end: "26:00", kind: "busy", busy: 0.5, label: "y" },
      ],
    },
    cfg,
    null,
  );
  expect(bad.ok).toBe(false);
  if (bad.ok) return;
  expect(bad.violations.join(" | ")).toMatch(/bad time/);
  expect(bad.violations.join(" | ")).toMatch(/overlap/);
  expect(bad.violations.join(" | ")).toMatch(/busy blocks: 0/);
});

test("ensurePlans creates today and tomorrow once, in her dates", async () => {
  const deps = makeTestDeps();
  const now = new Date("2026-01-05T17:00:00Z"); // 01:00 on the 6th in Singapore
  expect((await ensurePlans(coreDepsOf(deps), now)).created).toEqual(["2026-01-06", "2026-01-07"]);
  expect((await ensurePlans(coreDepsOf(deps), now)).created).toEqual([]);
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_plan")).toHaveLength(2);
  expect((await getLifeDay(getTestDb(), "2026-01-06"))?.source).toBe("model");
});

test("an invalid plan is retried with its violations, then replaced by the fallback", async () => {
  const deps = makeTestDeps({ life: { plan_context_days: 0 } });
  deps.llm.handlers.life_plan = () => ({ blocks: [] });
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  const calls = deps.llm.structuredCalls.filter((c) => c.purpose === "life_plan");
  expect(calls).toHaveLength(4); // 2 days × 2 attempts
  expect(calls[1]!.input).toMatch(/rejected/);
  const row = await getLifeDay(getTestDb(), "2026-01-05");
  expect(row?.source).toBe("fallback");
  expect(row?.plan).toEqual(fallbackPlan(deps.config.life));
});

test("an LLM error on both attempts also falls back", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.life_plan = () => {
    throw new Error("down");
  };
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  expect((await getLifeDay(getTestDb(), "2026-01-05"))?.source).toBe("fallback");
});

test("each generated plan writes a life_plan trace with its calls", async () => {
  const deps = makeTestDeps();
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  const rows = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_plan"));
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.calls === 1 && r.status === "done")).toBe(true);
});

test("over budget the fallback plan is written without calling the model", async () => {
  const deps = makeTestDeps({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  expect((await getLifeDay(getTestDb(), "2026-01-05"))?.source).toBe("fallback");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_plan")).toEqual([]);
  const rows = await deps.db.select().from(core_loop_trace);
  expect(rows.map((r) => r.status)).toEqual(["fallback", "fallback"]);
});

test("a plan doing the same busy things as yesterday is rejected", () => {
  const raw = {
    blocks: [
      { start: "09:00", end: "12:00", kind: "busy" as const, busy: 0.8, label: "reading fiction" },
      {
        start: "19:00",
        end: "21:00",
        kind: "busy" as const,
        busy: 0.9,
        label: "rewatching an old film",
      },
    ],
  };
  const yesterday = validatePlan(raw, cfg, null);
  expect(yesterday.ok).toBe(true);
  const again = validatePlan(raw, cfg, yesterday.ok ? yesterday.plan : null);
  expect(again).toEqual({ ok: false, violations: [expect.stringContaining("same as yesterday")] });
});

test("a plan with a quiet block is rejected: she has no night", () => {
  const r = validatePlan(
    {
      blocks: [
        { start: "00:00", end: "08:00", kind: "quiet" as never, busy: 0, label: "offline" },
        { start: "10:00", end: "13:00", kind: "busy", busy: 0.6, label: "reading" },
      ],
    },
    cfg,
    null,
  );
  expect(r.ok).toBe(false);
  expect(!r.ok && r.violations.join(" ")).toContain("kind");
});

test("busy blocks can fall at any hour, and the fallback is busy and free only", () => {
  const late = validatePlan(
    { blocks: [{ start: "01:00", end: "04:00", kind: "busy", busy: 0.7, label: "reading" }] },
    cfg,
    null,
  );
  expect(late.ok).toBe(true);
  expect(fallbackPlan(cfg).blocks.every((b) => b.kind !== ("quiet" as never))).toBe(true);
  expect(fallbackPlan(cfg).blocks.some((b) => b.kind === "busy")).toBe(true);
});

test("a block running past midnight ends at 24:00; an empty block is still rejected", () => {
  const plan = (start: string, end: string) =>
    validatePlan(
      { blocks: [{ start, end, kind: "busy", busy: 0.8, label: "reading" }] },
      cfg,
      null,
    );
  for (const end of ["02:20", "00:00"]) {
    const r = plan("23:00", end);
    expect(r.ok && r.plan.blocks[0]).toMatchObject({ start: "23:00", end: "24:00" });
  }
  expect(plan("10:00", "10:00").ok).toBe(false);
});

test("an unlabelled downtime block is skipped, not a reason to reject the plan", () => {
  const r = validatePlan(
    {
      blocks: [
        { start: "09:00", end: "12:00", kind: "busy", busy: 0.8, label: "reading" },
        { start: "12:00", end: "15:00", kind: "downtime", busy: 0, label: "" },
        { start: "15:00", end: "17:00", kind: "busy", busy: 0.7, label: "writing a post" },
      ],
    },
    cfg,
    null,
  );
  expect(r.ok).toBe(true);
  expect(r.ok && r.plan.blocks.map((b) => b.start)).toEqual(["09:00", "15:00"]);
  // A busy block still needs its label.
  const bad = validatePlan(
    { blocks: [{ start: "09:00", end: "12:00", kind: "busy", busy: 0.8, label: " " }] },
    cfg,
    null,
  );
  expect(bad.ok).toBe(false);
});
