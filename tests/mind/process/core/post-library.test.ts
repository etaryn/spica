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

test("craft skill: created once from her persona at the configured skill", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const first = await craftSkill(deps, "still");
  expect(first.skill).toBe(0);
  expect(first.goalId).not.toBeNull();
  expect((await craftSkill(deps, "still")).goalId).toBe(first.goalId);
});

test("skill comes from config, and the goal's progress is set to it", async () => {
  const all = makeTestDeps({ posts: { craft_skill: { still: 0.4 } } });
  const { goalId, skill } = await craftSkill(coreDepsOf(all), "still");
  expect(skill).toBe(0.4);
  expect((await all.core.goals.get(goalId!))?.progress).toBe(0.4);
  // Her loops moving it doesn't change her skill: the next read sets it back.
  await all.core.goals.setProgress(goalId!, 0.9, all.clock.now());
  expect((await craftSkill(coreDepsOf(all), "still")).skill).toBe(0.4);
  expect((await all.core.goals.get(goalId!))?.progress).toBe(0.4);
});

test("a dropped craft goal comes back active, even with the active goals full", async () => {
  const deps = coreDepsOf(makeTestDeps({ core: { goals: { max_active: 1 } } }));
  const { goalId } = await craftSkill(deps, "still");
  await deps.core.goals.setStatus(goalId!, "dropped", deps.clock.now());
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
  const back = await craftSkill(deps, "still");
  expect(back.goalId).not.toBeNull();
  expect(back.goalId).not.toBe(goalId);
  expect((await deps.core.goals.get(back.goalId!))?.status).toBe("active");
  expect((await deps.core.goals.byTitle("Get better at making posts"))?.id).toBe(back.goalId);
});
