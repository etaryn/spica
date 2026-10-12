/**
 * Saving the profile card swap: check the answers against the quiz, work out what they have in
 * common, and write the card and both sides' memories together, so a card never exists without
 * its memories or the other way round.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { getOnboarding, insertOnboarding } from "@/db/repos/user/onboarding";
import type { Deps } from "@/mind/platform/deps";
import { cardFacts } from "./card-facts";
import { answersSchema, loadQuiz } from "./quiz";
import { commonTopics } from "./score";

export type SubmitResult = { status: 201 } | { status: 400 | 409; error: string };

const Body = z.object({ quiz_version: z.string(), answers: z.unknown() });

class AlreadyDone extends Error {}

export async function submitCard(
  deps: Pick<Deps, "db" | "config" | "embedder" | "clock">,
  user: { id: string; name: string },
  body: unknown,
): Promise<SubmitResult> {
  const cfg = deps.config.onboarding;
  const parsed = Body.safeParse(body);
  if (!parsed.success) return { status: 400, error: "invalid_body" };
  if (parsed.data.quiz_version !== cfg.quiz_version) return { status: 409, error: "stale_quiz" };
  const quiz = loadQuiz(cfg.quiz_version);
  const answers = answersSchema(quiz, cfg.max_answer_chars).safeParse(parsed.data.answers);
  if (!answers.success) return { status: 400, error: "invalid_answers" };

  // Checked again by the insert, for two tabs submitting at once; this only saves the embed calls.
  if (await getOnboarding(deps.db, user.id)) return { status: 409, error: "already_done" };

  // Embedding happens before the transaction so a slow embedder never holds it open.
  const facts = cardFacts(quiz, answers.data, user.name, cfg);
  const topics = await commonTopics(quiz, answers.data, deps.embedder, cfg.topic_similarity);
  const vectors = await deps.embedder.embed(
    facts.map((f) => f.content),
    "document",
  );
  const now = deps.clock.now();

  try {
    await deps.db.transaction(async (tx) => {
      const fresh = await insertOnboarding(tx, user.id, {
        quiz_version: cfg.quiz_version,
        answers: answers.data,
        topics,
        completed_at: now,
      });
      if (!fresh) throw new AlreadyDone();
      for (const [i, f] of facts.entries()) {
        await insertFact(tx, user.id, {
          subject: f.subject,
          kind: f.kind,
          content: f.content,
          embedding: vectors[i]!,
          entity_refs: [],
          created_at: now,
          status: "open",
          salience: f.salience,
          valence: 0,
          confidence: cfg.confidence,
          source: "onboarding",
          source_ref: `onboarding:${cfg.quiz_version}`,
        });
      }
    });
  } catch (e) {
    if (e instanceof AlreadyDone) return { status: 409, error: "already_done" };
    throw e;
  }
  return { status: 201 };
}
