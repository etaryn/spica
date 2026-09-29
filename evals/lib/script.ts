import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PARAM_NAMES } from "@/core/relationship/types";
import { guardOutcome, makeUpState, relationshipCause, relationshipStatus } from "@/db/schema";

/** A partial `Signals` (design §8.3): the fake extractor's `relationship` block for a scripted turn. */
const PartialSignals = z.object({
  warmth: z.number(), trust: z.number(), tension: z.number(),
  hurt: z.object({ amount: z.number(), cause: z.string().min(1) }).nullable(),
  apology: z.boolean(), make_up: z.boolean(), ends_relationship: z.boolean(), retracts_ending: z.boolean(), wants_repair: z.boolean(),
}).partial();

/**
 * A turn sent `after_s` seconds after the previous one (a plain string, or an omitted `after_s`, waits
 * `turn_gap_seconds`). `repeat_previous_id` re-POSTs the previous turn's `clientMessageId` with the same
 * text (a client retry): one user turn, one judge decision. `signals` (Phase 4, design §8.3): the fake
 * extractor returns these as the relationship block for this turn's exchange.
 */
const TimedTurn = z.object({
  text: z.string().min(1), after_s: z.number().min(0).optional(), repeat_previous_id: z.boolean().default(false),
  signals: PartialSignals.optional(),
});
/**
 * `at`: "day N HH:MM" (absolute, from the fixed base) or "+N[d|h|m]" (relative to the previous session).
 * When a session's `at` lands on a later calendar day than the previous session's, the runner ticks every
 * day in between at that day's `relationship.tick_local_hour` (v2 §15.4 #33) before this session starts —
 * so a new-day session must start **at or after `tick_local_hour`** (04:00 by default), or the runner
 * raises a script error rather than silently rewinding the clock or skipping that day's tick.
 */
const Session = z.object({
  at: z.string(),
  user: z.string().regex(/^[a-z0-9_-]+$/).default("main"),
  forget: z.array(z.string().min(1)).default([]),
  turns: z.array(z.union([z.string().min(1), TimedTurn])).min(1),
  /**
   * Bulk user turns (design §8.3): inserted directly into session_log before the session start, no reply needed.
   * Seeds occupy the `count` minutes right before `at`, so leave that much room since the previous session's
   * last turn — and note a start just after midnight spills its seeds into the previous local day.
   */
  seed_turns: z.object({ count: z.number().int().min(1), text: z.string().min(1).default("hey") }).optional(),
});

export const turnText = (t: string | { text: string }): string => (typeof t === "string" ? t : t.text);

/** A failing assertion with `known_failure` is reported with that reason instead of failing (decided deferrals only). */
const knownFailure = z.string().min(1).optional();
const StateAssertion = z.object({
  type: z.literal("state"), check: z.string(), user: z.string().default("main"),
  params: z.record(z.string(), z.unknown()).default({}), expect: z.unknown(), known_failure: knownFailure,
});
const RecallAssertion = z.object({
  type: z.literal("recall"), session: z.number().int().min(1), fact: z.string().min(1), user: z.string().default("main"), known_failure: knownFailure,
});
const NoFalseRecallAssertion = z.object({ type: z.literal("no_false_recall"), user: z.string().default("main"), known_failure: knownFailure });
const ConsistencyAssertion = z.object({ type: z.literal("consistency"), user: z.string().default("main"), known_failure: knownFailure });

const GUARD_OUTCOMES = guardOutcome.enumValues;
/** Reads judge_log (spec §7.3). A guardrail check: must pass every run. */
const GuardAssertion = z.object({
  type: z.literal("guard"), user: z.string().default("main"),
  outcome_not: z.array(z.enum(GUARD_OUTCOMES)).default([]),
  max: z.partialRecord(z.enum(GUARD_OUTCOMES), z.number().int().min(0)).default({}),
  known_failure: knownFailure,
});

/** Reads session_log (design §9.3). Deterministic, a functional check: every run unless `gate: majority`. */
export const TurnAssertion = z.object({
  type: z.literal("turn"), session: z.number().int().min(1), user: z.string().default("main"),
  replies: z.number().int().min(0).optional(),
  backchannels: z.object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).optional(),
  reply_covers: z.array(z.array(z.number().int().min(1))).optional(),
  max_reply_delay_s: z.number().positive().optional(),
  /** Phase 5: every reply comes at least this long after the first message it covers (availability delay). */
  min_reply_delay_s: z.number().min(0).optional(),
  /** Phase 5: count of `availability` notes in the session. */
  notes: z.object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).optional(),
  /** `majority` for judge-dependent grouping (design §9.6); mechanics scripts keep the default, every run. */
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
/** LLM-judged review annotation (never a pass/fail, v2 §15): does reply N of session S address `about` and not `not_about`? */
const ReplyAboutAssertion = z.object({
  type: z.literal("reply_about"), session: z.number().int().min(1), reply: z.number().int().min(1), user: z.string().default("main"),
  about: z.string().min(1), not_about: z.string().min(1).optional(), known_failure: knownFailure,
});

/** Judged entry types: review annotations only (v2 §15), run with `--annotate`, never pass/fail. */
export const ANNOTATION_TYPES: ReadonlySet<string> = new Set(["recall", "no_false_recall", "consistency", "reply_about"]);

/** Assertion types defined by v2 §14.2 but implemented in later phases. */
export const DEFERRED: Record<string, number> = { reach_out: 6 };
const DeferredAssertion = z.looseObject({ type: z.enum(["reach_out"]) });

const Range = z.object({ gt: z.number().optional(), lt: z.number().optional() });
/** Deterministic (design §8.3): reads the relationship row/params/events, no judge. Every run unless `gate: majority`. */
export const RelationshipAssertion = z.object({
  type: z.literal("relationship"), user: z.string().default("main"), after_session: z.number().int().min(1).optional(),
  param: z.enum(PARAM_NAMES).optional(),
  effect: z.object({ sign: z.enum(["pos", "neg"]).optional(), min_abs: z.number().optional(), max_abs: z.number().optional() }).optional(),
  value: Range.optional(), baseline: Range.optional(),
  status: z.enum(relationshipStatus.enumValues).optional(), make_up_state: z.enum(makeUpState.enumValues).optional(),
  end_pending: z.boolean().optional(),
  events: z.object({ cause: z.enum(relationshipCause.enumValues), param: z.enum(PARAM_NAMES).optional(),
    detail: z.record(z.string(), z.unknown()).optional(), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).optional(),
  gate: z.enum(["every", "majority"]).optional(), known_failure: knownFailure,
}).refine((a) => !(a.effect || a.value || a.baseline) || a.param, "effect/value/baseline need param");
export type RelationshipAssertion = z.infer<typeof RelationshipAssertion>;

const Hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/);
const ScriptBlock = z.object({ start: Hhmm, end: Hhmm, kind: z.enum(["busy", "downtime", "quiet"]), busy: z.number().min(0).max(1).default(0.5), label: z.string().min(1) });
/**
 * Phase 5 (design §9.3): when present, the runner runs the hourly life jobs (plan, life tick, ego tick) from the
 * script start. `plans` keys are day indexes from her local date at day 0, or "*" for every other day.
 */
export const LifeScript = z.object({
  plan: z.enum(["model", "scripted"]).default("model"),
  plans: z.record(z.string().regex(/^(\d+|\*)$/), z.array(ScriptBlock)).default({}),
  inject: z.array(z.object({ day: z.number().int().min(0), content: z.string().min(1), valence: z.number().min(-1).max(1).default(0) })).default([]),
  until: z.string().optional(),
}).refine((l) => l.plan === "model" || Object.keys(l.plans).length > 0, "life.plan: scripted needs plans");
export type LifeScript = z.infer<typeof LifeScript>;

const MinMax = z.object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() });
/** Deterministic (design §9.3). `needs_real`: skipped unless every listed purpose is real in this run. */
export const LifeAssertion = z.object({
  type: z.literal("life"), user: z.string().default("main"),
  plans: MinMax.optional(), block_days: MinMax.optional(), events: MinMax.optional(),
  decision: z.object({ content_includes: z.string().min(1), in: z.array(z.string().min(1)).min(1) }).optional(),
  not_stored: z.string().min(1).optional(),
  needs_real: z.array(z.string()).default([]),
  known_failure: knownFailure,
});
export type LifeAssertion = z.infer<typeof LifeAssertion>;
/** Reads ego_tick history (design §9.3). Times are "day N HH:MM". */
export const EgoAssertion = z.object({
  type: z.literal("ego"), user: z.string().default("main"),
  energy: z.object({ at: z.string(), lt: z.number().optional(), gt: z.number().optional() }).optional(),
  lower_energy: z.object({ at: z.string(), than: z.string(), by: z.number().min(0).default(0) }).optional(),
  preoccupation_set: z.boolean().optional(),
  known_failure: knownFailure,
});
export type EgoAssertion = z.infer<typeof EgoAssertion>;

export const ScriptSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  mode: z.enum(["any", "real"]).default("any"),
  /** Onboarding profile seeded for every user before session 1 (evals/profiles/<name>.yaml); "none" starts cold. */
  profile: z.string().regex(/^[a-z0-9-]+$/).default("basic"),
  turn_gap_seconds: z.number().int().positive().default(30),
  /** Deep-merged over the run config for this script only (e.g. `{ turn: { backchannel_style: silent } }`). */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Fake mode's `relationship` block source for turns carrying `signals` (design §8.3): scripted by default. */
  signal_source: z.enum(["scripted", "model"]).default("scripted"),
  sessions: z.array(Session).min(1),
  life: LifeScript.optional(),
  /** Her own facts that exist before day 0 (source turn, as if she'd said them), embedded with the run's embedder. */
  seed_self_facts: z.array(z.string().min(1)).default([]),
  /** Creates every user's relationship row before session 1 and sets these params' value and baseline. */
  relationship_seed: z.partialRecord(z.enum(PARAM_NAMES), z.number()).optional(),
  assertions: z.array(z.union([StateAssertion, RecallAssertion, NoFalseRecallAssertion, ConsistencyAssertion, GuardAssertion, TurnAssertion, ReplyAboutAssertion, RelationshipAssertion, LifeAssertion, EgoAssertion, DeferredAssertion])).min(1),
});

export type Script = z.infer<typeof ScriptSchema>;

/**
 * Stand-in for the Phase 7 onboarding survey (v2 §12): user facts with source "onboarding",
 * reduced confidence and moderate salience. Reveal pacing isn't built yet, so they are fully retrievable.
 */
export const ProfileSchema = z.object({
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  facts: z.array(z.object({
    // No feeling/promise: those happen in the relationship, not in an upfront survey (profile-data spec §2).
    kind: z.enum(["event", "trait", "preference", "state", "opinion"]),
    content: z.string().min(1),
  })).min(1),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function loadProfiles(dir: string): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml") || x.endsWith(".yml")).sort()) {
    out[f.replace(/\.ya?ml$/, "")] = ProfileSchema.parse(parseYaml(readFileSync(path.join(dir, f), "utf8")));
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
  if (abs) return new Date(BASE + Number(abs[1]) * DAY + Number(abs[2]) * HOUR + Number(abs[3]) * MIN);
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
