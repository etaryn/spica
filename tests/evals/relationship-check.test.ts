import { expect, test } from "vitest";
import { checkRelationship, type RelSnapshot } from "../../evals/lib/relationship-check";

const snap = (): RelSnapshot => ({
  state: {
    status: "active",
    end_pending_since: null,
    ended_at: null,
    repair_started_at: null,
    make_up_state: "due",
    make_up_replies: 0,
    hurt_cause_fact: null,
    crisis_quiet_until: null,
    last_tick: null,
    last_hurt_at: null,
    hours_together: 0,
    session: null,
    peak_stage: "initiating",
    apart_stage: null,
    milestones: [],
  },
  params: {
    closeness: p(0.2),
    trust: p(0.4),
    warmth: p(0.5),
    hurt: p(0.3),
    tension: p(0),
    msgs_per_day: p(40, 5),
    affect_valence: p(0.5),
    afterglow: p(0),
    user_disclosure: p(0.2),
    user_responsiveness: p(0.5),
    commitment: p(0),
  },
  effects: {
    closeness: 0,
    trust: 0,
    warmth: 0,
    hurt: 0.9,
    tension: 0,
    msgs_per_day: 1,
    affect_valence: 0,
    afterglow: 0,
    user_disclosure: 0,
    user_responsiveness: 0,
    commitment: 0,
  },
  events: [{ cause: "signal", param: "hurt", detail: { sensitised: true } }],
});
function p(value: number, baseline = value) {
  return { value, baseline, variance: 0.01, updated_at: new Date(0) };
}

test("each field is checked; details name the failure", () => {
  const base = { type: "relationship" as const, user: "main" };
  expect(
    checkRelationship(snap(), {
      ...base,
      param: "msgs_per_day",
      effect: { sign: "pos", min_abs: 0.9 },
    }).ok,
  ).toBe(true);
  expect(
    checkRelationship(snap(), { ...base, param: "hurt", value: { gt: 0.25, lt: 0.5 } }).ok,
  ).toBe(true);
  expect(
    checkRelationship(snap(), {
      ...base,
      make_up_state: "due",
      status: "active",
      end_pending: false,
    }).ok,
  ).toBe(true);
  expect(
    checkRelationship(snap(), {
      ...base,
      events: { cause: "signal", param: "hurt", detail: { sensitised: true }, min: 1 },
    }).ok,
  ).toBe(true);
  const bad = checkRelationship(snap(), { ...base, param: "hurt", value: { lt: 0.1 } });
  expect(bad).toMatchObject({ ok: false });
  expect(bad.detail).toContain("hurt");
  expect(checkRelationship(null, { ...base, status: "active" }).ok).toBe(false);
});
