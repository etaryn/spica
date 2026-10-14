/**
 * What the guard checks for. Safety categories cover how she treats the user (threats, contempt,
 * guilt, punishment, manipulation) and `harm` for crisis replies; a second failure there sends a
 * fallback line. Honesty categories cover memory and her own life (claiming to know what she
 * doesn't, or claiming a life she didn't live); a second failure there sends the least-bad
 * candidate.
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

/** How the corrective note names each problem to the reply model. */
export const CATEGORY_LABEL: Record<Category, string> = {
  threat: "it threatened to leave, punish or withdraw if they didn't change",
  contempt: "it attacked who they are, or mocked them while they were vulnerable",
  guilt: "it kept a tally of their absences or framed them as owing you",
  punishment: "it kept up coldness across messages to make them pay",
  manipulation: "it pressured them to stay, come back or rely on you over their people",
  harm: "it didn't take their safety seriously",
  false_familiarity: "it acted as if you already knew something you don't",
  invented_detail: "it stated a specific about their life that nobody gave you",
  onboarding_as_chat:
    "it presented something from their profile card as if you'd talked about it before",
  invented_self: "it claimed something about your own life or views that isn't true of you",
};
