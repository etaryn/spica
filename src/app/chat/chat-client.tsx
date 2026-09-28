"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryMessage } from "@/app/api/chat/history/handler";
import styles from "./chat.module.css";
import { applyPart, catchUpAnchor, markFailed, mergeHistory, type UiMessage } from "./merge";

export type { UiMessage };

export function ChatClient({ initial }: { initial: UiMessage[] }) {
  const [messages, setMessages] = useState<UiMessage[]>(initial);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<UiMessage[]>(initial);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, typing]);

  // One stream per tab: replies, backchannels and typing arrive here (v2 §4). On every (re)connect, catch up from history.
  useEffect(() => {
    let es: EventSource;
    let backoff = RECONNECT_MIN_MS;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      es = new EventSource("/api/events");
      es.addEventListener("open", async () => {
        backoff = RECONNECT_MIN_MS;
        setTyping(false); // a typing:off missed while disconnected must not leave the dots up (a reply mid-typing just shows no dots until its bubble)
        // Anchor just before any still-filling reply, not on the last "sent" bubble: a companion
        // message is marked sent on its first part, so anchoring there would strand its later parts
        // after a mid-reply reconnect (round 1 fix).
        const after = catchUpAnchor(messagesRef.current);
        const res = await fetch(`/api/chat/history${after ? `?after=${after}` : ""}`).catch(() => null);
        if (res?.ok) {
          const body = (await res.json()) as { messages: HistoryMessage[] };
          setMessages((m) => mergeHistory(m, body.messages));
        }
      });
      es.addEventListener("typing", (e) => setTyping(JSON.parse((e as MessageEvent).data).on === true));
      es.addEventListener("message", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        setMessages((m) => applyPart(m, d));
      });
      es.addEventListener("reply_failed", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { turnIds: string[] };
        setTyping(false);
        setMessages((m) => markFailed(m, d.turnIds));
      });
      // A non-200 response or an abnormal stream end can drive EventSource to CLOSED, where it
      // stops auto-reconnecting on its own. Reconnect ourselves with a doubling backoff.
      es.addEventListener("error", () => {
        if (closed || es.readyState !== EventSource.CLOSED) return;
        backoffTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      });
    }
    connect();

    return () => {
      closed = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      es.close();
    };
  }, []);

  const patch = (id: string, change: Partial<UiMessage>) =>
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...change } : x)));

  async function deliver(id: string, text: string) {
    patch(id, { status: "pending" });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId: id, text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { patch(id, { status: "failed", crisisCard: body.crisisCard ?? null }); return; }
      patch(id, { status: "sent", crisisCard: null });
      if (res.status === 200 && body.status === "replied") {
        // Crisis: the reply comes back in the response too, so the card shows even if SSE is down.
        setMessages((m) => mergeHistory(m, [{ id: body.turnId, role: "companion", parts: body.parts, crisisCard: body.crisisCard, trigger: null }]));
      }
    } catch {
      patch(id, { status: "failed" });
    }
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setMessages((m) => [...m, { id, role: "user", parts: [text], crisisCard: null, status: "pending", local: true }]);
    setDraft("");
    void deliver(id, text);
  }

  return (
    <>
      <main className={styles.log} aria-live="polite">
        {messages.length === 0 && <p className={styles.empty}>Say hi. This is the start of your conversation.</p>}
        {messages.map((m) => {
          const bubbleClass = m.role === "user" ? styles.bubbleUser : m.trigger === "backchannel" ? styles.bubbleBackchannel : styles.bubbleCompanion;
          return (
            <div key={m.id} className={m.role === "user" ? styles.rowUser : styles.rowCompanion}>
              {m.parts.map((p, i) => (
                <p key={i} className={bubbleClass}>{p}</p>
              ))}
              {m.status === "failed" && (
                <button className={styles.retry} onClick={() => deliver(m.id, m.parts[0] ?? "")}>
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
          );
        })}
        {typing && <p className={styles.typing} aria-label="typing">•••</p>}
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
        <button type="submit" disabled={!draft.trim()}>Send</button>
      </form>
    </>
  );
}

// EventSource reconnect backoff (client UI concern, not core config): 1s doubling to 30s, reset on `open`.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
