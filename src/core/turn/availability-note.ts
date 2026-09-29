import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import type { Deps } from "../deps";
import { emit } from "../events";
import { guardOutgoing } from "../guard/outgoing";
import { loadPrompt } from "../prompts";
import type { BackchannelJob } from "../queue";
import { parseSummaryPhrases, type Phrases } from "../relationship/summary";
import { seededUnit } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

export function pickNote(phrases: Phrases, kind: "busy" | "quiet", seed: string): string | null {
  const list = phrases[kind] ?? [];
  return list.length ? list[Math.floor(seededUnit(seed) * list.length)]! : null;
}

/** The "busy, later?" note (design §8.3): once per block, only while the deferral is pending, never a memory. */
export async function runAvailabilityNote(deps: Deps, job: BackchannelJob): Promise<"sent" | "skipped" | "dropped"> {
  const { db, clock, config } = deps;
  if (!job.blockKind || !job.blockStart) return "skipped";
  const now = clock.now();
  if (!(await mutateState(db, job.userId, now, (s) => T.availabilityNote(s, { now })))) return "skipped";
  if (await sessionLog.hasTriggerSince(db, job.userId, "availability", new Date(job.blockStart))) return "skipped";
  const text = pickNote(parseSummaryPhrases(loadPrompt("life/availability", config.prompts.life_availability)), job.blockKind, job.turnId);
  const anchor = await sessionLog.getTurn(db, job.userId, job.turnId);
  if (!text || !anchor) return "skipped";

  const recent = await sessionLog.turnsUpTo(db, job.userId, anchor, config.chat.recent_turns);
  const guarded = await guardOutgoing(deps, {
    userId: job.userId, turnId: anchor.id, first: text,
    input: { kind: "availability", recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })), recalledFacts: [], onboardingFacts: [] },
  });
  if (!guarded.text) {
    await guarded.writeLog();
    return "dropped";
  }
  const insertAt = clock.now();
  const row = await mutateState<Turn | null>(db, job.userId, insertAt, async (s, tx) => {
    if (!T.availabilityNote(s, { now: insertAt }).result) return { patch: null, result: null };
    const inserted = await sessionLog.insertTurn(tx, job.userId, {
      id: randomUUID(), session_id: anchor.session_id, role: "companion", text: guarded.text, created_at: insertAt, trigger: "availability", extracted: true,
    });
    return { patch: null, result: inserted };
  });
  await guarded.writeLog();
  if (!row) return "skipped";
  await emit(deps, job.userId, { type: "message", turnId: row.id, part: 0 });
  return "sent";
}
