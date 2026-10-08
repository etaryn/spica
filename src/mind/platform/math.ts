/** Number helpers shared across the mind. Model outputs are zod-parsed first, so inputs are finite. */

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
