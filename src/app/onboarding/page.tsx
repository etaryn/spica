/**
 * The profile card swap: how Spica meets people. Taken once, before the first chat.
 */
import { redirect } from "next/navigation";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";
import { QuizClient, type ClientQuestion } from "./quiz-client";

export default async function OnboardingPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  if (await getOnboarding(db, user.id)) redirect("/chat");
  const quiz = loadQuiz(config.onboarding.quiz_version);
  // Only what the screen shows: the weights and fact wording stay on the server.
  const questions: ClientQuestion[] = quiz.questions.map((q) =>
    q.kind === "choice"
      ? {
          kind: "choice",
          id: q.id,
          prompt: q.prompt,
          options: q.options.map((o) => o.label),
          her: q.her,
        }
      : { kind: "open", id: q.id, prompt: q.prompt, maxWords: q.max_words, her: q.her },
  );
  return (
    <QuizClient
      intro={quiz.intro}
      version={config.onboarding.quiz_version}
      maxChars={config.onboarding.max_answer_chars}
      questions={questions}
    />
  );
}
