import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { buildCandidates, pickWinner } from "@/core/outreach/candidates";
import type { CandidateInputs } from "@/core/outreach/types";

const cfg = loadConfig().outreach;
const now = new Date("2026-01-10T12:00:00Z");
const H = 3_600_000;
const empty = (): CandidateInputs => ({
  dueThreads: [], makeUp: { due: false, hurt: 0, causeFactId: null, causeText: null, lastHurtAt: null },
  userEvents: [], herDay: [], checkIn: { lastContact: null, medianGapHours: 24 }, usedTopics: [],
});

test("nothing eligible → no candidates, no winner", () => {
  expect(buildCandidates(empty(), cfg, now)).toEqual([]);
  expect(pickWinner([])).toBeNull();
});

test("due thread: high/med only, strength by stakes, topic includes the checkpoint", () => {
  const i = empty();
  const cp = new Date("2026-01-10T09:00:00Z");
  i.dueThreads = [
    { id: "t1", title: "interview at Canva", detail: "went in nervous", stakes: "high", next_checkpoint: cp, fact_id: "f1", sensitive: false },
    { id: "t2", title: "new plant", detail: null, stakes: "low", next_checkpoint: cp, fact_id: null, sensitive: false },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({ kind: "thread", topic: `thread:t1@${cp.toISOString()}`, strength: 1, score: 1, factId: "f1", threadId: "t1", filtered: null });
  expect(c!.text).toContain("interview at Canva");
  expect(buildCandidates(i, cfg, now)).toHaveLength(1); // the low-stakes thread never becomes a candidate
});

test("make-up: strength is current hurt; topic keyed by cause fact, else by last_hurt_at", () => {
  const i = empty();
  i.makeUp = { due: true, hurt: 0.4, causeFactId: "h1", causeText: "They called her useless.", lastHurtAt: new Date(now.getTime() - 2 * H) };
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({ kind: "make_up", topic: "make_up:h1", strength: 0.4 });
  expect(c!.score).toBeCloseTo(0.9 * 0.4);
  i.makeUp.causeFactId = null;
  expect(buildCandidates(i, cfg, now)[0]!.topic).toBe(`make_up:${i.makeUp.lastHurtAt!.toISOString()}`);
  i.makeUp.due = false;
  expect(buildCandidates(i, cfg, now)).toEqual([]);
});

test("check-in: eligible only past gap_factor × median gap; strength grows with the gap", () => {
  const i = empty();
  i.checkIn = { lastContact: new Date(now.getTime() - 47 * H), medianGapHours: 24 };
  expect(buildCandidates(i, cfg, now)).toEqual([]);
  i.checkIn.lastContact = new Date(now.getTime() - 48 * H);
  const [c] = buildCandidates(i, cfg, now);
  expect(c).toMatchObject({ kind: "check_in", topic: `check_in:${i.checkIn.lastContact.toISOString()}`, strength: 0.5 });
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
  expect(Object.fromEntries(cands.map((c) => [c.factId, c.filtered]))).toEqual({ e1: "sensitive", e2: "topic_used", e3: "below_threshold" });
  expect(pickWinner(cands)).toBeNull();
});

test("winner is the highest score; ties break by kind order, then topic", () => {
  const i = empty();
  i.userEvents = [{ id: "u", content: "x", salience: 0.75, sensitive: false }]; // 0.8 × 0.75 = 0.6
  i.herDay = [{ id: "s", content: "y", salience: 1, sensitive: false }];      // 0.6 × 1   = 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("user_event");
  i.herDay[0]!.salience = 1; i.userEvents[0]!.salience = 0.5;                  // 0.4 < 0.6
  expect(pickWinner(buildCandidates(i, cfg, now))?.kind).toBe("her_day");
});

test("the same fact in user events and her day is one candidate (first kind wins)", () => {
  const i = empty();
  i.herDay = [{ id: "p", content: "z", salience: 0.5, sensitive: false }, { id: "p", content: "z", salience: 0.5, sensitive: false }];
  expect(buildCandidates(i, cfg, now)).toHaveLength(1);
});

test("a fact behind a due thread is not also a user_event candidate (R2)", () => {
  const i = empty();
  const cp = new Date("2026-01-10T09:00:00Z");
  i.dueThreads = [{ id: "t1", title: "interview", detail: null, stakes: "high", next_checkpoint: cp, fact_id: "f1", sensitive: false }];
  i.userEvents = [{ id: "f1", content: "The user had an interview.", salience: 0.7, sensitive: false }];
  i.usedTopics = [`thread:t1@${cp.toISOString()}`]; // even once the thread topic is used
  const cands = buildCandidates(i, cfg, now);
  expect(cands.map((c) => c.kind)).toEqual(["thread"]);
  expect(pickWinner(cands)).toBeNull();
});
