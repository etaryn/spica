/**
 * Their gender, asked once at signup, and the line she keeps about it: the pronouns to use. Asked
 * because a guess roots in her memory, and users can't correct her memory directly.
 */
export const GENDERS = ["woman", "man", "non-binary", "unspecified"] as const;
export type Gender = (typeof GENDERS)[number];

export const isGender = (g: unknown): g is Gender => GENDERS.includes(g as Gender);

const LINES: Record<Gender, string> = {
  woman: "They're a woman; use she/her for them.",
  man: "They're a man; use he/him for them.",
  "non-binary": "They're non-binary; use they/them for them.",
  unspecified: "They didn't say their gender; use they/them for them.",
};

export function genderFact(g: Gender): string {
  return LINES[g];
}
