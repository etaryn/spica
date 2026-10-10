/**
 * Relationship signals: what extraction read from how the user treated her in one exchange.
 * Warmth, trust, tension, hurt with its cause, apology, making up, ending, and repair; and how
 * much the user opened up and met what she shared.
 */
import { z } from "zod";
import { clamp } from "@/mind/platform/math";
import type { Intimacy } from "./types";

/** The extraction's intimacy block, read from the user's messages only. */
export const IntimacySchema = z.object({
  user_disclosure: z.number(),
  user_responsiveness: z.number().nullable(),
});

/** Anything invalid becomes null, so a bad block never fails the memory write. */
export function normalizeIntimacy(raw: unknown): Intimacy | null {
  const parsed = IntimacySchema.safeParse(raw);
  if (!parsed.success) return null;
  const { user_disclosure, user_responsiveness } = parsed.data;
  return {
    user_disclosure: clamp(user_disclosure, 0, 1),
    user_responsiveness: user_responsiveness === null ? null : clamp(user_responsiveness, 0, 1),
  };
}

/** The extraction's relationship block. No numeric bounds (structured outputs don't support them). */
export const RelationshipSignalsSchema = z.object({
  warmth: z.number(),
  trust: z.number(),
  tension: z.number(),
  hurt: z.object({ amount: z.number(), cause: z.string() }).nullable(),
  apology: z.boolean(),
  make_up: z.boolean(),
  ends_relationship: z.boolean(),
  retracts_ending: z.boolean(),
  wants_repair: z.boolean(),
});

export type Signals = {
  warmth: number;
  trust: number;
  tension: number;
  hurt: { amount: number; cause: string } | null;
  apology: boolean;
  make_up: boolean;
  ends_relationship: boolean;
  retracts_ending: boolean;
  wants_repair: boolean;
};

/** Tidies the cause into a phrase that reads inside "Spica felt hurt because …". */
function tidyCause(cause: string): string {
  return cause
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "");
}

/** Anything that doesn't validate becomes null, so a bad block never fails the memory write. */
export function normalizeSignals(raw: unknown): Signals | null {
  if (raw === null || raw === undefined) return null;

  const parsed = RelationshipSignalsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const signals = parsed.data;
  const cause = signals.hurt ? tidyCause(signals.hurt.cause) : "";

  return {
    warmth: clamp(signals.warmth, -1, 1),
    trust: clamp(signals.trust, -1, 1),
    tension: clamp(signals.tension, -1, 1),
    hurt: signals.hurt && cause ? { amount: clamp(signals.hurt.amount, 0, 1), cause } : null,
    apology: signals.apology,
    make_up: signals.make_up,
    ends_relationship: signals.ends_relationship,
    retracts_ending: signals.retracts_ending,
    wants_repair: signals.wants_repair,
  };
}

/** Why she's hurt lives in memory as a `feeling` fact, not on the relationship row. */
export function hurtFactContent(cause: string): string {
  return `Spica felt hurt because ${cause}.`;
}
