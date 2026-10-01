import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { parseSummaryPhrases, summaryLines } from "@/mind/state/user/relationship/summary";
import {
  PARAM_NAMES,
  type Params,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const phrases = parseSummaryPhrases(loadPrompt("relationship/summary", "v2"));
const now = new Date("2026-01-05T10:00:00Z");
const init = (): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: now,
      },
    ]),
  ) as Params;
const fresh = (): RelationshipState => ({
  status: "active",
  end_pending_since: null,
  ended_at: null,
  repair_started_at: null,
  make_up_state: "none",
  make_up_replies: 0,
  hurt_cause_fact: null,
  crisis_quiet_until: null,
  last_tick: null,
  last_hurt_at: null,
});

test("phrases file has every key the summary can ask for", () => {
  // Afterglow only ever sits above its baseline, so it has no "below" lines.
  for (const p of PARAM_NAMES) {
    for (const dir of p === "afterglow" ? ["above"] : ["above", "below"])
      for (const band of ["strong", "mild"])
        expect(phrases[`${p} ${dir} ${band}`]?.length, `${p} ${dir} ${band}`).toBeGreaterThan(0);
  }
  for (const k of ["hurt_cause", "make_up", "end_pending", "ended", "repairing"])
    expect(phrases[k]?.length, k).toBeGreaterThan(0);
});

test("nothing notable → no lines; never raw numbers", () => {
  expect(summaryLines({ state: fresh(), params: init(), cause: null }, now, cfg, phrases)).toEqual(
    [],
  );
  const p = init();
  p.msgs_per_day.value = 40;
  const lines = summaryLines({ state: fresh(), params: p, cause: null }, now, cfg, phrases);
  expect(lines).toHaveLength(1);
  expect(lines.join(" ")).not.toMatch(/\d/);
});

test("hurt with a cause uses the cause line; make-up line when due; at most summary_max_lines param lines", () => {
  const p = init();
  p.hurt.value = 0.5;
  p.tension.value = 0.5;
  p.msgs_per_day.value = 40;
  const s = { ...fresh(), make_up_state: "due" as const, make_up_replies: 1 };
  const lines = summaryLines(
    { state: s, params: p, cause: "Spica felt hurt because the user mocked her." },
    now,
    cfg,
    phrases,
  );
  expect(lines.some((l) => l.includes("the user mocked her"))).toBe(true);
  expect(lines.at(-1)).toBe(phrases.make_up![0]);
  expect(lines.length).toBeLessThanOrEqual(cfg.summary_max_lines + 1);
});

test("status lines: ended replaces param lines; pending and repairing lead", () => {
  const p = init();
  p.hurt.value = 0.6;
  expect(
    summaryLines(
      { state: { ...fresh(), status: "ended_by_user" }, params: p, cause: null },
      now,
      cfg,
      phrases,
    ),
  ).toEqual([phrases.ended![0]]);
  expect(
    summaryLines(
      { state: { ...fresh(), end_pending_since: now }, params: p, cause: null },
      now,
      cfg,
      phrases,
    )[0],
  ).toBe(phrases.end_pending![0]);
  expect(
    summaryLines(
      { state: { ...fresh(), status: "repairing" }, params: init(), cause: null },
      now,
      cfg,
      phrases,
    )[0],
  ).toBe(phrases.repairing![0]);
});

test("quiet after crisis: no hurt, tension, make-up or ending lines", () => {
  const p = init();
  p.hurt.value = 0.6;
  p.tension.value = 0.6;
  const s = {
    ...fresh(),
    make_up_state: "offered" as const,
    end_pending_since: now,
    crisis_quiet_until: new Date(now.getTime() + 3_600_000),
  };
  const lines = summaryLines({ state: s, params: p, cause: "x" }, now, cfg, phrases);
  expect(lines).toEqual([]);
});

test("quiet after crisis also suppresses the ended line; it returns once the quiet window passes", () => {
  const quietUntil = new Date(now.getTime() + 3_600_000);
  const s = { ...fresh(), status: "ended_by_user" as const, crisis_quiet_until: quietUntil };
  expect(summaryLines({ state: s, params: init(), cause: null }, now, cfg, phrases)).toEqual([]);
  expect(summaryLines({ state: s, params: init(), cause: null }, quietUntil, cfg, phrases)).toEqual(
    [phrases.ended![0]],
  );
});
