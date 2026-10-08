import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { KIND_ORDER } from "@/mind/process/outreach/types";
import { PARAM_NAMES } from "@/mind/state/user/relationship/types";
import { guardOutcome, makeUpState, relationshipCause, relationshipStatus } from "@/db/schema";

/** A partial `Signals`: the fake extractor's `relationship` block for a scripted turn. */
const PartialSignals = z
  .object({
    warmth: z.number(),
    trust: z.number(),
    tension: z.number(),
    hurt: z.object({ amount: z.number(), cause: z.string().min(1) }).nullable(),
    apology: z.boolean(),
    make_up: z.boolean(),
    ends_relationship: z.boolean(),
    retracts_ending: z.boolean(),
    wants_repair: z.boolean(),
  })
  .partial();

/**
 * A turn sent `after_s` seconds after the previous one (a plain string, or an omitted `after_s`, waits
 * `turn_gap_seconds`). `repeat_previous_id` re-POSTs the previous turn's `clientMessageId` with the same
 * text (a client retry): one user turn, one judge decision. `signals`: the fake
 * extractor returns these as the relationship block for this turn's exchange.
 */
const TimedTurn = z.object({
  text: z.string().min(1),
  after_s: z.number().min(0).optional(),
  repeat_previous_id: z.boolean().default(false),
  signals: PartialSignals.optional(),
});
/**
 * `at`: "day N HH:MM" (absolute, from the fixed base) or "+N[d|h|m]" (relative to the previous session).
 * When a session's `at` lands on a later calendar day than the previous session's, the runner ticks every
 * day in between at that day's `relationship.tick_local_hour` before this session starts —
 * so a new-day session must start **at or after `tick_local_hour`** (04:00 by default), or the runner
 * raises a script error rather than silently rewinding the clock or skipping that day's tick.
 */
const Session = z.object({
  at: z.string(),
  user: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .default("main"),
  forget: z.array(z.string().min(1)).default([]),
  turns: z.array(z.union([z.string().min(1), TimedTurn])).min(1),
  /**
   * Bulk user turns: inserted directly into session_log before the session start, no reply needed.
   * Seeds occupy the `count` minutes right before `at`, so leave that much room since the previous session's
   * last turn — and note a start just after midnight spills its seeds into the previous local day.
   */
  seed_turns: z
    .object({ count: z.number().int().min(1), text: z.string().min(1).default("hey") })
    .optional(),
});

export const turnText = (t: string | { text: string }): string =>
  typeof t === "string" ? t : t.text;

/** A failing assertion with `known_failure` is reported with that reason instead of failing (decided deferrals only). */
const knownFailure = z.string().min(1).optional();
const StateAssertion = z.object({
  type: z.literal("state"),
  check: z.string(),
  user: z.string().default("main"),
  params: z.record(z.string(), z.unknown()).default({}),
  expect: z.unknown(),
  known_failure: knownFailure,
});
const RecallAssertion = z.object({
  type: z.literal("recall"),
  session: z.number().int().min(1),
  fact: z.string().min(1),
  user: z.string().default("main"),
  known_failure: knownFailure,
});
const NoFalseRecallAssertion = z.object({
  type: z.literal("no_false_recall"),
  user: z.string().default("main"),
  known_failure: knownFailure,
});
const ConsistencyAssertion = z.object({
  type: z.literal("consistency"),
  user: z.string().default("main"),
  known_failure: knownFailure,
});

const GUARD_OUTCOMES = guardOutcome.enumValues;
/** Reads judge_log. A guardrail check: must pass every run. */
const GuardAssertion = z.object({
  type: z.literal("guard"),
  user: z.string().default("main"),
  outcome_not: z.array(z.enum(GUARD_OUTCOMES)).default([]),
  max: z.partialRecord(z.enum(GUARD_OUTCOMES), z.number().int().min(0)).default({}),
  known_failure: knownFailure,
});

/** Reads session_log. Deterministic, a functional check: every run unless `gate: majority`. */
export const TurnAssertion = z.object({
  type: z.literal("turn"),
  session: z.number().int().min(1),
  user: z.string().default("main"),
  replies: z.number().int().min(0).optional(),
  backchannels: z
    .object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })
    .optional(),
  reply_covers: z.array(z.array(z.number().int().min(1))).optional(),
  max_reply_delay_s: z.number().positive().optional(),
  /** Every reply comes at least this long after the first message it covers (availability delay). */
  min_reply_delay_s: z.number().min(0).optional(),
  /** Count of `availability` notes in the session. */
  notes: z
    .object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })
    .optional(),
  /** `majority` for judge-dependent grouping; mechanics scripts keep the default, every run. */
  gate: z.enum(["every", "majority"]).optional(),
  known_failure: knownFailure,
  /**
   * Like `known_failure`, but only while the turn judge is fake: a failing result is reported with this reason,
   * not failed. Masking stops once the turn judge is real (`--real turn_judge` or `--llm=real`), so this never
   * hides a genuine regression in the real-judge exit run.
   */
  fake_known_failure: knownFailure,
});
export type TurnAssertion = z.infer<typeof TurnAssertion>;
/** LLM-judged review annotation (never a pass/fail): does reply N of session S address `about` and not `not_about`? */
const ReplyAboutAssertion = z.object({
  type: z.literal("reply_about"),
  session: z.number().int().min(1),
  reply: z.number().int().min(1),
  user: z.string().default("main"),
  about: z.string().min(1),
  not_about: z.string().min(1).optional(),
  known_failure: knownFailure,
});

/** Assertion types reserved for later phases (none at the moment; the runner branch stays). */
export const DEFERRED: Record<string, number> = {};

const Range = z.object({ gt: z.number().optional(), lt: z.number().optional() });
/** Deterministic: reads the relationship row/params/events, no judge. Every run unless `gate: majority`. */
export const RelationshipAssertion = z
  .object({
    type: z.literal("relationship"),
    user: z.string().default("main"),
    after_session: z.number().int().min(1).optional(),
    param: z.enum(PARAM_NAMES).optional(),
    effect: z
      .object({
        sign: z.enum(["pos", "neg"]).optional(),
        min_abs: z.number().optional(),
        max_abs: z.number().optional(),
      })
      .optional(),
    value: Range.optional(),
    baseline: Range.optional(),
    status: z.enum(relationshipStatus.enumValues).optional(),
    make_up_state: z.enum(makeUpState.enumValues).optional(),
    end_pending: z.boolean().optional(),
    events: z
      .object({
        cause: z.enum(relationshipCause.enumValues),
        param: z.enum(PARAM_NAMES).optional(),
        detail: z.record(z.string(), z.unknown()).optional(),
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
      })
      .optional(),
    gate: z.enum(["every", "majority"]).optional(),
    known_failure: knownFailure,
  })
  .refine(
    (a) => !(a.effect || a.value || a.baseline) || a.param,
    "effect/value/baseline need param",
  );
export type RelationshipAssertion = z.infer<typeof RelationshipAssertion>;

const MinMax = z.object({
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
});

/**
 * Reads session_log reach-out turns; `no_gate_violation` recomputes every gate rule
 * independently of the gate's own log (evals/lib/outreach-check.ts). Window times are "day N HH:MM".
 */
export const ReachOutAssertion = z.object({
  type: z.literal("reach_out"),
  user: z.string().default("main"),
  count: MinMax.optional(),
  kinds: z.array(z.enum(KIND_ORDER)).optional(),
  kinds_exclude: z.array(z.enum(KIND_ORDER)).optional(),
  windows: z
    .array(z.object({ from: z.string().optional(), to: z.string().optional(), count: MinMax }))
    .optional(),
  distinct_topics: z.boolean().optional(),
  no_gate_violation: z.boolean().default(true),
  pushed: z.boolean().default(false),
  composed: z.boolean().default(false),
  known_failure: knownFailure,
});
export type ReachOutAssertion = z.infer<typeof ReachOutAssertion>;

/** A user fact that exists before day 0 (source turn); `thread` also opens a user thread with that checkpoint. */
const SeedUserFact = z.object({
  content: z.string().min(1),
  kind: z.enum(["event", "promise"]).default("event"),
  occurred_at: z.string(),
  salience: z.number().min(0).max(1).default(0.6),
  sensitive: z.boolean().default(false),
  thread: z
    .object({ stakes: z.enum(["low", "med", "high"]), next_checkpoint: z.string() })
    .optional(),
});
/**
 * The runner runs the hourly outreach tick and due `reach_out_send` jobs in the life loop (needs `life`).
 * `user_replies`: never answer a reach-out, or answer each one `after_hours` later with `reply_text`.
 */
export const OutreachScript = z.object({
  user_replies: z
    .union([z.literal("never"), z.object({ after_hours: z.number().positive() })])
    .default("never"),
  reply_text: z.string().min(1).default("haha yes! tell me more"),
});
export type OutreachScript = z.infer<typeof OutreachScript>;

const Hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/);
const ScriptBlock = z.object({
  start: Hhmm,
  end: Hhmm,
  kind: z.enum(["busy", "downtime", "quiet"]),
  busy: z.number().min(0).max(1).default(0.5),
  label: z.string().min(1),
});
/**
 * When present, the runner runs the hourly world jobs (plan, world tick, core state tick) from
 * the script start. `plans` keys are day indexes from her local date at day 0, or "*" for every other day.
 */
export const LifeScript = z
  .object({
    plan: z.enum(["model", "scripted"]).default("model"),
    plans: z.record(z.string().regex(/^(\d+|\*)$/), z.array(ScriptBlock)).default({}),
    /** Her scripted events: spontaneous unless `kind: planned`, which needs her `thought` about it. */
    inject: z
      .array(
        z
          .object({
            day: z.number().int().min(0),
            content: z.string().min(1),
            valence: z.number().min(-1).max(1).default(0),
            kind: z.enum(["planned", "spontaneous"]).default("spontaneous"),
            thought: z.string().min(1).nullable().default(null),
            fallthrough: z.boolean().optional(),
          })
          .refine((e) => e.kind === "spontaneous" || e.thought !== null, {
            message: "a planned injected event needs a thought",
          }),
      )
      .default([]),
    until: z.string().optional(),
  })
  .refine(
    (l) => l.plan === "model" || Object.keys(l.plans).length > 0,
    "life.plan: scripted needs plans",
  );
export type LifeScript = z.infer<typeof LifeScript>;

/**
 * Her shared world, the same for every user. `events` counts world events; `not_stored` checks her
 * core memory. Deterministic. `needs_real`: skipped unless every listed purpose is real in this run.
 */
export const LifeAssertion = z.object({
  type: z.literal("life"),
  plans: MinMax.optional(),
  events: MinMax.optional(),
  decision: z
    .object({ content_includes: z.string().min(1), in: z.array(z.string().min(1)).min(1) })
    .optional(),
  not_stored: z.string().min(1).optional(),
  needs_real: z.array(z.string()).default([]),
  known_failure: knownFailure,
});
export type LifeAssertion = z.infer<typeof LifeAssertion>;
/** Her core mind, shared by every user: core state history, core memory, snapshots, drift, goals and loop traces. Times are "day N HH:MM". */
export const CoreAssertion = z.object({
  type: z.literal("core"),
  energy: z
    .object({ at: z.string(), lt: z.number().optional(), gt: z.number().optional() })
    .optional(),
  lower_energy: z
    .object({ at: z.string(), than: z.string(), by: z.number().min(0).default(0) })
    .optional(),
  preoccupation_set: z.boolean().optional(),
  episodes: MinMax.optional(),
  world_events: MinMax.optional(),
  /** Snapshot versions above v0. */
  snapshot_versions: MinMax.optional(),
  /** Minimum drift rows per check. */
  drift_rows: z
    .object({
      values: z.number().int().optional(),
      diff: z.number().int().optional(),
      trend: z.number().int().optional(),
    })
    .optional(),
  /** Active goals. */
  goals: MinMax.optional(),
  fell_through: z.boolean().optional(),
  /** Loops that must each have a `done` trace. */
  loops_done: z.array(z.string()).optional(),
  known_failure: knownFailure,
});
export type CoreAssertion = z.infer<typeof CoreAssertion>;

export const ScriptSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().optional(),
    mode: z.enum(["any", "real"]).default("any"),
    /** Onboarding profile seeded for every user before session 1 (evals/profiles/<name>.yaml); "none" starts cold. */
    profile: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("basic"),
    turn_gap_seconds: z.number().int().positive().default(30),
    /** Deep-merged over the run config for this script only (e.g. `{ turn: { settle_ms: 1000 } }`). */
    config: z.record(z.string(), z.unknown()).optional(),
    /** Fake mode's `relationship` block source for turns carrying `signals`: scripted by default. */
    signal_source: z.enum(["scripted", "model"]).default("scripted"),
    sessions: z.array(Session).min(1),
    life: LifeScript.optional(),
    outreach: OutreachScript.optional(),
    /** Her own episodes that happened before day 0 (core memory), embedded with the run's embedder. */
    seed_core_memory: z.array(z.string().min(1)).default([]),
    /** User facts (and threads) that exist before day 0, seeded for every user. */
    seed_user_facts: z.array(SeedUserFact).default([]),
    /** Creates every user's relationship row before session 1 and sets these params' value and baseline. */
    relationship_seed: z.partialRecord(z.enum(PARAM_NAMES), z.number()).optional(),
    assertions: z
      .array(
        z.union([
          StateAssertion,
          RecallAssertion,
          NoFalseRecallAssertion,
          ConsistencyAssertion,
          GuardAssertion,
          TurnAssertion,
          ReplyAboutAssertion,
          RelationshipAssertion,
          LifeAssertion,
          CoreAssertion,
          ReachOutAssertion,
        ]),
      )
      .min(1),
  })
  .refine((s) => !s.outreach || !!s.life, "outreach needs life");

export type Script = z.infer<typeof ScriptSchema>;

/**
 * Stand-in for the onboarding survey: user facts with source "onboarding",
 * reduced confidence and moderate salience. Reveal pacing isn't built yet, so they are fully retrievable.
 */
export const ProfileSchema = z.object({
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  facts: z
    .array(
      z.object({
        // No feeling/promise: those happen in the relationship, not in an upfront survey.
        kind: z.enum(["event", "trait", "preference", "state", "opinion"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function loadProfiles(dir: string): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".yaml") || x.endsWith(".yml"))
    .sort()) {
    out[f.replace(/\.ya?ml$/, "")] = ProfileSchema.parse(
      parseYaml(readFileSync(path.join(dir, f), "utf8")),
    );
  }
  return out;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const UNIT: Record<string, number> = { d: DAY, h: HOUR, m: MIN };
/** Monday 2026-01-05 00:00 UTC. Fixed so every run is deterministic. */
export const BASE = Date.UTC(2026, 0, 5);

export function parseAt(spec: string, prev: Date | null): Date {
  const abs = /^day (\d+) (\d{2}):(\d{2})$/.exec(spec);
  if (abs)
    return new Date(BASE + Number(abs[1]) * DAY + Number(abs[2]) * HOUR + Number(abs[3]) * MIN);
  const rel = /^\+(\d+)([dhm])$/.exec(spec);
  if (rel) {
    if (!prev) throw new Error(`relative time "${spec}" needs a previous session`);
    return new Date(prev.getTime() + Number(rel[1]) * UNIT[rel[2]!]!);
  }
  throw new Error(`unrecognised time "${spec}" (use "day N HH:MM" or "+N[d|h|m]")`);
}

export function loadScripts(dir: string): Script[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => {
      try {
        return ScriptSchema.parse(parseYaml(readFileSync(path.join(dir, f), "utf8")));
      } catch (e) {
        throw new Error(`invalid eval script ${f}: ${(e as Error).message}`);
      }
    });
}
