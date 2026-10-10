import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { buildCandidates, pickWinner } from "@/mind/process/outreach/candidates";
import type { CandidateInputs } from "@/mind/process/outreach/types";

const cfg = loadConfig().outreach;
const now = new Date("2026-01-10T12:00:00Z");
const H = 3_600_000;
const empty = (): CandidateInputs => ({
  dueThreads: [],
  makeUp: { due: false, hurt: 0, causeFactId: null, causeText: null, lastHurtAt: null },
  userEvents: [],
  herDay: [],
  coreThoughts: [],
  userIdeas: [],
  checkIn: { lastContact: null, medianGapHours: 24 },
  usedTopics: [],
  depthLimit: 3,
});

test("nothing eligible → no candidates, no winner", () => {
  expect(buildCandidates(empty(), cfg, now)).toEqual([]);
  expect(pickWinner([])).toBeNull();
});

test("due thread: high/med only, strength by stakes, topic includes the checkpoint", () => {
  const i = empty();
  const cp = new Date("2026-01-10T09:00:00Z");
  i.dueThreads = [
    {
      id: "t1",
      title: "interview at Canva",
      detail: "went in nervous",
      stakes: "high",
      next_checkpoint: cp,
      fact_id: "f1",
      sensitive: false,
    },
    {
      id: "t2",
      title: "new plant",
      detail: null,
      stakes: "low",
      next_checkpoint: cp,
      fact_id: null,
      sensitive: false,
    },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({
    kind: "thread",
    topic: `thread:t1@${cp.toISOString()}`,
    strength: 1,
    score: 1,
    factId: "f1",
    coreMemoryId: null,
    threadId: "t1",
    filtered: null,
  });
  expect(c!.text).toContain("interview at Canva");
  expect(buildCandidates(i, cfg, now)).toHaveLength(1); // the low-stakes thread never becomes a candidate
});

test("make-up: strength is current hurt; topic keyed by cause fact, else by last_hurt_at", () => {
  const i = empty();
  i.makeUp = {
    due: true,
    hurt: 0.4,
    causeFactId: "h1",
    causeText: "They called her useless.",
    lastHurtAt: new Date(now.getTime() - 2 * H),
  };
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({ kind: "make_up", topic: "make_up:h1", strength: 0.4 });
  expect(c!.score).toBeCloseTo(0.9 * 0.4);
  i.makeUp.causeFactId = null;
  expect(buildCandidates(i, cfg, now)[0]!.topic).toBe(
    `make_up:${i.makeUp.lastHurtAt!.toISOString()}`,
  );
  i.makeUp.due = false;
  expect(buildCandidates(i, cfg, now)).toEqual([]);
});

test("check-in: eligible only past gap_factor × median gap; strength grows with the gap", () => {
  const i = empty();
  i.checkIn = { lastContact: new Date(now.getTime() - 47 * H), medianGapHours: 24 };
  expect(buildCandidates(i, cfg, now)).toEqual([]);
  i.checkIn.lastContact = new Date(now.getTime() - 48 * H);
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({
    kind: "check_in",
    topic: `check_in:${i.checkIn.lastContact.toISOString()}`,
    strength: 0.5,
  });
  i.checkIn.lastContact = new Date(now.getTime() - 200 * H);
  expect(buildCandidates(i, cfg, now)[0]!.strength).toBe(1);
});

test("sensitive and used topics are kept but filtered; below threshold is filtered", () => {
  const i = empty();
  i.userEvents = [
    { id: "e1", content: "The user had a hospital appointment.", salience: 0.9, sensitive: true },
    { id: "e2", content: "The user ran a half marathon.", salience: 0.6, sensitive: false },
    { id: "e3", content: "The user bought socks.", salience: 0.1, sensitive: false },
  ];
  i.usedTopics = ["fact:e2"];
  const cands = buildCandidates(i, cfg, now);
  expect(Object.fromEntries(cands.map((c) => [c.factId, c.filtered]))).toEqual({
    e1: "sensitive",
    e2: "topic_used",
    e3: "below_threshold",
  });
  expect(pickWinner(cands)).toBeNull();
});

test("winner is the highest score; ties break by kind order, then topic", () => {
  const i = empty();
  i.userEvents = [{ id: "u", content: "x", salience: 0.75, sensitive: false }]; // 0.8 × 0.75 = 0.6
  i.herDay = [{ id: "s", content: "y", salience: 1, depth: 1, sensitive: false }]; // 0.6 × 1   = 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("user_event");
  i.herDay[0]!.salience = 1;
  i.userEvents[0]!.salience = 0.5; // 0.4 < 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("her_day");
});

test("her day is her own core memory: topic core:<id>, coreMemoryId set, never a fact", () => {
  const i = empty();
  i.herDay = [
    {
      id: "m1",
      content: "Spica got the telescope images.",
      salience: 0.8,
      depth: 1,
      sensitive: false,
    },
  ];
  i.userEvents = [{ id: "m1", content: "The user ran.", salience: 0.6, sensitive: false }];
  const cands = buildCandidates(i, cfg, now);
  expect(cands.find((c) => c.kind === "her_day")).toMatchObject({
    topic: "core:m1",
    coreMemoryId: "m1",
    factId: null,
    threadId: null,
  });
  // A user fact and a core memory never share a topic, even with the same id.
  expect(cands.find((c) => c.kind === "user_event")).toMatchObject({
    topic: "fact:m1",
    factId: "m1",
    coreMemoryId: null,
  });
});

test("user_idea: topic idea:<id>, weighted, fact id set", () => {
  const i = empty();
  i.userIdeas = [{ id: "i1", content: "Ask about the audition.", salience: 0.5 }];
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({
    kind: "user_idea",
    topic: "idea:i1",
    factId: "i1",
    coreMemoryId: null,
    filtered: null,
  });
  expect(c!.score).toBeCloseTo(cfg.weights.user_idea * 0.5);
});

test("core_thought shares her_day's topic, so one memory is offered once", () => {
  const i = empty();
  i.herDay = [
    { id: "m1", content: "Watched Stalker again.", salience: 0.5, depth: 1, sensitive: false },
  ];
  i.coreThoughts = [{ id: "m1", content: "Watched Stalker again.", salience: 0.5, depth: 1 }];
  i.usedTopics = ["core:m1"];
  const cands = buildCandidates(i, cfg, now);
  expect(cands.map((c) => c.kind).sort()).toEqual(["core_thought", "her_day"]);
  expect(cands.every((c) => c.filtered === "topic_used")).toBe(true);
});

test("a medium core thought sits at the threshold; her_day outranks it on ties", () => {
  const i = empty();
  i.coreThoughts = [{ id: "m2", content: "Thinking about tides.", salience: 0.4, depth: 1 }];
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({ kind: "core_thought", topic: "core:m2", coreMemoryId: "m2" });
  expect(c!.score).toBeCloseTo(0.2);
});

test("her own memory deeper than their usual limit is never offered", () => {
  const i = empty();
  i.depthLimit = 1;
  i.herDay = [
    { id: "m3", content: "She cried at the planetarium.", salience: 1, depth: 2, sensitive: false },
  ];
  i.coreThoughts = [{ id: "m4", content: "Alcor might leave.", salience: 1, depth: 3 }];
  const cands = buildCandidates(i, cfg, now);
  expect(cands.map((c) => c.filtered)).toEqual(["too_deep", "too_deep"]);
  expect(pickWinner(cands)).toBeNull();
  i.depthLimit = 3;
  expect(buildCandidates(i, cfg, now).every((c) => c.filtered === null)).toBe(true);
});
