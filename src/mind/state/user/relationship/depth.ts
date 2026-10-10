/**
 * How deep she may go with this person right now. Closeness sets her usual limit; if she has been
 * sharing far more than they have, she holds back a tier; a conversation with real chemistry can
 * draw her one tier further, but only as a hint. A reach-out has no live chemistry to draw on.
 */
import { recentDisclosureDepths, type DisclosureLevel } from "@/db/repos/user/disclosure";
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Deps } from "@/mind/platform/deps";
import type { DepthLimits, Openness, RelationshipConfig, SessionState } from "./types";

/** A stranger's limits, and a crisis's: nothing of her own beyond the surface. */
export const FIRST_DEPTH: DepthLimits = { open: 1, peek: 1 };

export type DepthInputs = {
  closeness: number;
  /** Their own openness lately, 0–1. */
  userDisclosure: number;
  /** The depths of what she told them most recently. */
  recentDepths: number[];
  herDisclosure: number | null;
  session: SessionState | null;
  reachOut: boolean;
};

export function depthFor(inputs: DepthInputs, settings: RelationshipConfig): DepthLimits {
  const { bands, reciprocity_gap, stretch_moment } = settings.depth;
  let open =
    1 + Number(inputs.closeness >= bands.personal) + Number(inputs.closeness >= bands.intimate);

  // Her recent sharing on their 0–1 scale: tier 1 is 0, tier 3 is 1.
  const n = inputs.recentDepths.length;
  const hers = n ? inputs.recentDepths.reduce((sum, d) => sum + (d - 1) / 2, 0) / n : 0;
  if (hers - inputs.userDisclosure > reciprocity_gap) open = Math.max(1, open - 1);

  const s = inputs.session;
  const deepSession =
    !!s && (s.deep_fired || (s.moment_n > 0 && s.moment_sum / s.moment_n >= stretch_moment));
  const drawnOut = (inputs.herDisclosure ?? 0) >= settings.openness.bands.high || deepSession;
  const peek = !inputs.reachOut && drawnOut ? Math.min(3, open + 1) : open;
  return { open, peek };
}

/**
 * One rule for the hot path's tags and the cold path's record: within the usual limit is open;
 * beyond it is a hint, unless she has hinted at it before, when the glimpse becomes the story.
 */
export function levelFor(
  depth: number,
  open: number,
  ledger: DisclosureLevel | undefined,
): DisclosureLevel {
  return depth <= open || ledger !== undefined ? "open" : "peek";
}

/** Read-only. No relationship yet: a stranger. */
export async function loadDepth(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  herOpenness: Openness | null,
  reachOut: boolean,
): Promise<DepthLimits> {
  const settings = deps.config.relationship;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return FIRST_DEPTH;
  const params = await relationshipRepo.getParams(deps.db, userId);
  return depthFor(
    {
      closeness: params.closeness.value,
      userDisclosure: params.user_disclosure.value,
      recentDepths: await recentDisclosureDepths(
        deps.db,
        userId,
        settings.depth.reciprocity_window,
      ),
      herDisclosure: herOpenness?.disclosure ?? null,
      session: row.session,
      reachOut,
    },
    settings,
  );
}
