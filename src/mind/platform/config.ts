/**
 * Every number and setting the mind runs on. `config/default.json` holds the values; this file
 * validates them, one schema per section, so a typo or an out-of-range value fails at startup
 * instead of misbehaving later.
 */
import { z } from "zod";
import defaults from "../../../config/default.json";
import { isValidTimeZone } from "./timezone";

// ---------- Building blocks ----------

const unit = z.number().min(0).max(1);
/** A move down, as a negative delta. */
const loss = z.number().min(-1).max(0);
const positiveInt = z.number().int().positive();
/** A depth tier: 1 she'd tell an acquaintance, 2 a friend, 3 only someone close. */
const tier = z.number().int().min(1).max(3);
const countFromZero = z.number().int().min(0);
const nonNegative = z.number().min(0);
const text = z.string().min(1);
const cron = z.string().min(1);
const promptVersion = z.string().regex(/^v\d+$/);
const hourOfDay = z.number().int().min(0).max(23);
const effort = z.enum(["low", "medium", "high"]);
const thinking = z.enum(["disabled", "adaptive"]);

const CrisisCardSchema = z.object({
  title: text,
  lines: z.array(text).min(1),
});

// ---------- Sections ----------

const models = z.object({
  reply: text,
  cheap: text,
  extract: text,
  judge: text,
  life: text,
  core: text,
  user_mind: text,
  guard: text,
  turn_judge: text,
  reply_max_tokens: positiveInt,
  extract_max_tokens: positiveInt,
  judge_max_tokens: positiveInt,
  guard_max_tokens: positiveInt,
  turn_judge_max_tokens: positiveInt,
  structured_timeout_ms: positiveInt,
  // null sends no `effort` at all (Haiku 4.5 rejects it).
  reply_effort: effort.nullable(),
  reply_thinking: thinking,
  judge_effort: effort.nullable(),
  judge_thinking: thinking,
  reply_timeout_ms: positiveInt,
  reply_max_retries: countFromZero,
});

const embedding = z.object({
  provider: z.literal("voyage"),
  model: text,
  dimensions: positiveInt,
});

const session = z.object({ idle_gap_minutes: z.number().positive() });

const chat = z.object({
  recent_turns: positiveInt,
  max_parts: positiveInt,
  history_page_size: positiveInt,
  max_message_chars: positiveInt,
  gap_line_min_hours: nonNegative,
  window_gap_hours: z.number().positive(),
  relationship_line: z.boolean(),
});

const safety = z.object({
  classifier_timeout_ms: positiveInt,
  classifier_max_tokens: positiveInt,
  classifier_context_turns: countFromZero,
  keywords: z.array(text).min(1),
  resources: z
    .record(z.string(), CrisisCardSchema)
    .refine((cards) => "default" in cards, "resources.default is required"),
});

const queue = z.object({ enqueue_timeout_ms: positiveInt });

const auth = z.object({
  min_age: positiveInt,
  min_password_length: z.number().int().min(8),
});

const guard = z.object({
  enabled: z.boolean(),
  timeout_ms: positiveInt,
  retry_limit: countFromZero,
  log_timeout_ms: positiveInt,
  self_claim_similarity: unit,
  grounding_timeout_ms: positiveInt,
  // The safety categories an outage keyword can stand for; listed here because platform code
  // doesn't import the guard.
  fallback_keywords: z.partialRecord(
    z.enum(["threat", "contempt", "guilt", "punishment", "manipulation"]),
    z.array(text).min(1),
  ),
});

const hotPath = z.object({ db_timeout_ms: positiveInt });

const events = z.object({
  channel: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  heartbeat_ms: positiveInt,
});

// Strict, so an override of a removed key fails loudly instead of being ignored.
const turn = z
  .strictObject({
    settle_ms: countFromZero,
    wait_ms: countFromZero,
    short_message_chars: countFromZero,
    short_wait_bonus_ms: countFromZero,
    max_wait_ms: positiveInt,
    read_delay_min_ms: countFromZero,
    read_delay_max_ms: countFromZero,
    read_delay_chars_for_max: positiveInt,
    typing_ms_per_char: nonNegative,
    typing_max_ms: countFromZero,
    part_gap_ms: countFromZero,
    backchannel_min_interval_ms: countFromZero,
    backchannel_max_words: positiveInt,
    backchannel_read_delay_ms: countFromZero,
    max_open_questions: countFromZero,
    incomplete_cues: z.array(text),
    greeting_words: z.array(text),
    judge_timeout_ms: positiveInt,
    judge_context_turns: countFromZero,
    retry_limit: countFromZero,
    retry_delay_ms: countFromZero,
    inflight_recheck_ms: positiveInt,
    worker_concurrency: positiveInt,
    worker_polling_interval_seconds: z.number().min(0.5),
    job_expire_seconds: positiveInt,
    timer_job_retry_limit: countFromZero,
    timer_job_retry_delay_seconds: countFromZero,
    sweep_cron: cron,
    sweep_grace_ms: countFromZero,
    sweep_batch: positiveInt,
  })
  .refine(
    (t) => t.read_delay_min_ms <= t.read_delay_max_ms,
    "turn.read_delay_min_ms must be <= read_delay_max_ms",
  );

const retrieval = z.object({
  candidate_pool: positiveInt,
  top_n: positiveInt,
  core_top_n: positiveInt,
  recency_half_life_days: z.number().positive(),
  recall_bump: unit,
  recall_cap: unit,
  reinforce_min_sim: unit,
  embed_timeout_ms: positiveInt,
  context_turns: countFromZero,
  max_due_threads: countFromZero,
  core_mood_bias: unit,
  core_goal_bias: unit,
});

const inspector = z.object({
  snapshot_versions: positiveInt,
  user_mind_runs: positiveInt,
  ledger_limit: positiveInt,
});

const claims = z.object({ grounded_similarity: unit });

const extraction = z.object({
  context_turns: countFromZero,
  max_candidates: positiveInt,
  open_threads_in_prompt: countFromZero,
  new_entity_salience: unit,
  entity_bump: unit,
});

const reconcile = z.object({
  neighbor_k: positiveInt,
  near_match_similarity: unit,
  duplicate_bump: unit,
  max_tokens: positiveInt,
});

const decay = z.object({
  cron,
  grace_days: nonNegative,
  rate: unit,
  stale_floor: unit,
  dormant_after_days: nonNegative,
});

const coldPath = z.object({
  retry_limit: countFromZero,
  retry_delay_seconds: positiveInt,
  max_sweep_attempts: positiveInt,
  sweep_cron: cron,
  sweep_min_age_minutes: countFromZero,
  sweep_batch: positiveInt,
});

/** One value per relationship param. */
const perParam = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    closeness: value,
    trust: value,
    warmth: value,
    hurt: value,
    tension: value,
    msgs_per_day: value,
    affect_valence: value,
    afterglow: value,
    user_disclosure: value,
    user_responsiveness: value,
    commitment: value,
  });

/** What her openness at reply time is computed from; each has a centre and two weights. */
export const OPENNESS_INPUTS = [
  "closeness",
  "trust",
  "hurt",
  "tension",
  "mood_valence",
  "emotion_valence",
  "energy",
  "busy",
  "affect_valence",
  "afterglow",
  "last_user_disclosure",
  "user_responsiveness",
] as const;
const opennessWeights = z.object(
  Object.fromEntries(OPENNESS_INPUTS.map((k) => [k, z.number()])) as Record<
    (typeof OPENNESS_INPUTS)[number],
    z.ZodNumber
  >,
);
const opennessSide = z.object({ base: unit, weights: opennessWeights });

const idiolectReuse = z.enum(["none", "theirs", "all"]);
const depthTier = z.number().int().min(1).max(3);
const togetherGate = z.object({ open: depthTier, idiolect: idiolectReuse });
const apartGate = z.object({ drop: z.number().int().min(0).max(2), idiolect: idiolectReuse });

const relationship = z
  .object({
    tick_cron: cron,
    tick_local_hour: hourOfDay,
    history_days: z.number().int().min(1),
    baseline_alpha: unit,
    variance_epsilon: z.number().positive(),
    initial: perParam(nonNegative),
    initial_variance: perParam(nonNegative),
    affect: z.object({
      exchange_gain: unit,
      afterglow_gain: unit,
      afterglow_half_life_hours: z.number().positive(),
    }),
    gains: z.object({
      warmth: unit,
      trust: unit,
      tension: unit,
      hurt: unit,
    }),
    intimacy: z.object({ ema_alpha: unit, closeness_gain: unit }),
    hours: z.object({
      casual: z.number().positive(),
      friend: z.number().positive(),
      close: z.number().positive(),
      session_min_minutes: nonNegative,
      // A longer silence between turns (her busy, or them away) isn't time spent together.
      max_gap_minutes: z.number().positive(),
    }),
    ceiling: z.object({ start: unit, casual: unit, friend: unit, close: unit }),
    deep_session: z.object({
      threshold: z.number().positive(),
      gains: z.object({ closeness: unit, trust: unit, warmth: unit }),
    }),
    openness: z.object({
      centres: opennessWeights,
      disclosure: opennessSide,
      responsiveness: opennessSide,
      bands: z.object({ low: unit, high: unit }),
    }),
    idiolect: z.object({ min_similarity: unit, max_items: positiveInt }),
    bids: z.object({
      effects: z.object({
        toward: z.object({ warmth: unit.optional(), trust: unit.optional() }),
        away: z.object({ warmth: loss.optional(), trust: loss.optional() }),
        against: z.object({ warmth: loss.optional(), trust: loss.optional() }),
      }),
    }),
    depth: z.object({
      reciprocity_window: positiveInt,
      reciprocity_gap: unit,
      stretch_moment: unit,
      held_back_similarity: unit,
    }),
    stages: z.object({
      climb: z.object({
        experimenting_hours: nonNegative,
        intensifying_closeness: unit,
        integrating_closeness: unit,
        integrating_trust: unit,
        bonding_commitment: unit,
      }),
      differentiating: z.object({
        tension: unit,
        trust: unit,
        clear_tension: unit,
        clear_trust: unit,
      }),
      circumscribing: z.object({
        hurt: unit,
        tension: unit,
        clear_hurt: unit,
        clear_tension: unit,
      }),
      stagnating: z.object({ warmth: unit, disclosure: unit, clear_warmth: unit }),
      gates: z.object({
        initiating: togetherGate,
        experimenting: togetherGate,
        intensifying: togetherGate,
        integrating: togetherGate,
        bonding: togetherGate,
        differentiating: apartGate,
        circumscribing: apartGate,
        stagnating: apartGate,
        avoiding: apartGate,
        terminating: togetherGate,
      }),
      rekindle: z.object({ base: nonNegative, commitment: nonNegative }),
    }),
    commitment: z.object({
      satisfaction: z.object({
        warmth: unit,
        trust: unit,
        affect_valence: unit,
        hurt: unit,
        tension: unit,
      }),
      investment: z.object({
        hours: z.number().positive(),
        ledger_depth: z.number().positive(),
        idiolect: z.number().positive(),
        episodes: z.number().positive(),
      }),
      weights: z.object({ satisfaction: unit, investment: unit }),
      soften: unit,
      soften_below: unit,
      absence_shield: unit,
      repair_speed: unit,
    }),
    hurt_half_life_hours: z.number().positive(),
    tension_half_life_hours: z.number().positive(),
    sensitise_window_days: nonNegative,
    sensitise_factor: z.number().min(1),
    scar_threshold: unit,
    scar_trust_dent: unit,
    absence_grace_factor: z.number().positive(),
    closeness_absence_drift: unit,
    absence_hurt_effect: z.number().min(-1).max(0),
    absence_hurt_gain: unit,
    make_up_threshold: unit,
    make_up_clear_threshold: unit,
    make_up_delay_replies: countFromZero,
    make_up_relief: unit,
    apology_relief: unit,
    relief_tension_factor: unit,
    end_confirm_hours: z.number().positive(),
    ending_hurt_floor: unit,
    end_closeness_factor: unit,
    end_reconfirm_min_minutes: countFromZero,
    repair_gain_factor: unit,
    repair_complete_closeness: unit,
    repair_min_days: nonNegative,
    crisis_quiet_hours: nonNegative,
    summary_min_effect: unit,
    summary_strong_effect: unit,
    summary_max_lines: countFromZero,
    signal_deadzone: unit,
    cadence_sessions: positiveInt,
    hurt_fact_salience: unit,
    hurt_fact_confidence: unit,
    default_median_gap_hours: z.number().positive(),
    min_sessions_for_gap: z.number().int().min(2),
    event_list_limit: positiveInt,
  })
  .refine(
    (r) => r.make_up_clear_threshold < r.make_up_threshold,
    "relationship.make_up_clear_threshold must be < make_up_threshold",
  )
  .refine(
    (r) => r.hours.casual < r.hours.friend && r.hours.friend < r.hours.close,
    "relationship.hours must rise casual < friend < close",
  )
  .refine(
    (r) =>
      r.ceiling.start <= r.ceiling.casual &&
      r.ceiling.casual <= r.ceiling.friend &&
      r.ceiling.friend <= r.ceiling.close,
    "relationship.ceiling must not fall",
  )
  .refine(
    (r) => r.openness.bands.low < r.openness.bands.high,
    "relationship.openness.bands: low < high",
  )
  .refine(
    (r) =>
      r.stages.differentiating.clear_tension < r.stages.differentiating.tension &&
      r.stages.differentiating.clear_trust > r.stages.differentiating.trust &&
      r.stages.circumscribing.clear_hurt < r.stages.circumscribing.hurt &&
      r.stages.circumscribing.clear_tension < r.stages.circumscribing.tension &&
      r.stages.stagnating.clear_warmth > r.stages.stagnating.warmth,
    "relationship.stages: each clear threshold must sit on the healthy side of its enter threshold",
  );

/** "HH:MM" in her zone; "24:00" closes a block at midnight. */
const blockTime = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const life = z.object({
  timezone: z.string().refine(isValidTimeZone, "life.timezone must be an IANA zone"),
  plan_cron: cron,
  plan_context_days: countFromZero,
  plan_max_tokens: positiveInt,
  plan_label_max_chars: positiveInt,
  plan_attempts: positiveInt,
  max_busy_blocks: positiveInt,
  min_quiet_hours: z.number().min(0).max(24),
  quiet_busy: unit,
  min_busy: unit,
  fallback_busy: unit,
  fallback_plan: z
    .array(
      z.object({
        start: blockTime,
        end: blockTime,
        kind: z.enum(["busy", "downtime", "quiet"]),
        label: text,
      }),
    )
    .min(1),
});

/** A [low, high] threshold pair for turning a value into low / neutral / high. */
const band = z
  .tuple([z.number(), z.number()])
  .refine(([low, high]) => low <= high, "band low must be <= high");

const coreState = z.object({
  baseline: z.object({
    mood_valence: z.number().min(-1).max(1),
    mood_arousal: unit,
    energy: unit,
  }),
  tick_cron: cron,
  drift_rate: unit,
  noise: unit,
  energy_peak_hour: hourOfDay,
  energy_amplitude: unit,
  busy_drain: unit,
  full_load_hours: z.number().positive(),
  preoccupation_hours: z.number().positive(),
  preoccupation_min_valence: unit,
  event_gain: unit,
  event_arousal_gain: unit,
  needs_baseline: unit,
  need_decay_per_day: unit,
  emotion_hours: z.number().positive(),
  bands: z.object({ energy: band, mood_valence: band, mood_arousal: band, needs: band }),
});

const coreAppraise = z.object({
  max_tokens: positiveInt,
  episode_max_chars: positiveInt,
  label_max_chars: positiveInt,
  about_max_chars: positiveInt,
  salience: z.object({ low: unit, medium: unit, high: unit }),
  need_gain: unit,
  fallback_band: band,
  fallback_labels: z.object({ negative: text, neutral: text, positive: text }),
});

const coreWorld = z.object({
  tick_cron: cron,
  events_local_hour: hourOfDay,
  events_per_day_max: countFromZero,
  event_probability: unit,
  fallthrough_probability: unit,
  goal_driven_share: unit,
  goal_weight_floor: unit,
  event_context_items: countFromZero,
  event_context_days: nonNegative,
  event_max_tokens: positiveInt,
  event_max_chars: positiveInt,
  injected_event_at: clockTime,
  event_salience: unit,
  event_confidence: unit,
  entity_salience: unit,
  regen_attempts: countFromZero,
  new_entity_days: nonNegative,
  high_stakes_min_days: nonNegative,
  canon_entities: z.array(text),
});

/** Every core loop that may call a model, so the budget can name it. */
export const CORE_LOOPS = [
  "life_plan",
  "life_event",
  "core_resolve",
  "core_appraise",
  "core_reflect",
  "core_render_snapshot",
  "core_drift_watch",
  "core_consolidate",
  "core_anticipate",
  "core_ruminate",
  "core_wander",
  "post_draft",
  "post_check",
] as const;
export type CoreLoopName = (typeof CORE_LOOPS)[number];
const coreLoop = z.enum(CORE_LOOPS);

const core = z
  .object({
    // Listed literally: schema.ts imports this file, so importing its kind enum would cycle.
    depth: z.object({
      by_kind: z.object({
        episode: tier,
        opinion: tier,
        interest: tier,
        goal: tier,
        intention: tier,
        thought: tier,
        reflection: tier,
        idea: tier,
        hypothetical: tier,
        insight: tier,
        narrative: tier,
        agent_note: tier,
      }),
      by_section: z.record(z.string(), tier),
    }),
    appraise: coreAppraise,
    anticipate: z.object({ lead_hours: z.number().positive(), arousal_gain: unit }),
    ruminate: z.object({
      delay_hours: z.number().positive(),
      window_hours: z.number().positive(),
      min_valence: unit,
      max_per_episode: countFromZero,
      gain: unit,
    }),
    wander: z.object({
      max_per_day: countFromZero,
      min_gap_hours: z.number().positive(),
      seed_days: positiveInt,
      seed_limit: positiveInt,
      mood_bias: z.number().min(-1).max(1),
      chain: positiveInt,
      min_similarity: unit,
      max_items: positiveInt,
    }),
    resolve: z.object({ max_tokens: positiveInt }),
    snapshot: z.object({ max_items: positiveInt, max_tokens: positiveInt }),
    drift: z.object({ max_tokens: positiveInt }),
    reflect: z.object({
      max_inputs: positiveInt,
      context_items: positiveInt,
      max_insights: countFromZero,
      max_opinions: countFromZero,
      max_interests: countFromZero,
      confidence: z.object({ low: unit, medium: unit, high: unit }),
      salience: z.object({ insight: unit, opinion: unit, interest: unit, narrative: unit }),
      fade_factor: unit,
      max_tokens: positiveInt,
    }),
    decay: z.object({ grace_days: nonNegative, rate: unit, stale_floor: unit }),
    consolidate: z.object({
      gist_after_days: positiveInt,
      min_group: positiveInt,
      max_groups: positiveInt,
      gist_source_factor: unit,
      max_tokens: positiveInt,
    }),
    mind: z.object({ tick_cron: cron }),
    nightly: z.object({ tick_cron: cron, local_hour: hourOfDay }),
    loops: z.object({
      max_chars: positiveInt,
      max_tokens: positiveInt,
      salience: z.object({ low: unit, medium: unit }),
      thought_confidence: unit,
      dedupe_similarity: unit,
    }),
    daily_call_budget: countFromZero,
    max_retries: countFromZero,
    budget_reserve: countFromZero,
    loop_priority: z.object({ essential: z.array(coreLoop), optional: z.array(coreLoop) }),
    // US dollars per million tokens, by model id.
    prices: z.record(z.string(), z.object({ input: nonNegative, output: nonNegative })),
    goals: z.object({
      max_active: positiveInt,
      min_active: z.number().int().min(0),
      step: z.object({ small: unit, medium: unit, large: unit }),
    }),
    state: coreState,
    world: coreWorld,
  })
  .refine(
    (c) => c.budget_reserve <= c.daily_call_budget,
    "core.budget_reserve must be <= daily_call_budget",
  );

const availability = z.object({
  override_closeness: z.number().gt(0).max(1),
  max_delay_ms: countFromZero,
  quiet_max_delay_ms: countFromZero,
  jitter: z.number().min(0).max(0.5),
  note_min_delay_ms: countFromZero,
  note_min_closeness: unit,
  note_read_delay_ms: countFromZero,
});

const outreach = z.object({
  enabled: z.boolean(),
  tick_cron: cron,
  cap_per_day: countFromZero,
  cap_per_week: countFromZero,
  max_unanswered: z.number().int().min(1),
  threshold: nonNegative,
  weights: z.object({
    thread: unit,
    make_up: unit,
    user_event: unit,
    her_day: unit,
    core_thought: unit,
    user_idea: unit,
    check_in: unit,
  }),
  stakes_strength: z.object({ high: unit, med: unit }),
  user_event_lookback_hours: z.number().positive(),
  her_day_lookback_hours: z.number().positive(),
  core_thought_lookback_hours: z.number().positive(),
  core_thought_limit: positiveInt,
  user_idea_limit: positiveInt,
  check_in_gap_factor: z.number().positive(),
  jitter_max_minutes: nonNegative,
  due_threads_limit: positiveInt,
  her_day_limit: positiveInt,
  pending_max_age_minutes: z.number().positive(),
  log_list_limit: positiveInt,
});

const push = z.object({
  enabled: z.boolean(),
  timeout_ms: positiveInt,
  ttl_seconds: positiveInt,
  // Web Push payloads are limited to about 4 KB.
  body_max_chars: z.number().int().min(2),
  // Crisis replies push this instead of her words.
  generic_body: text,
});

const moveMultipliers = z.object({
  react: nonNegative.optional(),
  share: nonNegative.optional(),
  ask: nonNegative.optional(),
  /** Bands to move her length by while this state holds; negative is shorter. */
  band_shift: z.number().int().optional(),
});

const voice = z.object({
  window_messages: positiveInt,
  base_words_per_bubble: z.number().positive(),
  bands: z
    .array(z.object({ key: text, max_words: positiveInt }))
    .min(1)
    .refine(
      (b) => b.every((x, i) => i === 0 || x.max_words > b[i - 1]!.max_words),
      "voice.bands: max_words must ascend",
    ),
  formal_threshold: unit,
  emoji_rate: nonNegative,
  split_tolerance: z.number().min(1),
  feeling_max_lines: positiveInt,
  moves: z.object({
    weights: z.object({ react: nonNegative, share: nonNegative, ask: nonNegative }),
    /** Keyed by mood key ("energy low", "hurt above"); unknown keys are simply never matched. */
    bias: z.record(z.string(), moveMultipliers),
  }),
});

const prompts = z.object({
  reach_out: promptVersion,
  reply: promptVersion,
  persona: promptVersion,
  crisis_classifier: promptVersion,
  post_draft: promptVersion,
  post_check: promptVersion,
  format_draft: promptVersion,
  extract: promptVersion,
  reconcile: promptVersion,
  judge_recall: promptVersion,
  judge_false_recall: promptVersion,
  judge_consistency: promptVersion,
  judge_turn: promptVersion,
  guard: promptVersion,
  guard_crisis: promptVersion,
  guard_corrective: promptVersion,
  guard_fallback: promptVersion,
  turn_judge: promptVersion,
  relationship_summary: promptVersion,
  relationship_openness: promptVersion,
  relationship_stage: promptVersion,
  life_plan: promptVersion,
  life_event: promptVersion,
  core_appraise: promptVersion,
  core_anticipate: promptVersion,
  core_ruminate: promptVersion,
  core_wander: promptVersion,
  core_reflect: promptVersion,
  core_snapshot: promptVersion,
  core_drift: promptVersion,
  core_consolidate: promptVersion,
  core_resolve: promptVersion,
  user_summarise: promptVersion,
  user_reflect: promptVersion,
  user_ideate: promptVersion,
  user_consolidate: promptVersion,
  user_model: promptVersion,
  life_availability: promptVersion,
  core_state_line: promptVersion,
  voice_how_to_text: promptVersion,
});

const userMind = z.object({
  max_triggers_per_day: positiveInt,
  sweep_after_minutes: countFromZero,
  tick: z.object({ cron, lookback_hours: z.number().positive() }),
  triggers: z.object({
    param_jump: unit,
    bands: z.array(unit).min(1),
    fact_salience: unit,
    long_conversation: z.object({ min_user_turns: positiveInt, quiet_minutes: countFromZero }),
    stale_summary: z.object({ max_age_hours: z.number().positive(), lead_minutes: countFromZero }),
    milestone: z.object({ their_depth: unit }),
  }),
  summarise: z.object({
    max_facts: positiveInt,
    max_threads: countFromZero,
    since_slack_minutes: countFromZero,
    max_chars: positiveInt,
    max_tokens: positiveInt,
    salience: unit,
    confidence: unit,
  }),
  reflect: z.object({
    recent: countFromZero,
    max_chars: positiveInt,
    max_tokens: positiveInt,
    salience: unit,
    confidence: unit,
  }),
  ideate: z.object({
    max_chars: positiveInt,
    max_tokens: positiveInt,
    salience: unit,
    confidence: unit,
    ttl_days: z.number().positive(),
    max_planned: positiveInt,
    slot_max: countFromZero,
  }),
  consolidate: z.object({
    gist_after_days: positiveInt,
    min_group: positiveInt,
    max_sources: positiveInt,
    gist_source_factor: unit,
    max_chars: positiveInt,
    max_tokens: positiveInt,
    confidence: unit,
  }),
  model: z.object({
    max_chars: positiveInt,
    max_tokens: positiveInt,
    max_beliefs: countFromZero,
    belief_context: countFromZero,
    dedupe_similarity: unit,
    salience: unit,
    belief_salience: unit,
    confidence: unit,
  }),
});

const onboarding = z.object({
  quiz_version: promptVersion,
  confidence: unit,
  salience: unit,
  // Points either side of 50 that read as "somewhere between".
  neutral_band: z.number().min(0).max(50),
  click_gap: z.number().min(0).max(100),
  clash_gap: z.number().min(0).max(100),
  topic_similarity: unit,
  max_answer_chars: positiveInt,
  max_name_chars: positiveInt,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const font = z.object({ file: text, family: text });

const posts = z
  .object({
    tick_cron: cron,
    browse_per_day: countFromZero,
    // Her local hours she may browse in, outside her busy and quiet blocks.
    browse_window: z.tuple([hhmm, hhmm]),
    browse_step_minutes: positiveInt,
    sources: z.array(z.object({ name: text, weight: z.number().positive() })),
    fetch_timeout_ms: positiveInt,
    // Largest image she will download; a full-size original can be tens of megabytes.
    max_download_bytes: positiveInt,
    user_agent: text,
    // What's built: a medium outside this list is never posted, whatever her skill.
    capabilities: z.array(z.enum(["still"])).min(1),
    craft_goals: z.object({ still: text }),
    max_per_week: positiveInt,
    max_pending: positiveInt,
    max_find_age_hours: z.number().positive(),
    min_valence: unit,
    candidate_limit: positiveInt,
    max_find_px: positiveInt,
    output_width: positiveInt,
    caption_max_chars: positiveInt,
    overlay_max_chars: positiveInt,
    media_dir: text,
    formats_dir: text,
    poses_dir: text,
    fonts: z.object({ plain: font, handwritten: font }),
    // Homemade roughness at skill 0; it shrinks linearly to none at skill 1.
    jitter: z.object({
      crop: z.number().min(0).max(0.3),
      tilt_deg: z.number().min(0).max(15),
      place: z.number().min(0).max(0.3),
    }),
    // The look of a render: shadow, glow, caption band, type and placement.
    render: z.object({
      shadow_blur: z.number().positive(),
      shadow_opacity: unit,
      shadow_darkness: unit,
      glow_blur: z.number().positive(),
      band_alpha: unit,
      label_font_size: positiveInt,
      caption_font_size: positiveInt,
      text_dpi: positiveInt,
      text_width_share: unit,
      overlay_pad_share: unit,
      floor_line: unit,
      foot_left: unit,
      foot_right: unit,
      tint_luma_divisor: z.number().positive(),
      tint_brightness: z.tuple([z.number().positive(), z.number().positive()]),
    }),
    recent_limit: positiveInt,
  })
  .refine((p) => p.browse_window[0] < p.browse_window[1], "posts.browse_window must be ordered");

// ---------- The whole config ----------

export const ConfigSchema = z.object({
  models,
  embedding,
  session,
  chat,
  safety,
  queue,
  auth,
  guard,
  hot_path: hotPath,
  events,
  turn,
  retrieval,
  claims,
  inspector,
  extraction,
  reconcile,
  decay,
  cold_path: coldPath,
  relationship,
  life,
  core,
  availability,
  outreach,
  push,
  user_mind: userMind,
  onboarding,
  posts,
  voice,
  prompts,
});

export type Config = z.infer<typeof ConfigSchema>;
export type CrisisCard = z.infer<typeof CrisisCardSchema>;
export type TurnConfig = Config["turn"];
export type LifeConfig = Config["life"];
export type CoreStateConfig = Config["core"]["state"];
export type AvailabilityConfig = Config["availability"];
export type OutreachConfig = Config["outreach"];
export type VoiceConfig = Config["voice"];

/** The dimension baked into the `fact.embedding` column. Changing it needs a migration and a re-embed. */
export const EMBEDDING_DIMENSIONS: number = defaults.embedding.dimensions;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursive merge of plain objects: `over` wins, and arrays and scalars are replaced whole. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = deepMerge(base[key], value);
  return merged;
}

export function loadConfig(overrides: unknown = {}): Config {
  const config = ConfigSchema.parse(deepMerge(defaults, overrides));

  if (config.embedding.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding dimension ${config.embedding.dimensions} does not match the schema (${EMBEDDING_DIMENSIONS}); this needs a migration, not a config override`,
    );
  }
  return config;
}

/** Parses the SPICA_CONFIG override string; empty means no overrides. */
export function parseConfigOverrides(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("SPICA_CONFIG is not valid JSON");
  }
}
