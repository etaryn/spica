/**
 * The send gate: whether she may write first right now. The relationship must not be ended,
 * she must be within the daily and weekly caps, free (not busy or offline), outside their own
 * night, under the unanswered limit, not mid-conversation, and outside a crisis quiet window. Pure. Every rule is evaluated and
 * reported, with no short-circuit, so the log shows the whole picture.
 */
import type { OutreachConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import type { GateInputs, GateOutcome, GateResult } from "./types";

const DAY_HOURS = 24;
export const WEEK_HOURS = 7 * DAY_HOURS;

/** Sends inside the rolling window of `hours` before `now`. */
export function sentWithin(sentAt: Date[], now: Date, hours: number): number {
  return sentAt.filter((sent) => now.getTime() - sent.getTime() < hours * HOUR).length;
}

/** Their night may wrap midnight (23 → 8). */
const inNight = (hour: number, n: { start_hour: number; end_hour: number }) =>
  n.start_hour <= n.end_hour
    ? hour >= n.start_hour && hour < n.end_hour
    : hour >= n.start_hour || hour < n.end_hour;

export function evaluateGate(inputs: GateInputs, settings: OutreachConfig, now: Date): GateOutcome {
  const today = sentWithin(inputs.sentAt, now, DAY_HOURS);
  const thisWeek = sentWithin(inputs.sentAt, now, WEEK_HOURS);

  const crisisOver = !inputs.crisisQuietUntil || inputs.crisisQuietUntil.getTime() <= now.getTime();

  const results: GateResult[] = [
    { rule: "status", pass: inputs.status !== "ended_by_user", detail: inputs.status },
    {
      rule: "caps",
      pass: today < settings.cap_per_day && thisWeek < settings.cap_per_week,
      detail: `24h ${today}/${settings.cap_per_day}, 7d ${thisWeek}/${settings.cap_per_week}`,
    },
    {
      rule: "her_day",
      pass: inputs.herBlock === null,
      detail: inputs.herBlock ? `${inputs.herBlock.block}: ${inputs.herBlock.label}` : "free",
    },
    {
      rule: "their_night",
      pass: !inNight(inputs.theirHour, settings.their_night),
      detail: `their ${inputs.theirHour}:00`,
    },
    {
      rule: "unanswered",
      pass: inputs.unanswered < settings.max_unanswered,
      detail: `${inputs.unanswered}/${settings.max_unanswered}`,
    },
    { rule: "in_progress", pass: !inputs.inProgress },
    { rule: "crisis", pass: crisisOver },
  ];

  return { pass: results.every((r) => r.pass), results };
}
