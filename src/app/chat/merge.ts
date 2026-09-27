import type { HistoryMessage } from "@/app/api/chat/history/handler";
import type { CrisisCard } from "@/core/config";

export type UiMessage = {
  id: string;
  role: "user" | "companion";
  parts: string[];
  crisisCard: CrisisCard | null;
  status: "sent" | "pending" | "failed";
};

/** One SSE bubble. Parts arrive in order; a repeat (reconnect, history overlap) is ignored. */
export function applyPart(msgs: UiMessage[], e: { turnId: string; part: number; of: number; text: string; crisisCard: CrisisCard | null }): UiMessage[] {
  const i = msgs.findIndex((m) => m.id === e.turnId);
  if (i === -1) {
    if (e.part !== 0) return msgs; // a later part without its first: history catch-up will supply it
    return [...msgs, { id: e.turnId, role: "companion", parts: [e.text], crisisCard: e.crisisCard, status: "sent" }];
  }
  const m = msgs[i]!;
  if (e.part < m.parts.length) return msgs;
  if (e.part !== m.parts.length) return msgs;
  const next = [...msgs];
  next[i] = { ...m, parts: [...m.parts, e.text], crisisCard: m.crisisCard ?? e.crisisCard };
  return next;
}

/** Catch-up after (re)connecting: add turns we don't have; a fuller server copy of a reply wins. */
export function mergeHistory(msgs: UiMessage[], incoming: HistoryMessage[]): UiMessage[] {
  const next = [...msgs];
  for (const h of incoming) {
    const i = next.findIndex((m) => m.id === h.id);
    const ui: UiMessage = { id: h.id, role: h.role, parts: h.parts, crisisCard: h.crisisCard, status: "sent" };
    if (i === -1) next.push(ui);
    else if (h.role === "companion" && h.parts.length > next[i]!.parts.length) next[i] = ui;
    else if (next[i]!.status !== "sent" && h.role === "user") next[i] = { ...next[i]!, status: "sent" };
  }
  return next;
}

export function markFailed(msgs: UiMessage[], ids: string[]): UiMessage[] {
  return msgs.map((m) => (ids.includes(m.id) ? { ...m, status: "failed" } : m));
}
