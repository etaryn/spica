import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { evaluateGate } from "@/mind/process/outreach/gate";
import type { GateInputs } from "@/mind/process/outreach/types";

const cfg = loadConfig().outreach;
const now = new Date("2026-01-10T12:00:00Z");
const H = 3_600_000;
const ago = (h: number) => new Date(now.getTime() - h * H);
const ok = (): GateInputs => ({
  status: "active",
  sentAt: [],
  herBlock: null,
  unanswered: 0,
  inProgress: false,
  crisisQuietUntil: null,
});
const failed = (g: GateInputs) =>
  evaluateGate(g, cfg, now)
    .results.filter((r) => !r.pass)
    .map((r) => r.rule);

test("all clear passes and reports every rule", () => {
  const out = evaluateGate(ok(), cfg, now);
  expect(out.pass).toBe(true);
  expect(out.results.map((r) => r.rule)).toEqual([
    "status",
    "caps",
    "her_day",
    "unanswered",
    "in_progress",
    "crisis",
  ]);
});

test("status: ended blocks, repairing passes", () => {
  expect(failed({ ...ok(), status: "ended_by_user" })).toEqual(["status"]);
  expect(failed({ ...ok(), status: "repairing" })).toEqual([]);
});

test("caps are rolling windows: 1 per 24 h, 3 per 7 d", () => {
  expect(failed({ ...ok(), sentAt: [ago(23.9)] })).toEqual(["caps"]);
  expect(failed({ ...ok(), sentAt: [ago(24)] })).toEqual([]); // exactly 24 h ago is outside the window
  expect(failed({ ...ok(), sentAt: [ago(30), ago(80), ago(150)] })).toEqual(["caps"]);
  expect(failed({ ...ok(), sentAt: [ago(30), ago(80), ago(168)] })).toEqual([]);
});

test("her day: busy and quiet block, downtime (null) passes", () => {
  expect(failed({ ...ok(), herBlock: { block: "busy", label: "film" } })).toEqual(["her_day"]);
  expect(failed({ ...ok(), herBlock: { block: "quiet", label: "offline" } })).toEqual(["her_day"]);
});

test("unanswered: blocks at max_unanswered (2), not at 1", () => {
  expect(failed({ ...ok(), unanswered: 1 })).toEqual([]);
  expect(failed({ ...ok(), unanswered: 2 })).toEqual(["unanswered"]);
});

test("in progress and crisis quiet block; crisis ends exactly at crisis_quiet_until", () => {
  expect(failed({ ...ok(), inProgress: true })).toEqual(["in_progress"]);
  expect(failed({ ...ok(), crisisQuietUntil: new Date(now.getTime() + 1) })).toEqual(["crisis"]);
  expect(failed({ ...ok(), crisisQuietUntil: now })).toEqual([]);
});

test("every failing rule is reported, not just the first", () => {
  expect(failed({ ...ok(), status: "ended_by_user", unanswered: 5, inProgress: true })).toEqual([
    "status",
    "unanswered",
    "in_progress",
  ]);
});
