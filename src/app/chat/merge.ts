import type { HistoryMessage } from "@/app/api/chat/history/handler";
import type { CrisisCard } from "@/mind/platform/config";

export type UiMessage = {
  id: string;
  role: "user" | "companion";
  parts: string[];
  crisisCard: CrisisCard | null;
  status: "sent" | "pending" | "failed";
  /**
   * Total part count for a companion reply. Set from the SSE event in `applyPart`, and to
   * `parts.length` in `mergeHistory` (a history/POST copy is complete by definition). Unset for user
   * messages. `parts.length < of` means the bubble is still filling in — see `catchUpAnchor`.
   */
  of?: number;
  /** "backchannel" renders as a small bubble; null when the turn wasn't one. */
  trigger?: string | null;
  /**
   * Sent from this tab and not yet seen in server history. A POST 202 marks it "sent" but says nothing about
   * what the server stored before it (a reply emitted while SSE was down), so it's never a catch-up anchor.
   */
  local?: boolean;
};

/** One SSE bubble. Parts arrive in order; a repeat (reconnect, history overlap) is ignored. */
export function applyPart(
  msgs: UiMessage[],
  e: {
    turnId: string;
    part: number;
    of: number;
    text: string;
    crisisCard: CrisisCard | null;
    trigger?: string | null;
  },
): UiMessage[] {
  const i = msgs.findIndex((m) => m.id === e.turnId);
  if (i === -1) {
    if (e.part !== 0) return msgs; // a later part without its first: history catch-up will supply it
    return [
      ...msgs,
      {
        id: e.turnId,
        role: "companion",
        parts: [e.text],
        crisisCard: e.crisisCard,
        status: "sent",
        of: e.of,
        trigger: e.trigger ?? null,
      },
    ];
  }
  const m = msgs[i]!;
  if (e.part < m.parts.length) return msgs;
  if (e.part !== m.parts.length) return msgs;
  const next = [...msgs];
  next[i] = {
    ...m,
    parts: [...m.parts, e.text],
    crisisCard: m.crisisCard ?? e.crisisCard,
    of: e.of,
    trigger: m.trigger ?? e.trigger ?? null,
  };
  return next;
}

/** Catch-up after (re)connecting: add turns we don't have; a fuller server copy of a reply wins. */
export function mergeHistory(msgs: UiMessage[], incoming: HistoryMessage[]): UiMessage[] {
  const next = [...msgs];
  // `incoming` is in server order: a missing turn goes right after its predecessor from the same page, so a
  // reply recovered after a reconnect lands above the messages the user sent after it, not at the bottom.
  let prev = -1;
  for (const h of incoming) {
    const i = next.findIndex((m) => m.id === h.id);
    const ui: UiMessage = {
      id: h.id,
      role: h.role,
      parts: h.parts,
      crisisCard: h.crisisCard,
      status: "sent",
      trigger: h.trigger ?? null,
      ...(h.role === "companion" ? { of: h.parts.length } : {}),
    };
    if (i === -1) {
      if (prev === -1) {
        next.push(ui);
        prev = next.length - 1;
      } else {
        next.splice(prev + 1, 0, ui);
        prev += 1;
      }
      continue;
    }
    if (h.role === "companion" && h.parts.length > next[i]!.parts.length) next[i] = ui;
    else if (h.role === "user") next[i] = { ...next[i]!, status: "sent", local: false };
    prev = i;
  }
  return next;
}

export function markFailed(msgs: UiMessage[], ids: string[]): UiMessage[] {
  return msgs.map((m) => (ids.includes(m.id) ? { ...m, status: "failed" } : m));
}

/**
 * The id to pass as `?after=` on the next history catch-up (round 1 fix). Anchoring on "last sent
 * message" strands a reply mid-delivery: after a reconnect between part 0 and part 1, that companion
 * message is already "sent" so it's never re-fetched and its remaining parts never arrive. Instead,
 * anchor just before the first still-filling companion message (parts.length < of), skipping back over
 * any local-only pending/failed messages (the server doesn't have those yet, so they're not valid
 * anchors). Returns null when there's nothing usable to anchor on (fetch full history instead).
 */
export function catchUpAnchor(msgs: UiMessage[]): string | null {
  const incompleteIdx = msgs.findIndex(
    (m) => m.role === "companion" && m.of !== undefined && m.parts.length < m.of,
  );
  const end = incompleteIdx === -1 ? msgs.length : incompleteIdx;
  for (let i = end - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.status === "pending" || m.status === "failed" || m.local) continue;
    return m.id;
  }
  return null;
}
