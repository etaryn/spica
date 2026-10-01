/**
 * Queue names are stored in the database (scheduled and pending jobs), so renaming a constant
 * must never change its string.
 */
import { describe, expect, it } from "vitest";
import * as jobs from "@/mind/platform/jobs";

describe("job names", () => {
  it("keep the names already stored in pg-boss", () => {
    const names = Object.entries(jobs)
      .filter(([, value]) => typeof value === "string")
      .map(([, value]) => value)
      .sort();
    expect(names).toEqual([
      "cold_path",
      "cold_path_sweep",
      "core_state_tick",
      "decay_pass",
      "life_plan",
      "life_tick",
      "outreach_tick",
      "reach_out_send",
      "relationship_tick",
      "turn_backchannel",
      "turn_sweep",
      "turn_timer",
    ]);
  });
});
