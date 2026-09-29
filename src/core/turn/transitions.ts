import type { ConvState, StatePatch } from "@/db/repos/conversation-state";
import type { OpenQuestion } from "@/db/schema";

/**
 * Pure conversation_state transitions (design §5). Each returns the patch to write (null = no write) and a
 * result; `mutateState` applies them inside one short transaction holding the row lock.
 */
export type Step<R> = { patch: StatePatch | null; result: R };

const uniq = (ids: string[]) => [...new Set(ids)];

/** Order-independent set equality, for checking an inflight snapshot still matches what a caller expects. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** No state change: the turn is already accounted for elsewhere (in flight, or answered under the lock). */
export function skip(s: ConvState, now: Date) {
  return {
    patch: null,
    result: {
      version: s.buffer_version, waitUntil: s.wait_until ?? now, backchannelSent: s.backchannel_sent, lastBackchannelAt: s.last_backchannel_at, skipped: true,
      deferredUntil: s.deferred_until, deferredNow: false,
    },
  } satisfies Step<unknown>;
}

export function append(s: ConvState, a: {
  turnId: string; now: Date; windowMs: number; maxWaitMs: number; openQuestions: OpenQuestion[];
  /** Availability (Phase 5 design §8.4): only applied to the first turn of a buffer. */
  defer?: { until: Date; factId: string | null } | null;
}) {
  // A race with a reply already in flight for this turn (design §5.2/§5.6 forward-looking guard): never re-buffer
  // a turn that's mid-reply, or it could be answered twice once the turn_timer job (Task 8) exists.
  if (s.inflight_turn_ids.includes(a.turnId)) return skip(s, a.now);
  const fresh = s.buffer_turn_ids.length === 0;
  const started = fresh ? a.now : (s.buffer_started_at ?? a.now);
  const capped = Math.min(a.now.getTime() + a.windowMs, started.getTime() + a.maxWaitMs);
  // A deferral overrides the max-wait cap: messages sent while she's busy pile into one buffer.
  const deferredUntil = fresh ? (a.defer?.until ?? null) : s.deferred_until;
  const waitUntil = new Date(deferredUntil ? Math.max(capped, deferredUntil.getTime()) : capped);
  const version = s.buffer_version + 1;
  return {
    patch: {
      buffer_turn_ids: uniq([...s.buffer_turn_ids, a.turnId]), buffer_started_at: started, open_questions: a.openQuestions,
      buffer_version: version, wait_until: waitUntil, updated_at: a.now,
      ...(fresh ? { backchannel_sent: false, deferred_until: a.defer?.until ?? null, deferred_fact: a.defer?.factId ?? null } : {}),
    },
    result: {
      version, waitUntil, backchannelSent: fresh ? false : s.backchannel_sent, lastBackchannelAt: s.last_backchannel_at, skipped: false,
      deferredUntil, deferredNow: fresh && !!a.defer,
    },
  } satisfies Step<unknown>;
}

export type CommitResult =
  | { kind: "stale" }
  | { kind: "busy" }
  | { kind: "commit"; turnIds: string[]; epoch: number; openQuestions: string[]; deferredFact: string | null };

export function commit(s: ConvState, a: { version: number; now: Date }): Step<CommitResult> {
  if (s.buffer_version !== a.version || s.buffer_turn_ids.length === 0) return { patch: null, result: { kind: "stale" } };
  // A reply still sending its later bubbles counts as busy too, or a follow-up would interleave with them.
  if (s.inflight_turn_ids.length > 0 || s.sending_since) return { patch: null, result: { kind: "busy" } };
  return {
    patch: {
      inflight_turn_ids: s.buffer_turn_ids, inflight_since: a.now, buffer_turn_ids: [], buffer_started_at: null,
      wait_until: null, backchannel_sent: false, deferred_until: null, deferred_fact: null, buffer_version: s.buffer_version + 1, updated_at: a.now,
    },
    result: { kind: "commit", turnIds: s.buffer_turn_ids, epoch: s.reply_epoch, openQuestions: s.open_questions.map((q) => q.text), deferredFact: s.deferred_fact },
  };
}

/**
 * Just before the paced reply is inserted: false when a crisis reply went out meanwhile (design §5.2 step 4),
 * or when the inflight snapshot no longer matches the turns this call is responsible for (someone else's
 * commit already occupies the slot) — either way, inflight is left untouched rather than cleared out from
 * under whoever does own it. On success the turns leave inflight (the reply row now answers them) and the
 * reply is marked sending until `release`, so no follow-up commits while its later bubbles go out.
 */
export function finish(s: ConvState, a: { epoch: number; turnIds: string[]; now: Date }): Step<boolean> {
  if (s.reply_epoch !== a.epoch) return { patch: null, result: false };
  if (!sameIds(s.inflight_turn_ids, a.turnIds)) return { patch: null, result: false };
  return { patch: { inflight_turn_ids: [], inflight_since: null, sending_since: a.now, updated_at: a.now }, result: true };
}

/**
 * After the last bubble (or on any exit once the reply was inserted): clears the sending marker. A crisis
 * meanwhile already cleared it and may have let a newer reply set its own, so only the same epoch releases.
 */
export function release(s: ConvState, a: { epoch: number; now: Date }): Step<boolean> {
  if (s.reply_epoch !== a.epoch || !s.sending_since) return { patch: null, result: false };
  return { patch: { sending_since: null, updated_at: a.now }, result: true };
}

export function restore(s: ConvState, a: { epoch: number; turnIds: string[]; now: Date; retryAt: Date }): Step<{ kind: "abandoned" } | { kind: "restored"; version: number }> {
  if (s.reply_epoch !== a.epoch) return { patch: null, result: { kind: "abandoned" } };
  const version = s.buffer_version + 1;
  return {
    patch: {
      buffer_turn_ids: uniq([...a.turnIds, ...s.buffer_turn_ids]), inflight_turn_ids: [], inflight_since: null,
      buffer_started_at: s.buffer_started_at ?? a.now, buffer_version: version, wait_until: a.retryAt, updated_at: a.now,
    },
    result: { kind: "restored", version },
  };
}

/**
 * After `turn.retry_limit` failures: the turns stay unanswered and unbuffered; a client retry re-buffers them.
 * Returns false (no patch) when a crisis bumped the epoch meanwhile — the crisis reply already covers these
 * turns, so the caller must not also report `reply_failed` for them.
 */
export function giveUp(s: ConvState, a: { epoch: number; now: Date }): Step<boolean> {
  if (s.reply_epoch !== a.epoch) return { patch: null, result: false };
  return { patch: { inflight_turn_ids: [], inflight_since: null, updated_at: a.now }, result: true };
}

export function crisis(s: ConvState, a: { turnId: string; now: Date }): Step<{ turnIds: string[] }> {
  return {
    patch: {
      buffer_turn_ids: [], inflight_turn_ids: [], inflight_since: null, sending_since: null, buffer_started_at: null, wait_until: null,
      backchannel_sent: false, open_questions: [], deferred_until: null, deferred_fact: null,
      buffer_version: s.buffer_version + 1, reply_epoch: s.reply_epoch + 1, updated_at: a.now,
    },
    result: { turnIds: uniq([...s.inflight_turn_ids, ...s.buffer_turn_ids, a.turnId]) },
  };
}

export function backchannel(s: ConvState, a: { version: number; now: Date; minIntervalMs: number }): Step<boolean> {
  const rateOk = !s.last_backchannel_at || a.now.getTime() - s.last_backchannel_at.getTime() >= a.minIntervalMs;
  const ok = s.buffer_version === a.version && s.buffer_turn_ids.length > 0 && !s.backchannel_sent && rateOk;
  return ok ? { patch: { backchannel_sent: true, last_backchannel_at: a.now, updated_at: a.now }, result: true } : { patch: null, result: false };
}

export function recover(s: ConvState, a: { now: Date; graceMs: number; inflightMaxAgeMs: number }): Step<{ version: number | null }> {
  const t = a.now.getTime();
  const stuck = s.inflight_turn_ids.length > 0 && !!s.inflight_since && t - s.inflight_since.getTime() > a.inflightMaxAgeMs;
  // A crashed sender: its reply row exists, so only the marker is cleared (never re-buffered). Any buffer
  // that waited behind it is requeued now.
  const sendingStuck = !!s.sending_since && t - s.sending_since.getTime() > a.inflightMaxAgeMs;
  const overdue = s.buffer_turn_ids.length > 0 && (!s.wait_until || t - s.wait_until.getTime() > a.graceMs);
  if (!stuck && !overdue && !(sendingStuck && s.buffer_turn_ids.length > 0)) {
    return sendingStuck ? { patch: { sending_since: null, updated_at: a.now }, result: { version: null } } : { patch: null, result: { version: null } };
  }
  const version = s.buffer_version + 1;
  return {
    patch: {
      buffer_turn_ids: stuck ? uniq([...s.inflight_turn_ids, ...s.buffer_turn_ids]) : s.buffer_turn_ids,
      ...(stuck ? { inflight_turn_ids: [], inflight_since: null } : {}),
      ...(sendingStuck ? { sending_since: null } : {}),
      buffer_started_at: s.buffer_started_at ?? a.now, buffer_version: version, wait_until: a.now, updated_at: a.now,
    },
    result: { version },
  };
}
