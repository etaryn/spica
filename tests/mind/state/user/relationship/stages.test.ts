/** Where a relationship is: a peak that only rises, a coming-apart overlay with hysteresis, gates. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  apartStage,
  climb,
  gatesFor,
  restage,
  stageOf,
  type StageFacts,
} from "@/mind/state/user/relationship/stages";
import {
  PARAM_NAMES,
  type ParamName,
  type Params,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const s = cfg.stages;
const at = new Date("2026-01-05T09:00:00Z");
const params = (values: Partial<Record<ParamName, number>> = {}, commitmentBaseline = 0): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: values[n] ?? cfg.initial[n],
        baseline: n === "commitment" ? commitmentBaseline : cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: at,
      },
    ]),
  ) as Params;
const facts = (p: Params, more: Partial<StageFacts> = {}): StageFacts => ({
  params: p,
  hoursTogether: 10,
  establishedIdiolect: 0,
  absent: false,
  ...more,
});
const state = (more: Partial<RelationshipState> = {}): RelationshipState => ({
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
  hours_together: 10,
  session: null,
  peak_stage: "initiating",
  apart_stage: null,
  milestones: [],
  ...more,
});

test("the peak climbs through every stage it qualifies for, in order, and never falls", () => {
  expect(climb("initiating", facts(params(), { hoursTogether: 0 }), s)).toBe("initiating");
  expect(climb("initiating", facts(params()), s)).toBe("experimenting");
  const close = params({ closeness: 0.7, trust: 0.6 });
  expect(climb("initiating", facts(close), s)).toBe("intensifying");
  expect(climb("initiating", facts(close, { establishedIdiolect: 1 }), s)).toBe("integrating");
  expect(climb("integrating", facts(params({ closeness: 0.1 })), s)).toBe("integrating");
});

test("the peak reaches the highest stage that holds, passing through the ones below", () => {
  const seeded = facts(params({ closeness: 0.45 }), { hoursTogether: 0 });
  expect(climb("initiating", seeded, s)).toBe("intensifying");
  // Bonding still needs the peak at integrating first.
  const committed = facts(params({ closeness: 0.45, commitment: 0.9 }, 0.9));
  expect(climb("initiating", committed, s)).toBe("intensifying");
});

test("bonding needs sustained commitment: the baseline, not today's value", () => {
  const f = (baseline: number) =>
    facts(params({ closeness: 0.7, trust: 0.6, commitment: 0.9 }, baseline), {
      establishedIdiolect: 1,
    });
  expect(climb("integrating", f(0.5), s)).toBe("integrating");
  expect(climb("integrating", f(0.75), s)).toBe("bonding");
});

test("near-strangers don't come apart; friends do, most severe first", () => {
  const sore = params({ hurt: 0.8, tension: 0.8 });
  expect(apartStage("experimenting", null, facts(sore), s)).toBeNull();
  expect(apartStage("intensifying", null, facts(sore), s)).toBe("circumscribing");
  expect(apartStage("intensifying", null, facts(params({ tension: 0.55 })), s)).toBe(
    "differentiating",
  );
  expect(
    apartStage("intensifying", null, facts(params({ warmth: 0.2, user_disclosure: 0.1 })), s),
  ).toBe("stagnating");
  expect(apartStage("intensifying", null, facts(sore, { absent: true }), s)).toBe("avoiding");
});

test("a coming-apart stage holds until its clear threshold, not its enter threshold", () => {
  const between = params({ tension: 0.4 });
  expect(apartStage("intensifying", null, facts(between), s)).toBeNull();
  expect(apartStage("intensifying", "differentiating", facts(between), s)).toBe("differentiating");
  expect(
    apartStage("intensifying", "differentiating", facts(params({ tension: 0.1 })), s),
  ).toBeNull();
  // Initial trust sits above both levels: a new friend is never differentiating on trust alone.
  expect(apartStage("intensifying", null, facts(params()), s)).toBeNull();
  expect(
    apartStage("intensifying", "differentiating", facts(params({ tension: 0 })), s),
  ).toBeNull();
});

test("gates: together stages set the tier, apart stages drop from the peak", () => {
  expect(gatesFor({ stage: "integrating", peak: "integrating", apart: null }, s)).toEqual({
    open: 3,
    idiolect: "all",
  });
  expect(
    gatesFor({ stage: "differentiating", peak: "integrating", apart: "differentiating" }, s),
  ).toEqual({ open: 2, idiolect: "all" });
  expect(
    gatesFor({ stage: "circumscribing", peak: "intensifying", apart: "circumscribing" }, s),
  ).toEqual({ open: 1, idiolect: "none" });
  expect(gatesFor({ stage: "terminating", peak: "bonding", apart: null }, s)).toEqual({
    open: 1,
    idiolect: "theirs",
  });
});

test("restage logs each change as a stage event", () => {
  const out = restage(state(), facts(params({ closeness: 0.5 })), s);
  expect(out.state.peak_stage).toBe("intensifying");
  expect(out.events).toEqual([
    expect.objectContaining({
      param: null,
      cause: "stage",
      detail: { peak: true, from: "initiating", to: "intensifying" },
    }),
  ]);
});

test("a never-staged row reads its peak from the params; an ended one is terminating", () => {
  const p = params({ closeness: 0.7 });
  expect(stageOf(state({ milestones: null }), p, s).stage).toBe("intensifying");
  expect(stageOf(state(), p, s).stage).toBe("initiating");
  expect(stageOf(state({ status: "ended_by_user", peak_stage: "bonding" }), p, s).stage).toBe(
    "terminating",
  );
  expect(stageOf(state({ peak_stage: "integrating", apart_stage: "avoiding" }), p, s)).toEqual({
    stage: "avoiding",
    peak: "integrating",
    apart: "avoiding",
  });
});
