import Link from "next/link";
import { listRememberedFacts } from "@/db/repos/facts";
import { getDeps } from "@/lib/deps";
import { requireUser } from "@/lib/session";
import { ForgetButton } from "./forget-button";
import styles from "./memory.module.css";

const LABELS: Record<string, string> = {
  event: "Things that happened", trait: "About you", preference: "What you like", state: "How things are",
  opinion: "What you think", feeling: "How you felt", promise: "Plans and promises",
};

export default async function MemoryPage() {
  const user = await requireUser();
  const facts = await listRememberedFacts(getDeps().db, user.id);
  const groups = new Map<string, typeof facts>();
  for (const f of facts) groups.set(f.kind, [...(groups.get(f.kind) ?? []), f]);
  return (
    <main className={styles.wrap}>
      <Link href="/chat">← Back to chat</Link>
      <h1>What Spica remembers about you</h1>
      <p className={styles.note}>
        Forgetting something removes it from what Spica recalls. Your chat history itself stays until you delete your
        account, and her last ~20 messages with you are still in her short-term view of the conversation.
      </p>
      {facts.length === 0 && <p className={styles.note}>Nothing yet. Memories appear here as you talk.</p>}
      {[...groups].map(([kind, rows]) => (
        <section key={kind}>
          <h2>{LABELS[kind] ?? kind}</h2>
          <ul className={styles.list}>
            {rows.map((f) => (
              <li key={f.id}>
                <span>{f.content}</span>
                <ForgetButton factId={f.id} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
