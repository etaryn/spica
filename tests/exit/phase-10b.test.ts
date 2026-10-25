/**
 * Phase 10b exit, all fake: her self is tiered by depth and each person hears only what their
 * closeness, their openness and the moment allow; a deep moment draws out a hint that a later
 * conversation can turn into the story; something she isn't ready to share is held back once;
 * the ledger records what she actually told them; common ground marks what each side knows; a
 * crisis records nothing; nothing reaches core or another user.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertDisclosures } from "@/db/repos/user/disclosure";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import type { SafetyFlag } from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReachOut, composeReply } from "@/mind/process/hot-path/compose";
import { buildCandidates } from "@/mind/process/outreach/candidates";
import { loadCandidateInputs } from "@/mind/process/outreach/inputs";
import { closeTestDb, createTestUser, getTestDb, resetDb, seedStageFor } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { newMessages, scriptedLabels } from "@/mind/platform/llm/fake-labels";

beforeEach(resetDb);
afterAll(closeTestDb);

const MEM = {
  1: "Spica rewatched Paper Moon.",
  2: "Spica is worried her film notes are going nowhere.",
  3: "Spica is scared Alcor will outgrow her.",
} as const;
const CRISIS: SafetyFlag = { flagged: true, category: "self_harm", source: "classifier" };
const HINT = "(only hint at this)";

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`),
    );
    parts.push(...res.rows.map((r) => String(r.j)).sort());
  }
  return parts.join("\n");
}

type D = ReturnType<typeof makeTestDeps>;

/** Her three memories, one per tier, and what she says next (her claim, read by extraction). */
async function setup() {
  const d = makeTestDeps({
    retrieval: { core_top_n: 12 },
    relationship: { depth: { held_back_similarity: 0.99 } },
  });
  const ids: Record<1 | 2 | 3, string> = { 1: "", 2: "", 3: "" };
  for (const depth of [1, 2, 3] as const) {
    const [embedding] = await d.embedder.embed([MEM[depth]], "document");
    ids[depth] = await d.core.memory.insert({
      kind: "episode",
      content: MEM[depth],
      embedding: embedding!,
      occurred_at: d.clock.now(),
      created_at: d.clock.now(),
      status: "resolved",
      salience: 0.5,
      valence: 0,
      confidence: 1,
      source: "world",
      source_ref: null,
      depth,
    });
  }
  const said = { claim: null as string | null };
  // Her claim is her reply, labelled with the memory it tells. A fake embedding only matches the
  // same text, so the claim grounds on that memory by script.
  Object.assign(
    d.llm.handlers,
    scriptedLabels((input) => {
      const hers = newMessages(input).find((m) => m.speaker === "spica");
      return {
        memories:
          said.claim && hers
            ? [{ said: hers.text, label: said.claim, salience: 0.5, claim_kind: "life" }]
            : [],
      };
    }),
  );
  d.core.memory.groundingMatch = async () => {
    const depth = ([1, 2, 3] as const).find((k) => MEM[k] === said.claim);
    return depth
      ? { similarity: 1, ref: { kind: "memory" as const, id: ids[depth]!, depth } }
      : { similarity: 0, ref: null };
  };
  return { d, ids, said };
}

async function user(d: D, params: Record<string, number> = {}, session?: object) {
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (const [name, value] of Object.entries(params))
    await d.db.execute(
      sql`UPDATE relationship_param SET value = ${value} WHERE user_id = ${u} AND name = ${name}`,
    );
  await seedStageFor(d.db, u, params.closeness ?? 0);
  if (session)
    await d.db.execute(
      sql`UPDATE relationship SET session = ${JSON.stringify(session)}::jsonb WHERE user_id = ${u}`,
    );
  return u;
}

const deepSession = (id: string, d: D) => ({
  id,
  started_at: d.clock.now().toISOString(),
  last_at: d.clock.now().toISOString(),
  hours: 1,
  tone_sum: 0,
  tone_n: 0,
  moment_sum: 0,
  moment_n: 0,
  deep_fired: true,
});

/** One user message and her reply, stored as the hot path's callers store it. */
async function talk(
  d: D,
  u: string,
  text: string,
  session: string,
  flag: SafetyFlag | null = null,
) {
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  const r = await composeReply(d, u, { turns: [ut], openQuestions: [], flag });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: r.text,
    created_at: d.clock.now(),
    reply_to: ut.id,
    openness: r.openness,
    depth: r.depth,
  });
  return { r, system: d.llm.calls.at(-1)!.system, ut, ct };
}

/** The cold path for that exchange, with her claim being `claim`. */
async function say(
  d: D,
  said: { claim: string | null },
  u: string,
  ex: { ut: { id: string }; ct: { id: string } },
  claim: string,
) {
  said.claim = claim;
  await runColdPath(d, {
    userId: u,
    turnIds: [ex.ut.id, ex.ct.id],
    replyTurnId: ex.ct.id,
    recalled: [],
  });
  said.claim = null;
}

const ledger = (u: string) =>
  getTestDb()
    .select()
    .from(s.disclosure)
    .where(eq(s.disclosure.user_id, u))
    .orderBy(s.disclosure.created_at);

/** The line for `content`, under `section` when given: her told facts repeat her memories' text. */
const line = (system: string, content: string, section?: string) =>
  (section ? (system.split(`### ${section}`)[1] ?? "") : system)
    .split("\n")
    .find((l) => l.startsWith(`- ${content}`)) ?? null;
const OWN = "From your own life";

test("a stranger hears only her surface; a close friend hears her deepest", async () => {
  const { d } = await setup();
  const stranger = await user(d);
  const a = await talk(d, stranger, "hey", randomUUID());
  expect(a.r.depth).toEqual({ open: 1, peek: 1, held_back: null });
  expect(a.system).toContain(MEM[1]);
  expect(a.system).not.toContain(MEM[2]);
  expect(a.system).not.toContain(MEM[3]);

  const close = await user(d, { closeness: 0.7, user_disclosure: 0.8 });
  const b = await talk(d, close, "hey", randomUUID());
  expect(b.r.depth.open).toBe(3);
  expect(line(b.system, MEM[3])).not.toContain(HINT);
});

test("a deep moment draws out a hint; told again later, the glimpse becomes the story", async () => {
  const { d, ids, said } = await setup();
  const session = randomUUID();
  // They open up too, so reciprocity never holds her back here.
  const u = await user(d, { closeness: 0.45, user_disclosure: 0.8 }, deepSession(session, d));

  const first = await talk(d, u, "do you ever feel left behind?", session);
  expect(first.r.depth).toMatchObject({ open: 2, peek: 3 });
  expect(line(first.system, MEM[3], OWN)).toContain(HINT);
  await say(d, said, u, first, MEM[3]);
  expect((await ledger(u)).map((r) => [r.ref_id, r.depth, r.level])).toEqual([[ids[3], 3, "peek"]]);

  const second = await talk(d, u, "you said something about alcor", session);
  expect(line(second.system, MEM[3], OWN)).toContain("(you've hinted at this before)");
  expect(line(second.system, MEM[3], OWN)).not.toContain(HINT);
  await say(d, said, u, second, MEM[3]);
  expect((await ledger(u)).map((r) => r.level)).toEqual(["peek", "open"]);

  const third = await talk(d, u, "thanks for telling me", session);
  expect(line(third.system, MEM[3], OWN)).toContain("(they already know this)");
});

test("when she has shared far more than they have, she holds back a tier", async () => {
  const { d, ids } = await setup();
  const u = await user(d, { closeness: 0.45, user_disclosure: 0 });
  const rows = [0, 1, 2].map((i) => ({
    ref_kind: "memory" as const,
    ref_id: ids[3],
    depth: 3,
    level: "open" as const,
    fact_id: null,
    turn_id: null,
    created_at: new Date(d.clock.now().getTime() - (i + 1) * 60_000),
  }));
  await insertDisclosures(d.db, u, rows);
  const r = await talk(d, u, "hey", randomUUID());
  expect(r.r.depth.open).toBe(1);
  expect(r.system).not.toContain(MEM[2]);
});

test("a strong match she can't share is held back, once per conversation", async () => {
  const { d, ids } = await setup();
  const u = await user(d);
  const session = randomUUID();
  const first = await talk(d, u, MEM[3], session);
  expect(first.r.depth.held_back).toBe(ids[3]);
  expect(first.system).toContain("## Not ready to share");
  expect(first.system).not.toContain(MEM[3].slice(0, -1) + ". (");
  const second = await talk(d, u, MEM[3], session);
  expect(second.r.depth.held_back).toBeNull();
  expect(second.system).not.toContain("## Not ready to share");
});

test("writing first to a stranger never carries anything deep", async () => {
  const { d, ids } = await setup();
  const u = await user(d);
  const { ut } = await talk(d, u, "hey", randomUUID());
  const r = await composeReachOut(
    d,
    u,
    { kind: "her_day", text: MEM[1], factId: null, threadId: null, coreMemoryId: ids[1] },
    [ut],
  );
  expect(r.depth.peek).toBe(1);
  expect(d.llm.calls.at(-1)!.system).not.toContain(MEM[3]);
  const cands = buildCandidates(
    await loadCandidateInputs(d, u, d.clock.now()),
    d.config.outreach,
    d.clock.now(),
  );
  const filtered = Object.fromEntries(
    cands.filter((c) => c.kind === "her_day").map((c) => [c.coreMemoryId, c.filtered]),
  );
  expect(filtered[ids[3]]).toBe("too_deep");
  expect(filtered[ids[2]]).toBe("too_deep");
  expect(filtered[ids[1]]).not.toBe("too_deep");
});

test("common ground: their onboarding answers and her own guesses are marked as such", async () => {
  const { d } = await setup();
  const u = await user(d);
  const base = {
    subject: "user" as const,
    created_at: d.clock.now(),
    status: "open" as const,
    valence: 0,
    confidence: 0.9,
    salience: 0.9,
  };
  for (const [content, kind, source] of [
    ["They hate mornings.", "preference", "onboarding"],
    ["They seem lonely since the move.", "reflection", "generated"],
  ] as const) {
    const [embedding] = await d.embedder.embed([content], "document");
    await insertFact(d.db, u, { ...base, content, kind, source, embedding: embedding! });
  }
  const r = await talk(d, u, "hey", randomUUID());
  expect(line(r.system, "They hate mornings.")).toContain(
    "(from their profile card, a first impression)",
  );
  expect(line(r.system, "They seem lonely since the move.")).toContain(
    "(your own guess, they never said this)",
  );
});

test("a crisis records nothing in the ledger and stays on the surface", async () => {
  const { d, said } = await setup();
  const u = await user(d, { closeness: 0.7 });
  const ex = await talk(d, u, "i want to die", randomUUID(), CRISIS);
  expect(ex.r.depth).toEqual({ open: 1, peek: 1, held_back: null });
  await say(d, said, u, ex, MEM[1]);
  expect(await ledger(u)).toEqual([]);
});

test("one user's ledger never reaches core or another user", async () => {
  const { d, said } = await setup();
  const alice = await user(d, { closeness: 0.7, user_disclosure: 0.8 });
  const bob = await user(d);
  const bobSession = randomUUID();
  const before = await talk(d, bob, "hey", bobSession);
  const core = await coreDump();

  const aliceSession = randomUUID();
  const ex = await talk(d, alice, "tell me something real", aliceSession);
  await insertFact(d.db, alice, {
    subject: "user",
    kind: "event",
    content: "CANARY-d4e5 Alice's secret.",
    embedding: (await d.embedder.embed(["CANARY-d4e5"], "document"))[0]!,
    created_at: d.clock.now(),
    status: "open",
    valence: 0,
    confidence: 1,
    salience: 0.9,
    source: "turn",
  });
  await say(d, said, alice, ex, MEM[3]);
  expect((await ledger(alice)).length).toBe(1);

  expect(await coreDump()).toBe(core);
  const after = await talk(d, bob, "hey again", bobSession);
  expect(after.r.depth).toEqual(before.r.depth);
  expect(after.system).not.toMatch(/CANARY-/);
  expect(await ledger(bob)).toEqual([]);
  const bobRows = await getTestDb()
    .select()
    .from(s.disclosure)
    .where(and(eq(s.disclosure.user_id, bob)));
  expect(bobRows).toEqual([]);
});
