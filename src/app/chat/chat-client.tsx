"use client";

import { useEffect, useRef, useState } from "react";
import type { CrisisCard } from "@/core/config";
import styles from "./chat.module.css";

export type UiMessage = {
  id: string;
  role: "user" | "companion";
  parts: string[];
  crisisCard: CrisisCard | null;
  status: "sent" | "pending" | "failed";
};

export function ChatClient({ initial }: { initial: UiMessage[] }) {
  const [messages, setMessages] = useState<UiMessage[]>(initial);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, waiting]);

  const patch = (id: string, change: Partial<UiMessage>) =>
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...change } : x)));

  async function deliver(id: string, text: string) {
    setWaiting(true);
    patch(id, { status: "pending" });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId: id, text }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { patch(id, { status: "failed", crisisCard: body.crisisCard ?? null }); return; }
      setMessages((m) => {
        const next = m.map((x) => (x.id === id ? { ...x, status: "sent" as const, crisisCard: null } : x));
        if (next.some((x) => x.id === body.turnId)) return next; // retry of an already-answered message
        return [...next, { id: body.turnId, role: "companion", parts: body.parts, crisisCard: body.crisisCard, status: "sent" }];
      });
    } catch {
      patch(id, { status: "failed" });
    } finally {
      setWaiting(false);
    }
  }

  function send() {
    const text = draft.trim();
    if (!text || waiting) return;
    const id = crypto.randomUUID();
    setMessages((m) => [...m, { id, role: "user", parts: [text], crisisCard: null, status: "pending" }]);
    setDraft("");
    void deliver(id, text);
  }

  return (
    <>
      <main className={styles.log} aria-live="polite">
        {messages.length === 0 && <p className={styles.empty}>Say hi. This is the start of your conversation.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? styles.rowUser : styles.rowCompanion}>
            {m.parts.map((p, i) => (
              <p key={i} className={m.role === "user" ? styles.bubbleUser : styles.bubbleCompanion}>{p}</p>
            ))}
            {m.status === "failed" && (
              <button className={styles.retry} onClick={() => deliver(m.id, m.parts[0] ?? "")} disabled={waiting}>
                Not delivered · retry
              </button>
            )}
            {m.crisisCard && (
              <aside className={styles.crisis} role="note">
                <strong>{m.crisisCard.title}</strong>
                <ul>{m.crisisCard.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </aside>
            )}
          </div>
        ))}
        {waiting && <p className={styles.typing} aria-label="typing">•••</p>}
        <div ref={endRef} />
      </main>
      <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message"
          rows={1}
          maxLength={4000}
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim() || waiting}>Send</button>
      </form>
    </>
  );
}
