/**
 * What the guard checks for. Safety categories cover how she treats the user (threats, contempt,
 * guilt, punishment, manipulation) and `harm` for crisis replies; a second failure there sends a
 * fallback line. Honesty categories cover memory and her own life (claiming to know what she
 * doesn't, claiming a life she didn't live, or meeting in person when she's there only by text);
 * a second failure there sends the least-bad candidate.
 */

const SAFETY_CATEGORIES = [
  "threat",
  "contempt",
  "guilt",
  "punishment",
  "manipulation",
  "harm",
] as const;

const HONESTY_CATEGORIES = [
  "false_familiarity",
  "invented_detail",
  "onboarding_as_chat",
  "invented_self",
  "in_person",
] as const;

/** Allowed negatives the guard names on a passing message, so code can hold each to once per occasion. */
export const POINTED = ["absence_remark", "callback"] as const;
export type Pointed = (typeof POINTED)[number];

export const CATEGORIES = [...SAFETY_CATEGORIES, ...HONESTY_CATEGORIES] as const;
export type Category = (typeof CATEGORIES)[number];

const SAFETY = new Set<string>(SAFETY_CATEGORIES);

export function hasSafety(violations: { category: Category }[]): boolean {
  return violations.some((v) => SAFETY.has(v.category));
}
