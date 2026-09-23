import { z } from "zod";
import defaults from "../../config/default.json";

const CrisisCardSchema = z.object({ title: z.string().min(1), lines: z.array(z.string().min(1)).min(1) });

export const ConfigSchema = z.object({
  models: z.object({
    reply: z.string().min(1),
    cheap: z.string().min(1),
    reply_max_tokens: z.number().int().positive(),
    reply_effort: z.enum(["low", "medium", "high"]),
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
  prompts: z.object({ reply: z.string().regex(/^v\d+$/), crisis_classifier: z.string().regex(/^v\d+$/) }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CrisisCard = z.infer<typeof CrisisCardSchema>;

/** The dimension baked into the `fact.embedding` column. Changing it needs a migration + re-embed. */
export const EMBEDDING_DIMENSIONS: number = defaults.embedding.dimensions;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
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
