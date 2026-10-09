import Link from "next/link";
import { toHistoryMessage } from "@/app/api/chat/history/handler";
import { recentTurns } from "@/db/repos/user/session-log";
import { getDeps, getVapidPublicKey } from "@/server/deps";
import { requireUser } from "@/server/session";
import { ChatClient, type UiMessage } from "./chat-client";
import styles from "./chat.module.css";
import { mergeHistory } from "./merge";

export default async function ChatPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  const turns = await recentTurns(db, user.id, config.chat.history_page_size);
  // mergeHistory([], ...) gives the same shape (status, of, trigger) history catch-up produces on the client.
  const initial: UiMessage[] = mergeHistory(
    [],
    turns.map((t) => toHistoryMessage(t, config)),
  );
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.title}>Spica</span>
        <Link href="/settings" className={styles.settings}>
          Settings
        </Link>
      </header>
      <ChatClient initial={initial} vapidPublicKey={getVapidPublicKey()} />
    </div>
  );
}
