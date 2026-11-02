/** The usage sink books a user's call, skips core's, and never fails a reply over bookkeeping. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { llmUsageSince } from "@/db/repos/user/llm-usage";
import type { LlmUsage } from "@/mind/platform/llm/types";
import { recordUsage } from "@/runtime/usage-sink";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = new Date("2026-01-05T09:00:00Z");
const clock = { now: () => at, sleep: async () => {} };
const usage = (over: Partial<LlmUsage> = {}): LlmUsage => ({
  purpose: "reply",
  model: "claude-sonnet-5",
  input_tokens: 10,
  output_tokens: 2,
  cache_read_input_tokens: 3,
  cache_creation_input_tokens: 4,
  cache_creation_1h_input_tokens: 4,
  ...over,
});

test("books a user's call to them and skips a call that belongs to nobody", async () => {
  const u = await createTestUser("a");
  const log = { info: vi.fn(), error: vi.fn() };
  const deps = { db: getTestDb(), clock, log };
  await recordUsage(deps, usage({ user_id: u }));
  await recordUsage(deps, usage({ purpose: "core_wander" }));
  const rows = await llmUsageSince(getTestDb(), u, new Date("2026-01-01T00:00:00Z"));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ purpose: "reply", calls: 1, input_tokens: 10 });
  expect(log.error).not.toHaveBeenCalled();
});

test("a failed write is logged, never thrown, so a reply is never lost to bookkeeping", async () => {
  const log = { info: vi.fn(), error: vi.fn() };
  // No such user: the foreign key refuses the row.
  await expect(
    recordUsage({ db: getTestDb(), clock, log }, usage({ user_id: crypto.randomUUID() })),
  ).resolves.toBeUndefined();
  expect(log.error).toHaveBeenCalledWith(
    "llm usage not recorded",
    expect.objectContaining({ purpose: "reply" }),
  );
});
