/**
 * Where a relationship is: how far they have come together, which only ever rises, and whether
 * they are coming apart right now. Coming apart can only happen to a relationship that came
 * together; between near-strangers a bad patch is just hurt and tension. The stage sets how deep
 * she goes, which of their things she reuses, and her posture with them.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Config } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import {
  type ApartStage,
  type Params,
  type RelationshipConfig,
  type RelationshipEvent,
  type RelationshipState,
  TOGETHER,
  type TogetherStage,
} from "./types";

export type StagesConfig = RelationshipConfig["stages"];
export type Stage = TogetherStage | ApartStage | "terminating";
export type IdiolectReuse = "none" | "theirs" | "all";
export type StageFacts = {
  params: Params;
  hoursTogether: number;
  establishedIdiolect: number;
  /** Away past the usual gap; only the daily tick can say so. */
  absent: boolean;
};
export type StageView = { stage: Stage; peak: TogetherStage; apart: ApartStage | null };

const rank = (stage: TogetherStage) => TOGETHER.indexOf(stage);

export function climb(peak: TogetherStage, f: StageFacts, s: StagesConfig): TogetherStage {
  const c = s.climb;
  const p = f.params;
  const reaches: Record<TogetherStage, boolean> = {
    initiating: true,
    experimenting: f.hoursTogether >= c.experimenting_hours,
    intensifying: p.closeness.value >= c.intensifying_closeness,
    integrating:
      p.closeness.value >= c.integrating_closeness &&
      p.trust.value >= c.integrating_trust &&
      f.establishedIdiolect > 0,
    // The baseline is the slow daily average: commitment that has lasted, not one good day.
    bonding: p.commitment.baseline >= c.bonding_commitment,
  };
  let i = rank(peak);
  while (i + 1 < TOGETHER.length && reaches[TOGETHER[i + 1]!]) i += 1;
  return TOGETHER[i]!;
}

/**
 * Most severe first. A stage already holding stays until its clear threshold, so it doesn't flip
 * back and forth around one number.
 */
export function apartStage(
  peak: TogetherStage,
  current: ApartStage | null,
  f: StageFacts,
  s: StagesConfig,
): ApartStage | null {
  if (rank(peak) < rank("intensifying")) return null;
  if (f.absent) return "avoiding";
  const p = f.params;
  const holds = (stage: ApartStage, stays: boolean, enters: boolean) =>
    current === stage ? stays : enters;

  const st = s.stagnating;
  if (
    holds(
      "stagnating",
      p.warmth.value < st.clear_warmth,
      p.warmth.value < st.warmth && p.user_disclosure.value < st.disclosure,
    )
  )
    return "stagnating";
  const ci = s.circumscribing;
  if (
    holds(
      "circumscribing",
      p.hurt.value >= ci.clear_hurt || p.tension.value >= ci.clear_tension,
      p.hurt.value >= ci.hurt || p.tension.value >= ci.tension,
    )
  )
    return "circumscribing";
  const d = s.differentiating;
  if (
    holds(
      "differentiating",
      p.tension.value >= d.clear_tension || p.trust.value < d.clear_trust,
      p.tension.value >= d.tension || p.trust.value < d.trust,
    )
  )
    return "differentiating";
  return null;
}

export function restage(
  state: RelationshipState,
  f: StageFacts,
  s: StagesConfig,
): { state: RelationshipState; events: RelationshipEvent[] } {
  const peak = climb(state.peak_stage, f, s);
  const apart = apartStage(peak, state.apart_stage, f, s);
  const events: RelationshipEvent[] = [];
  const log = (detail: Record<string, unknown>) =>
    events.push({
      param: null,
      before: null,
      after: null,
      cause: "stage",
      deviation: null,
      detail,
    });
  if (peak !== state.peak_stage) log({ peak: true, from: state.peak_stage, to: peak });
  if (apart !== state.apart_stage) log({ apart: true, from: state.apart_stage, to: apart });
  return { state: { ...state, peak_stage: peak, apart_stage: apart }, events };
}

/**
 * Read-only. A row never staged (from before stages, or an eval seed) reads its peak from the
 * params; an inside joke can't be counted here, so it reads at most intensifying until staged.
 */
export function stageOf(state: RelationshipState, params: Params, s: StagesConfig): StageView {
  const staged = state.milestones !== null;
  const peak = staged
    ? state.peak_stage
    : climb(
        "initiating",
        { params, hoursTogether: state.hours_together, establishedIdiolect: 0, absent: false },
        s,
      );
  const apart = staged ? state.apart_stage : null;
  const stage: Stage = state.status === "ended_by_user" ? "terminating" : (apart ?? peak);
  return { stage, peak, apart };
}

export function gatesFor(
  view: StageView,
  s: StagesConfig,
): { open: number; idiolect: IdiolectReuse } {
  const g = s.gates;
  if (view.stage === "terminating" || (TOGETHER as readonly string[]).includes(view.stage)) {
    const gate = g[view.stage as TogetherStage | "terminating"];
    return { open: gate.open, idiolect: gate.idiolect };
  }
  const gate = g[view.stage as ApartStage];
  return { open: Math.max(1, g[view.peak].open - gate.drop), idiolect: gate.idiolect };
}

/** The closeness a peak stage was reached at; below it she has drifted from where they were. */
export function peakCloseness(peak: TogetherStage, s: StagesConfig): number | null {
  if (peak === "intensifying") return s.climb.intensifying_closeness;
  if (peak === "integrating" || peak === "bonding") return s.climb.integrating_closeness;
  return null;
}

/** Hot path, read-only. Null before the relationship exists. */
export async function loadStage(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
): Promise<StageView | null> {
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return null;
  const params = await relationshipRepo.getParams(deps.db, userId);
  return stageOf(
    relationshipRepo.toRelationshipState(row),
    params,
    deps.config.relationship.stages,
  );
}

export const loadStagePhrases = (config: Config): Phrases =>
  parseSummaryPhrases(loadPrompt("relationship/stage", config.prompts.relationship_stage));

export const stageLine = (view: StageView, phrases: Phrases): string | null =>
  phrases[view.stage]?.[0] ?? null;
