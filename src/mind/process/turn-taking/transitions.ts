/**
 * Turn-taking as pure transitions of one user's conversation_state: append a message to the
 * buffer, commit the buffer for a reply, finish and release the send, restore after a failure,
 * clear everything for a crisis, and recover after a crash. Each returns the patch to write
 * (null for no write) and a result; `mutateState` applies it under the row lock.
 */
import type { ConvState, StatePatch } from "@/db/repos/user/conversation-state";
import type { OpenQuestion } from "@/db/schema";
import { overlaps } from "./questions";

export type Step<R> = { patch: StatePatch | null; result: R };

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Order-independent equality, to check an inflight snapshot still matches what a caller expects. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/** No change: the turn is already accounted for (in flight, or answered under the lock). */
export function skip(state: ConvState, now: Date) {
  return {
    patch: null,
    result: {
      version: state.buffer_version,
      waitUntil: state.wait_until ?? now,
      backchannelSent: state.backchannel_sent,
      lastBackchannelAt: state.last_backchannel_at,
      skipped: true,
      deferredUntil: state.deferred_until,
      deferredNow: false,
    },
  } satisfies Step<unknown>;
}

/**
 * Adds a message to the buffer and pushes the timer out by the wait window, capped at
 * `maxWaitMs` from the buffer's start. A deferral (she's busy) overrides that cap, so messages
 * sent while she's busy pile into one buffer.
 */
export function append(
  state: ConvState,
  input: {
    turnId: string;
    now: Date;
    windowMs: number;
    maxWaitMs: number;
    openQuestions: OpenQuestion[];
    /** Availability: only applied to the first message of a buffer. */
    defer?: { until: Date; blockKey: string | null } | null;
  },
) {
  // Never re-buffer a message that's mid-reply, or it could be answered twice.
  if (state.inflight_turn_ids.includes(input.turnId)) return skip(state, input.now);

  const fresh = state.buffer_turn_ids.length === 0;
  const startedAt = fresh ? input.now : (state.buffer_started_at ?? input.now);
  const capped = Math.min(
    input.now.getTime() + input.windowMs,
    startedAt.getTime() + input.maxWaitMs,
  );

  const deferredUntil = fresh ? (input.defer?.until ?? null) : state.deferred_until;
  const waitUntil = new Date(deferredUntil ? Math.max(capped, deferredUntil.getTime()) : capped);
  const version = state.buffer_version + 1;

  const freshBufferFields = fresh
    ? {
        backchannel_sent: false,
        deferred_until: input.defer?.until ?? null,
        deferred_block: input.defer?.blockKey ?? null,
      }
    : {};

  return {
    patch: {
      buffer_turn_ids: unique([...state.buffer_turn_ids, input.turnId]),
      buffer_started_at: startedAt,
      open_questions: input.openQuestions,
      buffer_version: version,
      wait_until: waitUntil,
      updated_at: input.now,
      ...freshBufferFields,
    },
    result: {
      version,
      waitUntil,
      backchannelSent: fresh ? false : state.backchannel_sent,
      lastBackchannelAt: state.last_backchannel_at,
      skipped: false,
      deferredUntil,
      deferredNow: fresh && !!input.defer,
    },
  } satisfies Step<unknown>;
}

export type CommitResult =
  | { kind: "stale" }
  | { kind: "busy" }
  | {
      kind: "commit";
      turnIds: string[];
      epoch: number;
      openQuestions: OpenQuestion[];
      deferredBlock: string | null;
    };

/** Moves the buffer in flight for one reply, if the timer's version is still current. */
export function commit(
  state: ConvState,
  input: { version: number; now: Date },
): Step<CommitResult> {
  if (state.buffer_version !== input.version || state.buffer_turn_ids.length === 0) {
    return { patch: null, result: { kind: "stale" } };
  }
  // A reply still sending its later bubbles counts as busy, or a follow-up would interleave.
  if (state.inflight_turn_ids.length > 0 || state.sending_since) {
    return { patch: null, result: { kind: "busy" } };
  }

  return {
    patch: {
      inflight_turn_ids: state.buffer_turn_ids,
      inflight_since: input.now,
      buffer_turn_ids: [],
      buffer_started_at: null,
      wait_until: null,
      backchannel_sent: false,
      deferred_until: null,
      deferred_block: null,
      buffer_version: state.buffer_version + 1,
      updated_at: input.now,
    },
    result: {
      kind: "commit",
      turnIds: state.buffer_turn_ids,
      epoch: state.reply_epoch,
      openQuestions: state.open_questions,
      deferredBlock: state.deferred_block,
    },
  };
}

/**
 * Just before the paced reply is inserted. False when a crisis reply went out meanwhile, or when
 * the inflight snapshot no longer matches these turns (someone else's commit holds the slot); in
 * both cases inflight is left alone rather than cleared from under its owner. On success the turns
 * leave inflight (the reply now answers them) and the reply is marked sending until `release`,
 * so nothing new commits while its later bubbles go out.
 */
export function finish(
  state: ConvState,
  input: { epoch: number; turnIds: string[]; now: Date },
): Step<boolean> {
  if (state.reply_epoch !== input.epoch) return { patch: null, result: false };
  if (!sameIds(state.inflight_turn_ids, input.turnIds)) return { patch: null, result: false };

  return {
    patch: {
      inflight_turn_ids: [],
      inflight_since: null,
      sending_since: input.now,
      updated_at: input.now,
    },
    result: true,
  };
}

/**
 * After the last bubble, or on any exit once the reply was inserted, clears the sending marker.
 * A crisis may have cleared it already and let a newer reply set its own, so only the same epoch
 * releases.
 */
export function release(state: ConvState, input: { epoch: number; now: Date }): Step<boolean> {
  if (state.reply_epoch !== input.epoch || !state.sending_since) {
    return { patch: null, result: false };
  }
  return { patch: { sending_since: null, updated_at: input.now }, result: true };
}

/**
 * Puts the turns back in the buffer to retry at `retryAt`. That can answer a still-deferred
 * buffer before `deferred_until`: it fails open on purpose.
 */
export function restore(
  state: ConvState,
  input: { epoch: number; turnIds: string[]; now: Date; retryAt: Date },
): Step<{ kind: "abandoned" } | { kind: "restored"; version: number }> {
  if (state.reply_epoch !== input.epoch) return { patch: null, result: { kind: "abandoned" } };

  const version = state.buffer_version + 1;
  return {
    patch: {
      buffer_turn_ids: unique([...input.turnIds, ...state.buffer_turn_ids]),
      inflight_turn_ids: [],
      inflight_since: null,
      buffer_started_at: state.buffer_started_at ?? input.now,
      buffer_version: version,
      wait_until: input.retryAt,
      updated_at: input.now,
    },
    result: { kind: "restored", version },
  };
}

/**
 * After `turn.retry_limit` failures the turns stay unanswered and unbuffered; a client retry
 * re-buffers them. False when a crisis bumped the epoch meanwhile: the crisis reply covers these
 * turns, so the caller must not also report `reply_failed`.
 */
export function giveUp(state: ConvState, input: { epoch: number; now: Date }): Step<boolean> {
  if (state.reply_epoch !== input.epoch) return { patch: null, result: false };
  return {
    patch: { inflight_turn_ids: [], inflight_since: null, updated_at: input.now },
    result: true,
  };
}

/** A crisis clears everything and bumps the epoch, which abandons any paced reply in progress. */
export function crisis(
  state: ConvState,
  input: { turnId: string; now: Date },
): Step<{ turnIds: string[] }> {
  return {
    patch: {
      buffer_turn_ids: [],
      inflight_turn_ids: [],
      inflight_since: null,
      sending_since: null,
      buffer_started_at: null,
      wait_until: null,
      backchannel_sent: false,
      open_questions: [],
      deferred_until: null,
      deferred_block: null,
      buffer_version: state.buffer_version + 1,
      reply_epoch: state.reply_epoch + 1,
      updated_at: input.now,
    },
    result: {
      turnIds: unique([...state.inflight_turn_ids, ...state.buffer_turn_ids, input.turnId]),
    },
  };
}

/** At most one backchannel per buffer, rate-limited across buffers. */
export function backchannel(
  state: ConvState,
  input: { version: number; now: Date; minIntervalMs: number },
): Step<boolean> {
  const lastAt = state.last_backchannel_at;
  const rateOk = !lastAt || input.now.getTime() - lastAt.getTime() >= input.minIntervalMs;
  const allowed =
    state.buffer_version === input.version &&
    state.buffer_turn_ids.length > 0 &&
    !state.backchannel_sent &&
    rateOk;

  if (!allowed) return { patch: null, result: false };
  return {
    patch: { backchannel_sent: true, last_backchannel_at: input.now, updated_at: input.now },
    result: true,
  };
}

/**
 * After a crash. A stuck inflight reply goes back in the buffer. A crashed sender's reply row
 * already exists, so only its marker is cleared, never re-buffered. Any buffer that waited
 * behind it is requeued now. Setting wait_until to now can answer a still-deferred buffer
 * early: it fails open on purpose.
 */
export function recover(
  state: ConvState,
  input: { now: Date; graceMs: number; inflightMaxAgeMs: number },
): Step<{ version: number | null }> {
  const now = input.now.getTime();
  const hasBuffer = state.buffer_turn_ids.length > 0;

  const inflightStuck =
    state.inflight_turn_ids.length > 0 &&
    !!state.inflight_since &&
    now - state.inflight_since.getTime() > input.inflightMaxAgeMs;
  const sendingStuck =
    !!state.sending_since && now - state.sending_since.getTime() > input.inflightMaxAgeMs;
  const bufferOverdue =
    hasBuffer && (!state.wait_until || now - state.wait_until.getTime() > input.graceMs);

  const needsRequeue = inflightStuck || bufferOverdue || (sendingStuck && hasBuffer);
  if (!needsRequeue) {
    return sendingStuck
      ? { patch: { sending_since: null, updated_at: input.now }, result: { version: null } }
      : { patch: null, result: { version: null } };
  }

  const version = state.buffer_version + 1;
  return {
    patch: {
      buffer_turn_ids: inflightStuck
        ? unique([...state.inflight_turn_ids, ...state.buffer_turn_ids])
        : state.buffer_turn_ids,
      ...(inflightStuck ? { inflight_turn_ids: [], inflight_since: null } : {}),
      ...(sendingStuck ? { sending_since: null } : {}),
      buffer_started_at: state.buffer_started_at ?? input.now,
      buffer_version: version,
      wait_until: input.now,
      updated_at: input.now,
    },
    result: { version },
  };
}

/**
 * The availability note is allowed only while this buffer's deferral is still pending. Not
 * version-checked (later messages join the same deferred buffer), and it sets nothing: "once per
 * block" is read from session_log.
 */
export function availabilityNote(state: ConvState, input: { now: Date }): Step<boolean> {
  const allowed =
    !!state.deferred_until &&
    state.deferred_until.getTime() > input.now.getTime() &&
    state.buffer_turn_ids.length > 0;
  return { patch: null, result: allowed };
}

/** Her reply answered these: every open question with words inside a move she replied to closes. */
export function closeQuestions(
  state: ConvState,
  input: { answered: OpenQuestion["coords"]; now: Date },
): Step<number> {
  const open = state.open_questions.filter(
    (q) => !q.coords.some((c) => input.answered.some((a) => overlaps(c, a))),
  );
  const closed = state.open_questions.length - open.length;
  if (closed === 0) return { patch: null, result: 0 };
  return { patch: { open_questions: open, updated_at: input.now }, result: closed };
}
