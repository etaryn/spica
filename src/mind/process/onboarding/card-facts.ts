/**
 * Both profile cards as memories: their card as impressions of them, hers as what she has told
 * them about herself. First impressions only, so later conversation can override them; only their
 * name is kept at full weight so it never fades.
 */
import type { Answers, Quiz } from "./quiz";
import { positionOf } from "./score";

export type CardFact = {
  subject: "user" | "self";
  kind: "trait" | "preference";
  content: string;
  salience: number;
};

export function cardFacts(
  quiz: Quiz,
  answers: Answers,
  name: string,
  cfg: { neutral_band: number; salience: number; max_name_chars: number },
): CardFact[] {
  const theirs = (kind: CardFact["kind"], content: string): CardFact => ({
    subject: "user",
    kind,
    content,
    salience: cfg.salience,
  });
  // The signup name is unchecked user input, and this fact rides along in every reply for good.
  const shortName = name.trim().slice(0, cfg.max_name_chars).trim();
  const facts: CardFact[] = shortName
    ? [{ subject: "user", kind: "trait", content: `Their name is ${shortName}.`, salience: 1 }]
    : [];
  for (const d of quiz.dimensions) {
    const you = positionOf(quiz, answers, d.id);
    const content =
      Math.abs(you - 50) <= cfg.neutral_band
        ? d.fact_middle
        : you < 50
          ? d.fact_left
          : d.fact_right;
    facts.push(theirs("trait", content));
  }
  for (const q of quiz.questions) {
    if (q.kind === "open")
      facts.push(
        theirs(
          "preference",
          q.fact.replace("{answer}", () => String(answers[q.id])),
        ),
      );
  }
  for (const q of quiz.questions) {
    if (q.her_fact)
      facts.push({
        subject: "self",
        kind: "preference",
        content: q.her_fact,
        salience: cfg.salience,
      });
  }
  return facts;
}
