import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { loadPrompt } from "@/core/prompts";
import { parseSummaryPhrases, summaryLines } from "@/core/relationship/summary";
import type { Params, RelState } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const phrases = parseSummaryPhrases(loadPrompt("relationship/summary", "v1"));
const now = new Date("2026-01-05T10:00:00Z");
const init = (): Params => Object.fromEntries((["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"] as const)
  .map((n) => [n, { value: cfg.initial[n], baseline: cfg.initial[n], variance: cfg.initial_variance[n], updated_at: now }])) as Params;
const fresh = (): RelState => ({ status: "active", end_pending_since: null, ended_at: null, repair_started_at: null, make_up_state: "none",
  make_up_replies: 0, hurt_cause_fact: null, crisis_quiet_until: null, last_tick: null, last_hurt_at: null });

test("phrases file has every key the summary can ask for", () => {
  for (const p of ["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"]) {
    for (const dir of ["above", "below"]) for (const band of ["strong", "mild"]) expect(phrases[`${p} ${dir} ${band}`]?.length, `${p} ${dir} ${band}`).toBeGreaterThan(0);
  }
  for (const k of ["hurt_cause", "make_up", "end_pending", "ended", "repairing"]) expect(phrases[k]?.length, k).toBeGreaterThan(0);
});

test("nothing notable → no lines; never raw numbers", () => {
  expect(summaryLines({ state: fresh(), params: init(), cause: null }, now, cfg, phrases)).toEqual([]);
  const p = init();
  p.msgs_per_day.value = 40;
  const lines = summaryLines({ state: fresh(), params: p, cause: null }, now, cfg, phrases);
  expect(lines).toHaveLength(1);
  expect(lines.join(" ")).not.toMatch(/\d/);
});

test("hurt with a cause uses the cause line; make-up line when due; at most summary_max_lines param lines", () => {
  const p = init();
  p.hurt.value = 0.5; p.tension.value = 0.5; p.msgs_per_day.value = 40;
  const s = { ...fresh(), make_up_state: "due" as const, make_up_replies: 1 };
  const lines = summaryLines({ state: s, params: p, cause: "Spica felt hurt because the user mocked her." }, now, cfg, phrases);
  expect(lines.some((l) => l.includes("the user mocked her"))).toBe(true);
  expect(lines.at(-1)).toBe(phrases.make_up![0]);
  expect(lines.length).toBeLessThanOrEqual(cfg.summary_max_lines + 1);
});

test("status lines: ended replaces param lines; pending and repairing lead", () => {
  const p = init();
  p.hurt.value = 0.6;
  expect(summaryLines({ state: { ...fresh(), status: "ended_by_user" }, params: p, cause: null }, now, cfg, phrases)).toEqual([phrases.ended![0]]);
  expect(summaryLines({ state: { ...fresh(), end_pending_since: now }, params: p, cause: null }, now, cfg, phrases)[0]).toBe(phrases.end_pending![0]);
  expect(summaryLines({ state: { ...fresh(), status: "repairing" }, params: init(), cause: null }, now, cfg, phrases)[0]).toBe(phrases.repairing![0]);
});

test("quiet after crisis: no hurt, tension, make-up or ending lines", () => {
  const p = init();
  p.hurt.value = 0.6; p.tension.value = 0.6;
  const s = { ...fresh(), make_up_state: "offered" as const, end_pending_since: now, crisis_quiet_until: new Date(now.getTime() + 3_600_000) };
  const lines = summaryLines({ state: s, params: p, cause: "x" }, now, cfg, phrases);
  expect(lines).toEqual([]);
});
