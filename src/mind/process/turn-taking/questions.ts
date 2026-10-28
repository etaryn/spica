/**
 * Open questions: the user's own words, held as where they sit in their messages and never
 * rewritten. Code slices the words back out to show them. The judge can keep or drop only the
 * questions it was shown and add only from the new messages; one closed meanwhile (her reply
 * answered it) never comes back.
 */
import type { Db } from "@/db/client";
import { getTurnsByIds } from "@/db/repos/user/session-log";
import type { OpenQuestion } from "@/db/schema";

type Coordinate = OpenQuestion["coords"][number];
export type ShownQuestion = { question: OpenQuestion; text: string };
/** What one judge call did to the open questions. */
export type QuestionVerdict = {
  shown: OpenQuestion[];
  kept: OpenQuestion[];
  asked: OpenQuestion[];
};

export function sameQuestion(a: OpenQuestion, b: OpenQuestion): boolean {
  return JSON.stringify(a.coords) === JSON.stringify(b.coords);
}

export function overlaps(a: Coordinate, b: Coordinate): boolean {
  return a.turnId === b.turnId && a.start < b.end && b.start < a.end;
}

export function sharesWords(a: OpenQuestion, b: OpenQuestion): boolean {
  return a.coords.some((x) => b.coords.some((y) => overlaps(x, y)));
}

/** Applied under the state lock, against what is open now, not what the judge read. */
export function openAfter(
  current: OpenQuestion[],
  verdict: QuestionVerdict | null,
  max: number,
): OpenQuestion[] {
  if (!verdict) return current;
  const holds = (list: OpenQuestion[], q: OpenQuestion) => list.some((x) => sameQuestion(x, q));
  const still = current.filter((q) => !holds(verdict.shown, q) || holds(verdict.kept, q));
  const fresh = verdict.asked.filter((q) => !still.some((s) => sharesWords(s, q)));
  return [...still, ...fresh].slice(0, max);
}

/** Each question with its words, its pieces joined as a move's are; one whose words are gone is left out. */
export async function withWords(
  db: Db,
  userId: string,
  questions: OpenQuestion[],
): Promise<ShownQuestion[]> {
  if (questions.length === 0) return [];
  const ids = [...new Set(questions.flatMap((q) => q.coords.map((c) => c.turnId)))];
  const text = new Map((await getTurnsByIds(db, userId, ids)).map((t) => [t.id, t.text]));
  return questions.flatMap((question) => {
    const parts = question.coords.map((c) => {
      const words = text.get(c.turnId);
      return words !== undefined && c.end <= words.length ? words.slice(c.start, c.end) : null;
    });
    // A lost message drops the question; an empty slice is only left out.
    if (parts.some((p) => p === null)) return [];
    const said = parts.filter(Boolean);
    return said.length ? [{ question, text: said.join(" / ") }] : [];
  });
}
