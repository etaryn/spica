import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  buildCandidates,
  herThreshold,
  holdLastSlot,
  pickWinner,
} from "@/mind/process/outreach/candidates";
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
  theirRate: null,
});

test("nothing eligible → no candidates, no winner", () => {
  expect(buildCandidates(empty(), cfg, now)).toEqual([]);
  expect(pickWinner([])).toBeNull();
});

test("due thread: high/med only, strength by stakes, topic keys on none with no fact about them", () => {
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
      facts: [],
    },
    {
      id: "t2",
      title: "new plant",
      detail: null,
      stakes: "low",
      next_checkpoint: cp,
      fact_id: null,
      sensitive: false,
      facts: [],
    },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({
    kind: "thread",
    topic: "thread:t1@none",
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

test("a thread's dated fact leads its notes and its headline; the topic stays on the newest", () => {
  const i = empty();
  const fact = (id: string, content: string, at: string, dated: boolean) => ({
    id,
    content,
    at: new Date(at),
    dated,
  });
  i.dueThreads = [
    {
      id: "t1",
      title: "half marathon",
      detail: "The user is doom-scrolling about it.",
      stakes: "med",
      next_checkpoint: new Date("2026-01-10T09:00:00Z"),
      fact_id: "f3",
      sensitive: false,
      facts: [
        fact("f3", "The user is doom-scrolling about it.", "2026-01-06T15:00:00Z", false),
        fact("f2", "The user is freaking out a little.", "2026-01-05T14:00:00Z", false),
        fact(
          "f1",
          "The user has a half marathon Sunday 11 January 2026.",
          "2026-01-11T12:00:00Z",
          true,
        ),
      ],
    },
  ];
  const [c] = buildCandidates(i, { ...cfg, reason_facts: 2 }, now);
  expect(c!.topic).toBe("thread:t1@f3");
  expect(c!.text).toBe("half marathon: The user has a half marathon Sunday 11 January 2026.");
  expect(c!.notes.map((n) => n.text)).toEqual([
    "The user has a half marathon Sunday 11 January 2026.",
    "The user is doom-scrolling about it.",
  ]);
});

test("a thread with only undated facts keeps its latest headline and newest-first notes", () => {
  const i = empty();
  const at = (iso: string) => new Date(iso);
  i.dueThreads = [
    {
      id: "t1",
      title: "new job",
      detail: "The user is nervous.",
      stakes: "med",
      next_checkpoint: at("2026-01-10T09:00:00Z"),
      fact_id: "f2",
      sensitive: false,
      facts: [
        { id: "f2", content: "The user is nervous.", at: at("2026-01-06T09:00:00Z"), dated: false },
        {
          id: "f1",
          content: "The user got the job.",
          at: at("2026-01-05T09:00:00Z"),
          dated: false,
        },
      ],
    },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c!.text).toBe("new job (latest: The user is nervous.)");
  expect(c!.notes.map((n) => n.text)).toEqual(["The user is nervous.", "The user got the job."]);
  expect(c!.topic).toBe("thread:t1@f2");
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
    {
      id: "e1",
      content: "The user had a hospital appointment.",
      salience: 0.9,
      sensitive: true,
      occurred_at: null,
    },
    {
      id: "e2",
      content: "The user ran a half marathon.",
      salience: 0.6,
      sensitive: false,
      occurred_at: null,
    },
    {
      id: "e3",
      content: "The user bought socks.",
      salience: 0.1,
      sensitive: false,
      occurred_at: null,
    },
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

test("their things first; within a tier the highest score wins, ties break by kind order", () => {
  const i = empty();
  i.userEvents = [{ id: "u", content: "x", salience: 0.3, sensitive: false, occurred_at: null }]; // 0.8 × 0.3 = 0.24
  i.herDay = [{ id: "s", content: "y", salience: 0.6, depth: 1, sensitive: false, at: now }]; // 1 × 0.6 = 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("user_event");
  i.userEvents = [];
  i.userIdeas = [{ id: "i", content: "z", salience: 1 }]; // 0.6 × 1 = 0.6, a tie
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("her_day");
  i.herDay[0]!.salience = 0.5; // 0.5 < 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("user_idea");
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
      at: now,
    },
  ];
  i.userEvents = [
    { id: "m1", content: "The user ran.", salience: 0.6, sensitive: false, occurred_at: null },
  ];
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
    {
      id: "m1",
      content: "Watched Stalker again.",
      salience: 0.5,
      depth: 1,
      sensitive: false,
      at: now,
    },
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
    {
      id: "m3",
      content: "She cried at the planetarium.",
      salience: 1,
      depth: 2,
      sensitive: false,
      at: now,
    },
  ];
  i.coreThoughts = [{ id: "m4", content: "Alcor might leave.", salience: 1, depth: 3 }];
  const cands = buildCandidates(i, cfg, now);
  expect(cands.map((c) => c.filtered)).toEqual(["too_deep", "too_deep"]);
  expect(pickWinner(cands)).toBeNull();
  i.depthLimit = 3;
  expect(buildCandidates(i, cfg, now).every((c) => c.filtered === null)).toBe(true);
});

test("a thread's topic is keyed on its newest fact about them, and carries dated notes", () => {
  const i = empty();
  const cp = new Date("2026-01-10T09:00:00Z");
  i.dueThreads = [
    {
      id: "t1",
      title: "half marathon",
      detail: null,
      stakes: "med",
      next_checkpoint: cp,
      fact_id: "f9",
      sensitive: false,
      facts: [
        {
          id: "f2",
          content: "The user is running a half marathon on Sunday.",
          at: new Date("2026-01-11T09:00:00Z"),
          dated: true,
        },
        {
          id: "f1",
          content: "The user is training.",
          at: new Date("2026-01-05T10:00:00Z"),
          dated: false,
        },
      ],
    },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c!.topic).toBe("thread:t1@f2");
  expect(c!.notes).toEqual([
    {
      text: "The user is running a half marathon on Sunday.",
      at: "2026-01-11T09:00:00.000Z",
      dated: true,
    },
    { text: "The user is training.", at: "2026-01-05T10:00:00.000Z", dated: false },
  ]);
});

test("a thread with no fact about them keys on none", () => {
  const i = empty();
  i.dueThreads = [
    {
      id: "t1",
      title: "x",
      detail: null,
      stakes: "high",
      next_checkpoint: now,
      fact_id: null,
      sensitive: false,
      facts: [],
    },
  ];
  expect(buildCandidates(i, cfg, now)[0]!.topic).toBe("thread:t1@none");
});

test("a user event carries its date", () => {
  const i = empty();
  i.userEvents = [
    {
      id: "f1",
      content: "Sister visits.",
      salience: 0.6,
      sensitive: false,
      occurred_at: new Date("2026-01-09T12:00:00Z"),
    },
  ];
  expect(buildCandidates(i, cfg, now)[0]!.notes).toEqual([
    { text: "Sister visits.", at: "2026-01-09T12:00:00.000Z", dated: true },
  ]);
});

test("her news beats an idea but never their thread", () => {
  const i = empty();
  i.depthLimit = 1;
  i.herDay = [
    {
      id: "m1",
      content: "Spica went to the film club screening of Stalker.",
      salience: 0.4,
      depth: 1,
      sensitive: false,
      at: new Date("2026-01-10T11:00:00Z"),
    },
  ];
  i.userIdeas = [{ id: "i1", content: "ask about the task", salience: 0.5 }];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("her_day");
  i.dueThreads = [
    {
      id: "t1",
      title: "x",
      detail: null,
      stakes: "med",
      next_checkpoint: now,
      fact_id: null,
      sensitive: false,
      facts: [],
    },
  ];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("thread");
});

test("her rate scales the bar: none before an estimate, lower for a chatty friend, higher for a quiet one", () => {
  expect(herThreshold(null, cfg)).toBe(cfg.threshold);
  // default 4, halfway to 12 → 8 → bar / 2
  expect(herThreshold(12, cfg)).toBeCloseTo(cfg.threshold / 2);
  // halfway to 1 → 2.5 → bar × 1.6
  expect(herThreshold(1, cfg)).toBeCloseTo(cfg.threshold * 1.6);
  // clamped at ×2
  expect(herThreshold(0, cfg)).toBeCloseTo(cfg.threshold * 2);
});

test("a quiet friend's raised bar filters a candidate the default bar lets through", () => {
  const i = empty();
  i.userIdeas = [{ id: "i", content: "z", salience: 0.5 }]; // 0.6 × 0.5 = 0.3
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("user_idea");
  i.theirRate = 0; // bar × 2 = 0.4
  expect(buildCandidates(i, cfg, now)[0]!.filtered).toBe("below_threshold");
});

test("with one weekly slot left her own news is held; their things and ideas still win", () => {
  const i = empty();
  i.herDay = [
    { id: "h1", content: "Spica found Orion.", salience: 0.6, depth: 1, sensitive: false, at: now },
  ];
  i.userIdeas = [{ id: "u1", content: "ask about the studio", salience: 0.5 }];
  const all = buildCandidates(i, cfg, now);
  const held = holdLastSlot(all, cfg.cap_per_week - 1, cfg);
  expect(held.find((c) => c.kind === "her_day")!.filtered).toBe("last_slot");
  expect(pickWinner(held)!.kind).toBe("user_idea");
  // Two slots left: nothing held.
  expect(holdLastSlot(all, cfg.cap_per_week - 2, cfg)).toEqual(all);
  // A cap of one: her news never sends, theirs still can.
  expect(pickWinner(holdLastSlot(all, 0, { ...cfg, cap_per_week: 1 }))!.kind).toBe("user_idea");
});

test("an already-filtered candidate keeps its reason", () => {
  const i = empty();
  i.herDay = [
    { id: "h1", content: "Spica found Orion.", salience: 0.6, depth: 3, sensitive: false, at: now },
  ];
  i.depthLimit = 1;
  const held = holdLastSlot(buildCandidates(i, cfg, now), cfg.cap_per_week - 1, cfg);
  expect(held[0]!.filtered).toBe("too_deep");
});
