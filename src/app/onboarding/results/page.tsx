/**
 * The compatibility page: both profile cards, where they sit on each friend dimension against
 * her, and what they have in common. Made to read well as a screenshot.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { cardView } from "@/mind/process/onboarding/score";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";
import styles from "../onboarding.module.css";

export default async function ResultsPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  const row = await getOnboarding(db, user.id);
  if (!row) redirect("/onboarding");
  // A card keeps the quiz it was taken with, even after the quiz file moves on.
  const view = cardView(loadQuiz(row.quiz_version), row.answers, row.topics, config.onboarding);
  return (
    <main className={styles.wrap}>
      <h1>You and Spica</h1>
      <div className={styles.cards}>
        <section className={styles.card}>
          <h2>Spica</h2>
          <ul>
            {view.hers.map((a) => (
              <li key={a.prompt}>{a.answer}</li>
            ))}
          </ul>
        </section>
        <section className={styles.card}>
          <h2>{user.name}</h2>
          <ul>
            {view.yours.map((a) => (
              <li key={a.prompt}>{a.answer}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className={styles.bars}>
        {view.dimensions.map((d) => (
          <div key={d.id} className={styles.bar}>
            <div className={styles.ends}>
              <span>{d.left}</span>
              <span>{d.right}</span>
            </div>
            <div
              className={styles.track}
              role="img"
              aria-label={`${d.left} to ${d.right}: you ${d.you}, Spica ${d.her}`}
            >
              <span className={styles.her} style={{ left: `${d.her}%` }} />
              <span className={styles.you} style={{ left: `${d.you}%` }} />
            </div>
            <p className={styles.basis}>{d.basis}</p>
            {d.line && <p className={styles.line}>“{d.line}”</p>}
          </div>
        ))}
      </section>
      <section>
        <h2>In common</h2>
        {view.noCommon ? (
          <p className={styles.line}>“{view.noCommon}”</p>
        ) : (
          <ul>
            {view.topics.map((t) => (
              <li key={t.yours}>
                {t.yours} · {t.hers}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/chat" className={styles.primary}>
        Meet her
      </Link>
    </main>
  );
}
