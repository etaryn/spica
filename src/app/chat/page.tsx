import Link from "next/link";
import { toHistoryMessage } from "@/app/api/chat/history/handler";
import { recentTurns } from "@/db/repos/session-log";
import { getDeps } from "@/lib/deps";
import { requireUser } from "@/lib/session";
import { ChatClient, type UiMessage } from "./chat-client";
import styles from "./chat.module.css";

export default async function ChatPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  const turns = await recentTurns(db, user.id, config.chat.history_page_size);
  const initial: UiMessage[] = turns.map((t) => {
    const { trigger: _trigger, ...h } = toHistoryMessage(t, config);
    return { ...h, status: "sent" as const };
  });
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.title}>Spica</span>
        <Link href="/memory" className={styles.settings}>Memory</Link>
        <Link href="/settings" className={styles.settings}>Settings</Link>
      </header>
      <ChatClient initial={initial} />
    </div>
  );
}
