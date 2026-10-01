import type { OutreachConfig } from "../config";
import { HOUR } from "../time";
import type { GateInputs, GateOutcome, GateResult } from "./types";

/** The reach-out send gate. Pure; every rule evaluated and reported (no short-circuit) so the log shows the whole picture. */
export function evaluateGate(g: GateInputs, cfg: OutreachConfig, now: Date): GateOutcome {
  const within = (hours: number) => g.sentAt.filter((t) => now.getTime() - t.getTime() < hours * HOUR).length;
  const day = within(24);
  const week = within(24 * 7);
  const results: GateResult[] = [
    { rule: "status", pass: g.status !== "ended_by_user", detail: g.status },
    { rule: "caps", pass: day < cfg.cap_per_day && week < cfg.cap_per_week, detail: `24h ${day}/${cfg.cap_per_day}, 7d ${week}/${cfg.cap_per_week}` },
    { rule: "her_day", pass: g.herBlock === null, detail: g.herBlock ? `${g.herBlock.block}: ${g.herBlock.label}` : "free" },
    { rule: "unanswered", pass: g.unanswered < cfg.max_unanswered, detail: `${g.unanswered}/${cfg.max_unanswered}` },
    { rule: "in_progress", pass: !g.inProgress },
    { rule: "crisis", pass: !g.crisisQuietUntil || g.crisisQuietUntil.getTime() <= now.getTime() },
  ];
  return { pass: results.every((r) => r.pass), results };
}
