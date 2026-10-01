import { z } from "zod";

/** The extraction's relationship block. No numeric bounds (unsupported by structured outputs). */
export const RelationshipSignalsSchema = z.object({
  warmth: z.number(), trust: z.number(), tension: z.number(),
  hurt: z.object({ amount: z.number(), cause: z.string() }).nullable(),
  apology: z.boolean(), make_up: z.boolean(),
  ends_relationship: z.boolean(), retracts_ending: z.boolean(), wants_repair: z.boolean(),
});
export type Signals = {
  warmth: number; trust: number; tension: number; hurt: { amount: number; cause: string } | null;
  apology: boolean; make_up: boolean; ends_relationship: boolean; retracts_ending: boolean; wants_repair: boolean;
};

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

export function normalizeSignals(raw: unknown): Signals | null {
  if (raw === null || raw === undefined) return null;
  const r = RelationshipSignalsSchema.safeParse(raw);
  if (!r.success) return null;
  const s = r.data;
  const cause = s.hurt?.cause.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "") ?? "";
  return {
    warmth: clamp(s.warmth, -1, 1), trust: clamp(s.trust, -1, 1), tension: clamp(s.tension, -1, 1),
    hurt: s.hurt && cause ? { amount: clamp(s.hurt.amount, 0, 1), cause } : null,
    apology: s.apology, make_up: s.make_up, ends_relationship: s.ends_relationship, retracts_ending: s.retracts_ending, wants_repair: s.wants_repair,
  };
}

/** The `feeling` fact that holds why she's hurt (the reason lives in the fact store, not the relationship row). */
export function hurtFactContent(cause: string): string {
  return `Spica felt hurt because ${cause}.`;
}
