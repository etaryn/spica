import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { depthFor, levelFor } from "@/mind/state/user/relationship/depth";

const cfg = loadConfig().relationship;
const base = {
  closeness: 0.2,
  userDisclosure: 0.5,
  recentDepths: [] as number[],
  herDisclosure: 0.4,
  session: null,
  reachOut: false,
};
const deep = {
  id: "s",
  started_at: "",
  last_at: "",
  hours: 1,
  tone_sum: 0,
  tone_n: 0,
  moment_sum: 0,
  moment_n: 0,
  deep_fired: true,
};

test("closeness bands set the usual limit", () => {
  expect(depthFor(base, cfg)).toEqual({ open: 1, peek: 1 });
  expect(depthFor({ ...base, closeness: cfg.depth.bands.personal }, cfg).open).toBe(2);
  expect(depthFor({ ...base, closeness: cfg.depth.bands.intimate }, cfg).open).toBe(3);
});

test("out-sharing them drops a tier, never below 1", () => {
  const close = { ...base, closeness: 0.7, userDisclosure: 0.1, recentDepths: [3, 3, 3] };
  expect(depthFor(close, cfg).open).toBe(2);
  expect(depthFor({ ...close, closeness: 0.1 }, cfg).open).toBe(1);
  expect(depthFor({ ...close, userDisclosure: 0.9 }, cfg).open).toBe(3);
});

test("high openness or a deep session stretches one tier as a peek; a reach-out never does", () => {
  expect(depthFor({ ...base, herDisclosure: cfg.openness.bands.high }, cfg)).toEqual({
    open: 1,
    peek: 2,
  });
  expect(depthFor({ ...base, session: deep }, cfg).peek).toBe(2);
  const moments = { ...deep, deep_fired: false, moment_sum: 1, moment_n: 1 };
  expect(depthFor({ ...base, session: moments }, cfg).peek).toBe(2);
  expect(depthFor({ ...base, herDisclosure: 1, session: deep, reachOut: true }, cfg)).toEqual({
    open: 1,
    peek: 1,
  });
  expect(depthFor({ ...base, closeness: 0.9, herDisclosure: 1 }, cfg)).toEqual({
    open: 3,
    peek: 3,
  });
});

test("level: within the limit is open; above it is a peek until it was hinted before", () => {
  expect(levelFor(1, 1, undefined)).toBe("open");
  expect(levelFor(2, 1, undefined)).toBe("peek");
  expect(levelFor(2, 1, "peek")).toBe("open");
  expect(levelFor(3, 1, "open")).toBe("open");
});
