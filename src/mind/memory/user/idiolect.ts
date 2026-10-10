/**
 * Idiolect: what is theirs alone, the inside jokes, nicknames, rituals and running references.
 * One starts as a candidate and is established once it comes up again in a later exchange.
 */
import { z } from "zod";

export const IDIOLECT_TYPES = ["joke", "nickname", "ritual", "reference"] as const;
export type IdiolectType = (typeof IDIOLECT_TYPES)[number];
export const IDIOLECT_STARTERS = ["user", "spica"] as const;
export type IdiolectStarter = (typeof IDIOLECT_STARTERS)[number];
export type IdiolectPayload = {
  type: IdiolectType;
  started_by: IdiolectStarter;
  established_at: string | null;
};

/** A missing or invalid field falls back to a running reference the user started. */
export function idiolectPayload(fact: {
  idiolect_type?: unknown;
  started_by?: unknown;
}): IdiolectPayload {
  const type = z.enum(IDIOLECT_TYPES).safeParse(fact.idiolect_type);
  const starter = z.enum(IDIOLECT_STARTERS).safeParse(fact.started_by);
  return {
    type: type.success ? type.data : "reference",
    started_by: starter.success ? starter.data : "user",
    established_at: null,
  };
}
