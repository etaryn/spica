/**
 * Firsts in a relationship: each makes her think about them once, ever. The list is open: a new
 * first is one entry here. A relationship staged for the first time records every first it has
 * already passed without firing them, so an old friendship doesn't announce a burst of firsts.
 */
import type { Config } from "@/mind/platform/config";
import { type ApartStage, type MakeUpState, TOGETHER, type TogetherStage } from "./types";

export type MilestoneConfig = Config["user_mind"]["triggers"]["milestone"];
export type MilestoneFacts = {
  peak: TogetherStage;
  apart: ApartStage | null;
  makeUp: MakeUpState;
  /** What she was hurt by; null for a make-up absence started, which is no falling-out. */
  hurtCauseFact: string | null;
  establishedIdiolect: number;
  /** The deepest tier she has told them openly; 0 for nothing yet. */
  maxOpenDepth: number;
  /** This exchange's reading of how much they opened up; null outside an exchange. */
  disclosureReading: number | null;
};

const atLeast = (peak: TogetherStage, stage: TogetherStage) =>
  TOGETHER.indexOf(peak) >= TOGETHER.indexOf(stage);

export const MILESTONES: {
  name: string;
  reached: (f: MilestoneFacts, s: MilestoneConfig) => boolean;
}[] = [
  ...(["experimenting", "intensifying", "integrating", "bonding"] as const).map((stage) => ({
    name: `stage:${stage}`,
    reached: (f: MilestoneFacts) => atLeast(f.peak, stage),
  })),
  // Drifting apart through absence is no conflict, nor is the hurt of missing them.
  {
    name: "first_conflict",
    reached: (f) =>
      (f.apart !== null && f.apart !== "avoiding") ||
      (f.makeUp !== "none" && f.hurtCauseFact !== null),
  },
  { name: "first_inside_joke", reached: (f) => f.establishedIdiolect > 0 },
  { name: "first_depth:2", reached: (f) => f.maxOpenDepth >= 2 },
  { name: "first_depth:3", reached: (f) => f.maxOpenDepth >= 3 },
  {
    name: "first_their_depth",
    reached: (f, s) => f.disclosureReading !== null && f.disclosureReading >= s.their_depth,
  },
];

export function newMilestones(
  reached: string[] | null,
  f: MilestoneFacts,
  s: MilestoneConfig,
): { all: string[]; fired: string[] } {
  const now = MILESTONES.filter((m) => m.reached(f, s)).map((m) => m.name);
  if (reached === null) return { all: now, fired: [] };
  const fired = now.filter((name) => !reached.includes(name));
  return { all: [...reached, ...fired], fired };
}
