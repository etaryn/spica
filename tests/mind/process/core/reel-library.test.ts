/** Reel formats and the clip manifest: a format asking for what she can't render is skipped. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { eligibleFormats, loadManifest, loadReelFormats } from "@/mind/process/core/reel-library";

const manifest = loadManifest("assets/reels/clips.json");
const drift = JSON.parse(readFileSync("formats/reels/drift.json", "utf8"));

function logs() {
  const lines: { msg: string; meta?: object }[] = [];
  const log = {
    info: (msg: string, meta?: object) => lines.push({ msg, meta }),
    error: (msg: string, meta?: object) => lines.push({ msg, meta }),
  };
  return { log: log as never, lines };
}

test("the manifest and the shipped reel format load, eligible at skill 0", () => {
  expect(manifest.clips.map((c) => c.name)).toContain("walk");
  const { log, lines } = logs();
  const formats = loadReelFormats("formats/reels", manifest, 360, log);
  expect(formats.map((f) => f.name)).toEqual(["drift"]);
  expect(lines).toEqual([]);
  expect(eligibleFormats(formats, 0)).toHaveLength(1);
  // Only reviewed formats her skill has reached.
  expect(eligibleFormats([{ ...formats[0]!, min_skill: 0.5 }], 0.4)).toEqual([]);
  expect(eligibleFormats([{ ...formats[0]!, reviewed: false }], 1)).toEqual([]);
});

test.each([
  ["an unknown tag", (f: typeof drift) => (f.shots[0].tags = ["dancing"])],
  ["an unknown face", (f: typeof drift) => (f.faces.warm = ["grin"])],
  ["an unknown framing", (f: typeof drift) => (f.shots[0].framing = "wide")],
  ["too many frames", (f: typeof drift) => (f.shots[0].frames = [300, 300])],
])("a format with %s is skipped and logged", (_, spoil) => {
  const dir = mkdtempSync(path.join(tmpdir(), "reels-"));
  const bad = structuredClone(drift);
  spoil(bad);
  writeFileSync(path.join(dir, "drift.json"), JSON.stringify(bad));
  const { log, lines } = logs();
  expect(loadReelFormats(dir, manifest, 360, log)).toEqual([]);
  expect(lines.map((l) => l.msg)).toEqual(["format skipped"]);
});
