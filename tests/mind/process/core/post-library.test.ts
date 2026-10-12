/** Formats, poses and her craft skill: only reviewed formats she's good enough for, within what's built. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import {
  choosePose,
  craftSkill,
  eligibleFormats,
  loadFormats,
  loadPoses,
  type StillFormat,
} from "@/mind/process/core/post-library";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const base: StillFormat = {
  name: "f",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0,
  caption_pattern: "short",
  reviewed: true,
};

function logs() {
  const lines: { msg: string; meta?: object }[] = [];
  const log = {
    info: (msg: string, meta?: object) => lines.push({ msg, meta }),
    error: (msg: string, meta?: object) => lines.push({ msg, meta }),
  };
  return { log: log as never, lines };
}

test("the shipped formats and poses load", () => {
  const { log, lines } = logs();
  expect(
    loadFormats("formats/stills", log)
      .map((f) => f.name)
      .sort(),
  ).toEqual(["plain", "polaroid", "screenshot"]);
  expect(lines).toEqual([]);
  expect(loadPoses("assets/poses").map((p) => p.name)).toContain("walk-01");
});

test("an invalid or misnamed format file is skipped and logged by name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "formats-"));
  writeFileSync(path.join(dir, "good.json"), JSON.stringify({ ...base, name: "good" }));
  writeFileSync(
    path.join(dir, "bad.json"),
    JSON.stringify({ ...base, name: "bad", aspect: "3:2" }),
  );
  writeFileSync(path.join(dir, "other.json"), JSON.stringify({ ...base, name: "renamed" }));
  writeFileSync(path.join(dir, "broken.json"), "{");
  const { log, lines } = logs();
  expect(loadFormats(dir, log).map((f) => f.name)).toEqual(["good"]);
  expect(lines.map((l) => (l.meta as { file: string }).file).sort()).toEqual([
    "bad.json",
    "broken.json",
    "other.json",
  ]);
});

test("eligible: reviewed, a built medium, and within her skill", () => {
  const formats = [
    { ...base, name: "a" },
    { ...base, name: "b", reviewed: false },
    { ...base, name: "c", min_skill: 0.5 },
  ];
  expect(eligibleFormats(formats, ["still"], 0.2).map((f) => f.name)).toEqual(["a"]);
  expect(eligibleFormats(formats, ["still"], 0.5).map((f) => f.name)).toEqual(["a", "c"]);
  expect(eligibleFormats(formats, [], 1)).toEqual([]);
});

test("a pose comes from the format's tags, or none", () => {
  const poses = loadPoses("assets/poses");
  expect(choosePose(poses, { ...base, poses: ["looking_up"] }, 0.9)?.name).toBe("look-up-01");
  expect(choosePose(poses, { ...base, poses: ["flying"] }, 0.1)).toBeNull();
});

// enabled in the persona task
test.skip("craft skill: created once from her persona, then read from the goal", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const first = await craftSkill(deps, "still");
  expect(first.skill).toBe(0);
  expect(first.goalId).not.toBeNull();
  const again = await craftSkill(deps, "still");
  expect(again.goalId).toBe(first.goalId);
  await deps.core.goals.setProgress(first.goalId!, 0.4, deps.clock.now());
  expect((await craftSkill(deps, "still")).skill).toBe(0.4);
});

// enabled in the persona task
test.skip("craft skill: done reads 1, dropped keeps its progress, neither is recreated", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const { goalId } = await craftSkill(deps, "still");
  await deps.core.goals.setProgress(goalId!, 0.3, deps.clock.now());
  await deps.core.goals.setStatus(goalId!, "dropped", deps.clock.now());
  expect(await craftSkill(deps, "still")).toEqual({ goalId: null, skill: 0.3 });
  const deps2 = coreDepsOf(makeTestDeps());
  await resetDb();
  const g = await craftSkill(deps2, "still");
  await deps2.core.goals.setStatus(g.goalId!, "done", deps2.clock.now());
  expect(await craftSkill(deps2, "still")).toEqual({ goalId: null, skill: 1 });
  expect((await deps2.core.goals.active()).length).toBe(0);
});

// enabled in the persona task
test.skip("craft skill: no room for another active goal reads 0 and creates nothing", async () => {
  const deps = coreDepsOf(makeTestDeps({ core: { goals: { max_active: 1 } } }));
  await deps.core.goals.insert({
    title: "Something else",
    why: "x",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: vec(),
  });
  expect(await craftSkill(deps, "still")).toEqual({ goalId: null, skill: 0 });
  expect(await deps.core.goals.byTitle("Get better at making posts")).toBeNull();
});
