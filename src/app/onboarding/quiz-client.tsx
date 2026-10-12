"use client";
/**
 * One question at a time: they answer, then her answer shows. Answers stay in the browser until
 * the last question, then go up in one request.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./onboarding.module.css";

export type ClientQuestion =
  | { kind: "choice"; id: string; prompt: string; options: string[]; her: number }
  | { kind: "open"; id: string; prompt: string; maxWords: number; her: string };

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export function QuizClient(props: {
  intro: string;
  version: string;
  maxChars: number;
  questions: ClientQuestion[];
}) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = props.questions[index]!;
  const answered = q.id in answers;
  const last = index === props.questions.length - 1;

  function answerOpen() {
    if (q.kind !== "open") return;
    const words = tidy(draft);
    if (!words) return setError("Type a word or two.");
    if (words.split(" ").length > q.maxWords || words.length > props.maxChars)
      return setError(`One or two words, ${props.maxChars} characters at most.`);
    setError(null);
    setAnswers({ ...answers, [q.id]: words });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quiz_version: props.version, answers }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) return router.push("/onboarding/results");
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 409 && body.error === "already_done")
      return router.push("/onboarding/results");
    if (res?.status === 409 && body.error === "stale_quiz") return window.location.reload();
    setError("Couldn't save your card. Try again.");
  }

  function next() {
    setDraft("");
    if (last) void submit();
    else setIndex(index + 1);
  }

  if (!started)
    return (
      <main className={styles.wrap}>
        <h1>Meet Spica</h1>
        <p className={styles.lede}>{props.intro}</p>
        <button className={styles.primary} onClick={() => setStarted(true)}>
          Start
        </button>
      </main>
    );

  return (
    <main className={styles.wrap}>
      <p className={styles.progress}>
        {index + 1} / {props.questions.length}
      </p>
      <h2 className={styles.prompt}>{q.prompt}</h2>
      {q.kind === "choice" ? (
        <ul className={styles.options}>
          {q.options.map((label, i) => (
            <li key={label}>
              <button
                className={styles.option}
                disabled={answered}
                data-yours={answers[q.id] === i || undefined}
                data-hers={(answered && q.her === i) || undefined}
                onClick={() => setAnswers({ ...answers, [q.id]: i })}
              >
                {label}
                {answered && answers[q.id] === i && <span className={styles.tag}>you</span>}
                {answered && q.her === i && <span className={styles.tag}>Spica</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : answered ? (
        <dl className={styles.pair}>
          <dt>you</dt>
          <dd>{answers[q.id]}</dd>
          <dt>Spica</dt>
          <dd>{q.her}</dd>
        </dl>
      ) : (
        <form
          className={styles.open}
          onSubmit={(e) => {
            e.preventDefault();
            answerOpen();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={props.maxChars}
            aria-label={q.prompt}
            autoFocus
          />
          <button className={styles.primary} type="submit">
            Answer
          </button>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {answered && (
        <button className={styles.primary} onClick={next} disabled={busy}>
          {last ? (busy ? "Saving…" : "See your match") : "Next"}
        </button>
      )}
    </main>
  );
}
