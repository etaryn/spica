import { getFact } from "@/db/repos/facts";
import * as rel from "@/db/repos/relationship";
import type { Deps } from "../deps";
import { loadPrompt } from "../prompts";
import { effect, fadeParams } from "./homeostasis";
import { makeUpLineDue } from "./transitions";
import { PARAM_NAMES, type Params, type RelConfig, type RelState } from "./types";

export type Phrases = Record<string, string[]>;

export function parseSummaryPhrases(md: string): Phrases {
  const out: Phrases = {};
  let cur: string | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { cur = h[1]!.trim(); out[cur] = []; continue; }
    const item = /^-\s+(.+)$/.exec(line);
    if (cur && item) out[cur]!.push(item[1]!.trim());
  }
  return out;
}

const first = (p: Phrases, key: string): string | null => p[key]?.[0] ?? null;

/** Slot 3 lines (design §7.1, §6.5): status first, then the strongest deviations, then the make-up line.
 * Until `crisis_quiet_until` passes, hurt, tension, make-up and ending lines are all omitted (design §6.5). */
export function summaryLines(v: { state: RelState; params: Params; cause: string | null }, now: Date, cfg: RelConfig, phrases: Phrases): string[] {
  const { state } = v;
  const quiet = !!state.crisis_quiet_until && now < state.crisis_quiet_until;
  if (state.status === "ended_by_user") {
    if (quiet) return [];
    const line = first(phrases, "ended");
    return line ? [line] : [];
  }
  const out: string[] = [];
  if (state.status === "repairing") {
    const line = first(phrases, "repairing");
    if (line) out.push(line);
  }
  if (!quiet && state.end_pending_since) {
    const line = first(phrases, "end_pending");
    if (line) out.push(line);
  }

  const notable = PARAM_NAMES
    .filter((n) => !(quiet && (n === "hurt" || n === "tension")))
    .map((n) => ({ n, e: effect(v.params[n], cfg.variance_epsilon) }))
    .filter((x) => Math.abs(x.e) >= cfg.summary_min_effect)
    .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
    .slice(0, cfg.summary_max_lines);
  for (const { n, e } of notable) {
    if (n === "hurt" && e > 0 && v.cause) {
      const line = first(phrases, "hurt_cause");
      if (line) out.push(line.replace("{cause}", v.cause));
      continue;
    }
    const line = first(phrases, `${n} ${e > 0 ? "above" : "below"} ${Math.abs(e) >= cfg.summary_strong_effect ? "strong" : "mild"}`);
    if (line) out.push(line);
  }
  if (!quiet && makeUpLineDue(state, cfg)) {
    const line = first(phrases, "make_up");
    if (line) out.push(line);
  }
  return out;
}

/** Hot path, read-only (design §7.1): fades in memory, never writes. Null when there's no row or nothing notable. */
export async function loadRelationshipSummary(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<string | null> {
  const cfg = deps.config.relationship;
  const row = await rel.getRelationshipRow(deps.db, userId);
  if (!row) return null;
  const params = fadeParams(await rel.getParams(deps.db, userId), now, cfg);
  const cause = row.hurt_cause_fact ? (await getFact(deps.db, userId, row.hurt_cause_fact))?.content ?? null : null;
  const phrases = parseSummaryPhrases(loadPrompt("relationship/summary", deps.config.prompts.relationship_summary));
  const lines = summaryLines({ state: rel.toRelState(row), params, cause }, now, cfg, phrases);
  return lines.length ? lines.join("\n") : null;
}
