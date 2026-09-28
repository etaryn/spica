import { z } from "zod";
import defaults from "../../config/default.json";

const CrisisCardSchema = z.object({ title: z.string().min(1), lines: z.array(z.string().min(1)).min(1) });
const unit = z.number().min(0).max(1);

export const ConfigSchema = z.object({
  models: z.object({
    reply: z.string().min(1),
    cheap: z.string().min(1),
    extract: z.string().min(1),
    judge: z.string().min(1),
    guard: z.string().min(1),
    turn_judge: z.string().min(1),
    reply_max_tokens: z.number().int().positive(),
    extract_max_tokens: z.number().int().positive(),
    judge_max_tokens: z.number().int().positive(),
    guard_max_tokens: z.number().int().positive(),
    turn_judge_max_tokens: z.number().int().positive(),
    structured_timeout_ms: z.number().int().positive(),
    // null: send no `effort` (Haiku 4.5 rejects it).
    reply_effort: z.enum(["low", "medium", "high"]).nullable(),
    reply_thinking: z.enum(["disabled", "adaptive"]),
    judge_effort: z.enum(["low", "medium", "high"]).nullable(),
    judge_thinking: z.enum(["disabled", "adaptive"]),
    reply_timeout_ms: z.number().int().positive(),
    reply_max_retries: z.number().int().min(0),
  }),
  embedding: z.object({
    provider: z.literal("voyage"),
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
  }),
  session: z.object({ idle_gap_minutes: z.number().positive() }),
  chat: z.object({
    recent_turns: z.number().int().positive(),
    max_parts: z.number().int().positive(),
    history_page_size: z.number().int().positive(),
    max_message_chars: z.number().int().positive(),
    gap_line_min_hours: z.number().min(0),
    relationship_line: z.boolean(),
  }),
  safety: z.object({
    classifier_timeout_ms: z.number().int().positive(),
    classifier_max_tokens: z.number().int().positive(),
    classifier_context_turns: z.number().int().min(0),
    keywords: z.array(z.string().min(1)).min(1),
    resources: z.record(z.string(), CrisisCardSchema).refine((r) => "default" in r, "resources.default is required"),
  }),
  queue: z.object({ enqueue_timeout_ms: z.number().int().positive() }),
  auth: z.object({ min_age: z.number().int().positive(), min_password_length: z.number().int().min(8) }),
  guard: z.object({
    enabled: z.boolean(),
    timeout_ms: z.number().int().positive(),
    retry_limit: z.number().int().min(0),
    log_timeout_ms: z.number().int().positive(),
    fallback_keywords: z.array(z.string().min(1)).min(1),
  }),
  hot_path: z.object({ db_timeout_ms: z.number().int().positive() }),
  events: z.object({ channel: z.string().regex(/^[a-z_][a-z0-9_]*$/), heartbeat_ms: z.number().int().positive() }),
  turn: z.object({
    settle_ms: z.number().int().min(0),
    wait_ms: z.number().int().min(0),
    short_message_chars: z.number().int().min(0),
    short_wait_bonus_ms: z.number().int().min(0),
    max_wait_ms: z.number().int().positive(),
    read_delay_min_ms: z.number().int().min(0),
    read_delay_max_ms: z.number().int().min(0),
    read_delay_chars_for_max: z.number().int().positive(),
    typing_ms_per_char: z.number().min(0),
    typing_max_ms: z.number().int().min(0),
    part_gap_ms: z.number().int().min(0),
    backchannel_style: z.enum(["judge", "signals", "silent"]),
    backchannel_min_interval_ms: z.number().int().min(0),
    backchannel_max_words: z.number().int().positive(),
    backchannel_read_delay_ms: z.number().int().min(0),
    signals_probability: unit,
    max_open_questions: z.number().int().min(0),
    incomplete_cues: z.array(z.string().min(1)),
    judge_timeout_ms: z.number().int().positive(),
    judge_context_turns: z.number().int().min(0),
    retry_limit: z.number().int().min(0),
    retry_delay_ms: z.number().int().min(0),
    inflight_recheck_ms: z.number().int().positive(),
    worker_concurrency: z.number().int().positive(),
    worker_polling_interval_seconds: z.number().min(0.5),
    job_expire_seconds: z.number().int().positive(),
    sweep_cron: z.string().min(1),
    sweep_grace_ms: z.number().int().min(0),
    sweep_batch: z.number().int().positive(),
  }).refine((t) => t.read_delay_min_ms <= t.read_delay_max_ms, "turn.read_delay_min_ms must be <= read_delay_max_ms"),
  retrieval: z.object({
    candidate_pool: z.number().int().positive(),
    top_n: z.number().int().positive(),
    recency_half_life_days: z.number().positive(),
    recall_bump: unit,
    recall_cap: unit,
    reinforce_min_sim: unit,
    embed_timeout_ms: z.number().int().positive(),
    context_turns: z.number().int().min(0),
    max_due_threads: z.number().int().min(0),
  }),
  extraction: z.object({
    context_turns: z.number().int().min(0),
    max_candidates: z.number().int().positive(),
    open_threads_in_prompt: z.number().int().min(0),
    new_entity_salience: unit,
    entity_bump: unit,
  }),
  reconcile: z.object({
    neighbor_k: z.number().int().positive(),
    near_match_similarity: unit,
    duplicate_bump: unit,
    max_tokens: z.number().int().positive(),
  }),
  decay: z.object({
    cron: z.string().min(1),
    grace_days: z.number().min(0),
    rate: unit,
    stale_floor: unit,
    dormant_after_days: z.number().min(0),
  }),
  cold_path: z.object({
    retry_limit: z.number().int().min(0),
    retry_delay_seconds: z.number().int().positive(),
    max_sweep_attempts: z.number().int().positive(),
    sweep_cron: z.string().min(1),
    sweep_min_age_minutes: z.number().int().min(0),
    sweep_batch: z.number().int().positive(),
  }),
  relationship: (() => {
    const paramRecord = <T extends z.ZodTypeAny>(t: T) =>
      z.object({ closeness: t, trust: t, warmth: t, hurt: t, tension: t, msgs_per_day: t });
    return z.object({
      tick_cron: z.string().min(1),
      baseline_alpha: unit,
      variance_epsilon: z.number().positive(),
      initial: paramRecord(z.number().min(0)),
      initial_variance: paramRecord(z.number().min(0)),
      gains: z.object({ warmth: unit, trust: unit, tension: unit, hurt: unit, closeness_per_warm_exchange: unit }),
      hurt_half_life_hours: z.number().positive(),
      tension_half_life_hours: z.number().positive(),
      sensitise_window_days: z.number().min(0),
      sensitise_factor: z.number().min(1),
      scar_threshold: unit,
      scar_trust_dent: unit,
      absence_grace_factor: z.number().positive(),
      closeness_absence_drift: unit,
      absence_hurt_effect: z.number().min(-1).max(0),
      absence_hurt_gain: unit,
      make_up_threshold: unit,
      make_up_clear_threshold: unit,
      make_up_delay_replies: z.number().int().min(0),
      make_up_relief: unit,
      apology_relief: unit,
      relief_tension_factor: unit,
      end_confirm_hours: z.number().positive(),
      end_closeness_factor: unit,
      repair_gain_factor: unit,
      repair_complete_closeness: unit,
      repair_min_days: z.number().min(0),
      crisis_quiet_hours: z.number().min(0),
      summary_min_effect: unit,
      summary_strong_effect: unit,
      summary_max_lines: z.number().int().min(0),
      signal_deadzone: unit,
      cadence_sessions: z.number().int().positive(),
      hurt_fact_salience: unit,
      hurt_fact_confidence: unit,
      default_median_gap_hours: z.number().positive(),
      min_sessions_for_gap: z.number().int().min(2),
      event_list_limit: z.number().int().positive(),
    }).refine((r) => r.make_up_clear_threshold < r.make_up_threshold, "relationship.make_up_clear_threshold must be < make_up_threshold");
  })(),
  prompts: z.object({
    reply: z.string().regex(/^v\d+$/),
    persona: z.string().regex(/^v\d+$/),
    crisis_classifier: z.string().regex(/^v\d+$/),
    extract: z.string().regex(/^v\d+$/),
    reconcile: z.string().regex(/^v\d+$/),
    judge_recall: z.string().regex(/^v\d+$/),
    judge_false_recall: z.string().regex(/^v\d+$/),
    judge_consistency: z.string().regex(/^v\d+$/),
    judge_turn: z.string().regex(/^v\d+$/),
    guard: z.string().regex(/^v\d+$/),
    guard_crisis: z.string().regex(/^v\d+$/),
    guard_corrective: z.string().regex(/^v\d+$/),
    guard_fallback: z.string().regex(/^v\d+$/),
    turn_judge: z.string().regex(/^v\d+$/),
    relationship_summary: z.string().regex(/^v\d+$/),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CrisisCard = z.infer<typeof CrisisCardSchema>;
export type TurnConfig = Config["turn"];

/** The dimension baked into the `fact.embedding` column. Changing it needs a migration + re-embed. */
export const EMBEDDING_DIMENSIONS: number = defaults.embedding.dimensions;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge of plain objects; `over` wins, arrays and scalars are replaced whole. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
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

export function parseConfigOverrides(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("SPICA_CONFIG is not valid JSON");
  }
}
