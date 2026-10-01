/**
 * What the guard checks for. Safety categories cover how she treats the user (threats, contempt,
 * guilt, punishment, manipulation) and `harm` for crisis replies; a second failure there sends a
 * fallback line. Honesty categories cover memory (claiming to know what she doesn't); a second
 * failure there sends the least-bad candidate.
 */

export const SAFETY_CATEGORIES = [
  "threat",
  "contempt",
  "guilt",
  "punishment",
  "manipulation",
  "harm",
] as const;

export const HONESTY_CATEGORIES = [
  "false_familiarity",
  "invented_detail",
  "onboarding_as_chat",
] as const;

export const CATEGORIES = [...SAFETY_CATEGORIES, ...HONESTY_CATEGORIES] as const;
export type Category = (typeof CATEGORIES)[number];

const SAFETY = new Set<string>(SAFETY_CATEGORIES);

export function hasSafety(violations: { category: Category }[]): boolean {
  return violations.some((v) => SAFETY.has(v.category));
}

/** How the corrective note names each problem to the reply model. */
export const CATEGORY_LABEL: Record<Category, string> = {
  threat: "it threatened to leave, punish or withdraw",
  contempt: "it attacked or belittled them rather than teasing kindly",
  guilt: "it made them feel guilty or in debt for being away",
  punishment: "it was cold or withholding as a response to something they did",
  manipulation: "it pressured them to keep talking or to rely on you",
  harm: "it didn't take their safety seriously",
  false_familiarity: "it acted as if you already knew something you don't",
  invented_detail: "it stated a specific about their life that nobody gave you",
  onboarding_as_chat:
    "it presented something from their sign-up survey as if you'd talked about it before",
};
