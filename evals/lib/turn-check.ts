import type { Turn } from "@/db/repos/user/session-log";
import type { TurnAssertion } from "./script";

/** Deterministic turn-taking check over one session's session_log rows. */
export function checkTurn(
  all: Turn[],
  range: { start: Date; end: Date },
  a: TurnAssertion,
): { ok: boolean; detail?: string } {
  const turns = all.filter((t) => t.created_at >= range.start && t.created_at < range.end);
  const users = turns.filter((t) => t.role === "user");
  const replies = turns.filter((t) => t.role === "companion" && t.reply_to);
  const backchannels = turns.filter((t) => t.trigger === "backchannel");
  const byId = new Map(all.map((t) => [t.id, t]));
  const problems: string[] = [];

  if (a.replies !== undefined && replies.length !== a.replies)
    problems.push(`replies: expected ${a.replies}, got ${replies.length}`);
  if (a.backchannels?.min !== undefined && backchannels.length < a.backchannels.min)
    problems.push(`backchannels: expected ≥ ${a.backchannels.min}, got ${backchannels.length}`);
  if (a.backchannels?.max !== undefined && backchannels.length > a.backchannels.max)
    problems.push(`backchannels: expected ≤ ${a.backchannels.max}, got ${backchannels.length}`);
  const notes = turns.filter((t) => t.trigger === "availability");
  if (a.notes?.min !== undefined && notes.length < a.notes.min)
    problems.push(`notes: expected ≥ ${a.notes.min}, got ${notes.length}`);
  if (a.notes?.max !== undefined && notes.length > a.notes.max)
    problems.push(`notes: expected ≤ ${a.notes.max}, got ${notes.length}`);

  const covers: number[][] = [];
  let prevEnd = -Infinity;
  for (const r of replies) {
    const end = byId.get(r.reply_to!)!.created_at.getTime();
    covers.push(
      users
        .map((u, i) => [u, i + 1] as const)
        .filter(([u]) => u.created_at.getTime() > prevEnd && u.created_at.getTime() <= end)
        .map(([, i]) => i),
    );
    prevEnd = end;
  }
  if (a.reply_covers && JSON.stringify(covers) !== JSON.stringify(a.reply_covers))
    problems.push(
      `reply_covers: expected ${JSON.stringify(a.reply_covers)}, got ${JSON.stringify(covers)}`,
    );

  if (a.max_reply_delay_s !== undefined || a.min_reply_delay_s !== undefined) {
    replies.forEach((r, i) => {
      // A reply covering no user turn in this session (its anchor is earlier) has no first message to measure from.
      const firstIdx = covers[i]?.[0];
      if (firstIdx === undefined) return;
      const first = users[firstIdx - 1]!;
      const delay = (r.created_at.getTime() - first.created_at.getTime()) / 1000;
      if (a.max_reply_delay_s !== undefined && delay > a.max_reply_delay_s)
        problems.push(
          `reply ${i + 1} came ${delay}s after its first message (max ${a.max_reply_delay_s}s)`,
        );
      if (a.min_reply_delay_s !== undefined && delay < a.min_reply_delay_s)
        problems.push(
          `reply ${i + 1} came ${delay}s after its first message (min ${a.min_reply_delay_s}s)`,
        );
    });
  }
  return problems.length ? { ok: false, detail: problems.join("; ") } : { ok: true };
}
