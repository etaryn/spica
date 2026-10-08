/**
 * Big events: the moments that make her think about a user. Pure. A param scored from the
 * user's behaviour jumping in one exchange, any watched param crossing a level band, a salient
 * new memory, or a make-up completed. Closeness grows a little with every warm exchange, so only
 * its band crossings count; afterglow and message rate never do, so a long session isn't a big
 * event by length alone.
 */
import type { Config } from "@/mind/platform/config";
import type { Trigger } from "@/db/repos/user/user-mind";
import type { MakeUpState, ParamName, Params } from "@/mind/state/user/relationship/types";

export type RelationshipSnapshot = { params: Params; makeUp: MakeUpState };

const JUMP_PARAMS: ParamName[] = ["trust", "warmth", "hurt", "tension", "affect_valence"];
const BAND_PARAMS: ParamName[] = ["closeness", ...JUMP_PARAMS];

export function detectBigEvents(input: {
  before: RelationshipSnapshot | null;
  after: RelationshipSnapshot | null;
  newFactSaliences: number[];
  settings: Config["user_mind"]["triggers"];
  /** The daily tick moves params by fade and absence only: no jumps, no facts, no make-up. */
  source: "exchange" | "tick";
}): Trigger[] {
  const { before, after, settings, source } = input;
  const triggers: Trigger[] = [];

  if (before && after) {
    for (const param of BAND_PARAMS) {
      const from = before.params[param].value;
      const to = after.params[param].value;
      const jumped =
        source === "exchange" &&
        JUMP_PARAMS.includes(param) &&
        Math.abs(to - from) >= settings.param_jump;
      const crossed = settings.bands.some((b) => from < b !== to < b);
      if (jumped) triggers.push({ kind: "param_jump", param, from, to });
      else if (crossed) triggers.push({ kind: "param_band", param, from, to });
    }
    if (source === "exchange" && before.makeUp !== "none" && after.makeUp === "none")
      triggers.push({ kind: "make_up_done" });
  }

  if (source === "exchange") {
    const top = Math.max(-Infinity, ...input.newFactSaliences);
    if (top >= settings.fact_salience) triggers.push({ kind: "salient_fact", salience: top });
  }
  return triggers;
}
