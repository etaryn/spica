/**
 * The "busy, later?" note: one short message, sent at most once per busy or offline block and
 * only while the deferral is still pending. Its wording is picked from a prompt file without any
 * model call, and it is never extracted into memory.
 */
import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import type { Deps } from "@/mind/platform/deps";
import type { BackchannelJob } from "@/mind/platform/jobs";
import { loadPrompt } from "@/mind/platform/prompts";
import { seededUnit } from "@/mind/platform/seeded-random";
import { deliverPart } from "@/mind/process/deliver";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import { mutateState } from "@/mind/process/turn-taking/state";
import * as T from "@/mind/process/turn-taking/transitions";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";

function pickNote(phrases: Phrases, kind: "busy" | "offline", seed: string): string | null {
  const options = phrases[kind] ?? [];
  if (!options.length) return null;
  return options[Math.floor(seededUnit(seed) * options.length)]!;
}

export async function runAvailabilityNote(
  deps: Deps,
  job: BackchannelJob,
): Promise<"sent" | "skipped" | "dropped"> {
  const { db, clock, config } = deps;
  if (!job.blockKind || !job.blockStart) return "skipped";

  const now = clock.now();
  const stillDeferred = await mutateState(db, job.userId, now, (state) =>
    T.availabilityNote(state, { now }),
  );
  if (!stillDeferred) return "skipped";

  const blockStart = new Date(job.blockStart);
  if (await sessionLog.hasTriggerSince(db, job.userId, "availability", blockStart)) {
    return "skipped";
  }

  const phrases = parseSummaryPhrases(
    loadPrompt("life/availability", config.prompts.life_availability),
  );
  const text = pickNote(phrases, job.blockKind, job.turnId);
  const anchor = await sessionLog.getTurn(db, job.userId, job.turnId);
  if (!text || !anchor) return "skipped";

  const recent = await sessionLog.turnsUpTo(db, job.userId, anchor, config.chat.recent_turns);
  const guarded = await guardOutgoing(deps, {
    userId: job.userId,
    turnId: anchor.id,
    first: text,
    input: {
      kind: "availability",
      recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      recalledFacts: [],
      onboardingFacts: [],
    },
  });
  if (!guarded.text) {
    await guarded.writeLog();
    return "dropped";
  }

  const insertAt = clock.now();
  const note = await mutateState<Turn | null>(db, job.userId, insertAt, async (state, tx) => {
    if (!T.availabilityNote(state, { now: insertAt }).result) return { patch: null, result: null };

    const row = await sessionLog.insertTurn(tx, job.userId, {
      id: randomUUID(),
      session_id: anchor.session_id,
      role: "companion",
      text: guarded.text,
      created_at: insertAt,
      trigger: "availability",
      extracted: true,
    });
    return { patch: null, result: row };
  });
  await guarded.writeLog();
  if (!note) return "skipped";

  await deliverPart(deps, job.userId, { turnId: note.id, part: 0, parts: [note.text] });
  return "sent";
}
