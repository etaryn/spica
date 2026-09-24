import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const Session = z.object({
  at: z.string(),
  user: z.string().regex(/^[a-z0-9_-]+$/).default("main"),
  forget: z.array(z.string().min(1)).default([]),
  turns: z.array(z.string().min(1)).min(1),
});

const StateAssertion = z.object({
  type: z.literal("state"), check: z.string(), user: z.string().default("main"),
  params: z.record(z.string(), z.unknown()).default({}), expect: z.unknown(),
});
const RecallAssertion = z.object({ type: z.literal("recall"), session: z.number().int().min(1), fact: z.string().min(1), user: z.string().default("main") });
const NoFalseRecallAssertion = z.object({ type: z.literal("no_false_recall"), user: z.string().default("main") });
const ConsistencyAssertion = z.object({ type: z.literal("consistency"), user: z.string().default("main") });

/** Assertion types defined by v2 §14.2 but implemented in later phases. */
export const DEFERRED: Record<string, number> = { reach_out: 5 };
const DeferredAssertion = z.looseObject({ type: z.enum(["reach_out"]) });

export const ScriptSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  mode: z.enum(["any", "real"]).default("any"),
  turn_gap_seconds: z.number().int().positive().default(30),
  sessions: z.array(Session).min(1),
  assertions: z.array(z.union([StateAssertion, RecallAssertion, NoFalseRecallAssertion, ConsistencyAssertion, DeferredAssertion])).min(1),
});

export type Script = z.infer<typeof ScriptSchema>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const UNIT: Record<string, number> = { d: DAY, h: HOUR, m: MIN };
/** Monday 2026-01-05 00:00 UTC. Fixed so every run is deterministic. */
const BASE = Date.UTC(2026, 0, 5);

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
