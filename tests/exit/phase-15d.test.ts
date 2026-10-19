/**
 * Phase 15d exit, all fake: her plain news reaches people under their things; reach-outs carry
 * their dates and the guard sees now and why; a thread goes out once until they revive it; her
 * own rate moves her readiness; her events, plans and wanderings vary; the night is one block;
 * captions cut at a word and a picture never comes twice; her craft skill is Ethan's to set. A
 * thread's dated notes never reach another user, and a reach-out leaves core unchanged.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import { REACH_OUT_SEND_QUEUE } from "@/mind/platform/jobs";
import { loadPrompt } from "@/mind/platform/prompts";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { browseIfDue } from "@/mind/process/core/browse";
import { craftSkill } from "@/mind/process/core/post-library";
import { cutAtWord } from "@/mind/process/core/post-words";
import { coreReflect } from "@/mind/process/core/reflect";
import { pickCue } from "@/mind/process/core/wander";
import { renderGuardInput } from "@/mind/process/guard/guard";
import { renderReachOut } from "@/mind/process/hot-path/compose";
import { yourDayLines } from "@/mind/process/hot-path/your-day-line";
import { buildCandidates, herThreshold, pickWinner } from "@/mind/process/outreach/candidates";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { outreachTickUser } from "@/mind/process/outreach/tick";
import type { CandidateInputs } from "@/mind/process/outreach/types";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { validatePlan } from "@/mind/world/day-plan";
import { selectEventSubject, subjectKey } from "@/mind/world/events";
import { createWebSources } from "@/runtime/web-sources";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { fakeSources, tmpMediaDir, webItem } from "../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const cfg = config.outreach;
const H = 3_600_000;
const now = new Date("2026-01-12T10:00:00Z");
const empty = (): CandidateInputs => ({
  dueThreads: [],
  makeUp: { due: false, hurt: 0, causeFactId: null, causeText: null, lastHurtAt: null },
  userEvents: [],
  herDay: [],
  coreThoughts: [],
  userIdeas: [],
  checkIn: { lastContact: null, medianGapHours: 24 },
  usedTopics: [],
  depthLimit: 1,
  theirRate: null,
});
const thread = (facts: CandidateInputs["dueThreads"][number]["facts"]) => ({
  id: "t1",
  title: "half marathon",
  detail: null,
  stakes: "med" as const,
  next_checkpoint: now,
  fact_id: null,
  sensitive: false,
  facts,
});

test("1: her plain news beats an idea, never their thread", () => {
  const i = empty();
  i.herDay = [
    {
      id: "m1",
      content: "Spica went to the film club screening of Stalker.",
      salience: 0.4,
      depth: 1,
      sensitive: false,
      at: new Date(now.getTime() - 2 * H),
    },
  ];
  i.userIdeas = [{ id: "i1", content: "ask about the task", salience: 0.5 }];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("her_day");
  i.dueThreads = [thread([])];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("thread");
});

test("2: 'Your day' lists what already happened today", () => {
  expect(yourDayLines([], now, null, ["Spica went to the screening."], "UTC")).toContain(
    "Earlier today: Spica went to the screening.",
  );
});

test("3: the reason carries its dates; the guard sees now and why she's writing", () => {
  const r = renderReachOut(
    loadPrompt("reach-out", config.prompts.reach_out),
    {
      kind: "thread",
      text: "half marathon",
      factId: null,
      threadId: "t1",
      coreMemoryId: null,
      notes: [{ text: "The user runs on Sunday.", at: "2026-01-11T09:00:00.000Z", dated: true }],
    },
    now,
    { hers: "UTC", theirs: "UTC" },
  );
  expect(r.reason).toContain("(Sunday 11 January, yesterday)");
  const g = renderGuardInput({
    kind: "reach_out",
    text: "how did it go?",
    recentTurns: [],
    recalledFacts: [],
    onboardingFacts: [],
    now: "Monday 12 January 2026 at 10:00",
    reachOutReason: r.reason,
  });
  expect(g.startsWith("NOW: ")).toBe(true);
  expect(g).toContain(`WHY SPICA IS WRITING FIRST:\n${r.reason}`);
});

test("4: a thread goes out once until they bring it up again", () => {
  const fact = { id: "f2", content: "x", at: now, dated: false };
  const i = empty();
  i.dueThreads = [thread([fact])];
  const [c] = buildCandidates(i, cfg, now);
  expect(c!.topic).toBe("thread:t1@f2");
  i.usedTopics = [c!.topic];
  expect(buildCandidates(i, cfg, now)[0]!.filtered).toBe("topic_used");
  i.dueThreads = [thread([{ ...fact, id: "f3" }, fact])];
  expect(buildCandidates(i, cfg, now)[0]!.filtered).toBeNull();
  i.dueThreads = [thread([])];
  expect(buildCandidates(i, cfg, now)[0]!.topic).toBe("thread:t1@none");
});

test("5: her rate moves how readily she writes first", () => {
  expect(herThreshold(null, cfg)).toBe(cfg.threshold);
  expect(herThreshold(12, cfg)).toBeCloseTo(cfg.threshold / 2);
  expect(herThreshold(1, cfg)).toBeCloseTo(cfg.threshold * 1.6);
});

test("6: event subjects vary; a plan can't repeat yesterday's", () => {
  const options = { goals: [], interests: [{ id: "i", content: "old films" }], people: ["Alcor"] };
  const days = Array.from({ length: 400 }, (_, d) => `2026-01-05#${d}`);
  const alcor = (recent: string[]) =>
    days.filter(
      (d) =>
        subjectKey(selectEventSubject(options, recent, d, config.core.world)) === "person:Alcor",
    ).length;
  expect(alcor(["person:Alcor"])).toBeLessThan(alcor([]));
  const raw = {
    blocks: [
      { start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
      { start: "09:00", end: "12:00", kind: "busy" as const, busy: 0.8, label: "reading" },
      { start: "22:00", end: "24:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
    ],
  };
  const first = validatePlan(raw, config.life, null);
  expect(first.ok).toBe(true);
  expect(validatePlan(raw, config.life, first.ok ? first.plan : null).ok).toBe(false);
});

test("7: a memory her recent wanderings used is drawn less", () => {
  const item = (id: string): CoreMemoryItem => ({
    id,
    kind: "episode",
    content: id,
    payload: {},
    entity_refs: [],
    occurred_at: now,
    created_at: now,
    last_recalled_at: null,
    status: "resolved",
    salience: 0.5,
    valence: 0,
    depth: 1,
    source: "world",
    source_ref: null,
  });
  const cues = [{ kind: "memory" as const, items: [item("a"), item("b")] }];
  const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
  const picks = (used: string[]) =>
    rolls.filter((r) => pickCue(cues, new Set(used), r, config.core.wander)?.id === "a").length;
  expect(picks(["a"])).toBeLessThan(picks([]));
});

test("8: the night is one quiet block across midnight", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const night = (start: string, end: string) => ({
    start,
    end,
    kind: "quiet" as const,
    busy: 0.9,
    label: "offline",
  });
  const at = new Date("2026-01-05T23:50:00Z");
  for (const [date, block] of [
    ["2026-01-05", night("22:00", "24:00")],
    ["2026-01-06", night("00:00", "07:30")],
  ] as const)
    await insertLifeDay(d.db, {
      date,
      plan: { blocks: [block] },
      source: "scripted",
      model: "none",
      prompt_version: "scripted",
      generated_at: at,
    });
  expect(blockAt(await todaysBlocks(d, at), at)!.end.toISOString()).toBe(
    "2026-01-06T07:30:00.000Z",
  );
});

test("9: captions cut at a word; a repeated picture and a stale weekly feed bring nothing", async () => {
  expect(cutAtWord("like they were trying to catch it", 26)).toBe("like they were trying to");
  const item = await webItem();
  const { sources } = fakeSources({ commons_potd: item });
  const d = makeTestDeps(
    {
      life: { timezone: "UTC" },
      posts: {
        media_dir: tmpMediaDir(),
        sources: [{ name: "commons_potd", weight: 1 }],
        browse_per_day: 2,
      },
    },
    [],
    sources,
  );
  await d.core.world.insertPlan({
    date: "2026-01-05",
    plan: { blocks: [] },
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: new Date("2026-01-05T00:00:00Z"),
  });
  expect(await browseIfDue(coreDepsOf(d), new Date("2026-01-05T08:00:00Z"))).toBe(true);
  item.url = "https://example.org/new-url.jpg";
  expect(await browseIfDue(coreDepsOf(d), new Date("2026-01-05T09:00:00Z"))).toBe(false);
  expect(await d.core.posts.findsOn("2026-01-05")).toBe(1);

  const xml = `<rss><channel><item><title>Old</title><pubDate>Mon, 28 Sep 2026 06:00:00 +0200</pubDate><enclosure url="https://cdn.eso.org/x.jpg"/></item></channel></rss>`;
  const real = createWebSources({
    userAgent: "UA",
    timeoutMs: 1000,
    maxDownloadBytes: 1000,
    weeklyMaxAgeDays: 7,
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(xml)) as typeof fetch;
  try {
    expect(await real.eso_potw!.fetch("2026-10-14")).toBeNull();
  } finally {
    globalThis.fetch = original;
  }
});

test("10: her craft skill is configured, and reflection can't drop the craft goal", async () => {
  const d = makeTestDeps({
    posts: { craft_skill: { still: 0.3 } },
    core: { goals: { min_active: 0 } },
  });
  const core = coreDepsOf(d);
  const { goalId, skill } = await craftSkill(core, "still");
  expect(skill).toBe(0.3);
  await core.core.memory.insert({
    kind: "episode",
    content: "A day.",
    payload: {},
    embedding: vec(),
    entity_refs: [],
    occurred_at: d.clock.now(),
    created_at: d.clock.now(),
    status: "resolved",
    salience: 0.5,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  d.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [], drop: [goalId] },
    narrative: null,
  });
  expect(await coreReflect(core, d.clock.now())).toBe("done");
  expect((await d.core.goals.get(goalId!))?.status).toBe("active");
});

const TOKEN = "CANARY-15d7c2";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("11: leak canary: A's thread notes never reach B's reach-out; a reach-out leaves core unchanged", async () => {
  // A free hour on her UTC clock, no world events, so outreach can schedule.
  const at = new Date("2026-01-05T15:25:00Z");
  const d = makeTestDeps({ life: { timezone: "UTC" }, core: { world: { events_per_day_max: 0 } } });
  d.clock.set(at);
  const setup = async (name: string, factText: string) => {
    const u = await createTestUser(name);
    await ensureRelationship(d.db, u, at, d.config.relationship);
    const t = await insertThread(
      d.db,
      u,
      {
        title: "interview",
        subject: "user",
        stakes: "high",
        next_checkpoint: new Date(at.getTime() - H),
      },
      new Date(at.getTime() - 24 * H),
    );
    await insertFact(d.db, u, {
      subject: "user",
      kind: "event",
      content: factText,
      embedding: vec(),
      created_at: at,
      occurred_at: new Date(at.getTime() - 2 * H),
      status: "open",
      salience: 0.7,
      valence: 0,
      confidence: 1,
      source: "turn",
      thread_id: t.id,
    });
    await insertTurn(d.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "talk later",
      created_at: new Date(at.getTime() - 26 * H),
    });
    return u;
  };
  const a = await setup("alice", `The user's interview code is ${TOKEN}.`);
  const b = await setup("bob", "The user has an interview at Canva.");
  const before = await coreDump();

  const send = async (u: string) => {
    const [replies, structured] = [d.llm.calls.length, d.llm.structuredCalls.length];
    expect(await outreachTickUser(d, u, at)).toBe("scheduled");
    for (const job of d.queue.drain((j) => j.name === REACH_OUT_SEND_QUEUE))
      if (job.name === REACH_OUT_SEND_QUEUE)
        expect(await runReachOutSend(d, job.data)).toBe("sent");
    return [...d.llm.calls.slice(replies), ...d.llm.structuredCalls.slice(structured)];
  };
  const bCalls = await send(b);
  expect(bCalls.length).toBeGreaterThan(0);
  for (const c of bCalls) expect(JSON.stringify(c)).not.toContain(TOKEN);
  // A's own reach-out does carry its dated note, and still moves nothing in core.
  const aCalls = await send(a);
  expect(aCalls.some((c) => JSON.stringify(c).includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);
});
