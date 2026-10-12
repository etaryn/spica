/** Number helpers shared across the mind. Model outputs are zod-parsed first, so inputs are finite. */

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Cosine similarity of two vectors of the same length. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(aa * bb);
}
