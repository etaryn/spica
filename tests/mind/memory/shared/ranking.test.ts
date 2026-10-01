import { expect, test } from "vitest";
import { rankMemories, recencyFactor } from "@/mind/memory/shared/ranking";

const now = new Date("2026-02-04T00:00:00Z");
const c = (id: string, over: Partial<Parameters<typeof rankMemories>[0][number]> = {}) => ({
  id,
  subject: "user" as const,
  content: id,
  salience: 0.5,
  created_at: now,
  last_recalled_at: null,
  occurred_at: null,
  sim: 0.8,
  entity_salience: 1,
  ...over,
});

test("recency halves every half-life and never exceeds 1", () => {
  expect(recencyFactor(0, 30)).toBe(1);
  expect(recencyFactor(30, 30)).toBeCloseTo(0.5, 10);
  expect(recencyFactor(60, 30)).toBeCloseTo(0.25, 10);
  expect(recencyFactor(-5, 30)).toBe(1);
});

test("score = sim × salience × entity salience × recency; recall refreshes recency; top_n cut", () => {
  const ranked = rankMemories(
    [
      c("stale-ish", { created_at: new Date("2026-01-05T00:00:00Z") }),
      c("recalled", { created_at: new Date("2026-01-05T00:00:00Z"), last_recalled_at: now }),
      c("important", { salience: 0.9, entity_salience: 0.9 }),
      c("negative-sim", { sim: -0.2 }),
    ],
    now,
    { top_n: 3, recency_half_life_days: 30 },
  );
  expect(ranked.map((r) => r.id)).toEqual(["important", "recalled", "stale-ish"]);
  expect(ranked[0]!.score).toBeCloseTo(0.8 * 0.9 * 0.9 * 1, 10);
  expect(ranked[2]!.recency).toBeCloseTo(0.5, 10);
});
