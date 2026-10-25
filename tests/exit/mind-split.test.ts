/**
 * The mind split's exit run, all fake. Two users over three of her days, with every hourly world
 * job, replies, the cold path and a reach-out. A canary in user A's data (a fact, and the cause of
 * a hurt in A's relationship) must never reach the core or user B; A's emotional exchange must
 * leave core state and her core loops' traces untouched; her events happen once for both; every
 * reply reads her latest snapshot, which her nights advance past v0. Her telescope event is planned: the plan is on her mind from the day's
 * generation, and the episode exists only once its time has come.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  core_loop_trace,
  core_memory,
  core_snapshot,
  core_state,
  session_log,
  world_event,
} from "@/db/schema";
import { insertTurn } from "@/db/repos/user/session-log";
import { ensureRelationship, getParams } from "@/db/repos/user/relationship";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import { keywordClassifier } from "@/mind/platform/llm/fake";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { runScript, type RunOptions } from "../../evals/lib/runner";
import { ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, createTestUser, getTestDb, resetDb, testDbUrl, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

afterAll(closeTestDb);
const TOKEN = "CANARY-7f3a91";
const config = loadConfig({ life: { timezone: "UTC" } });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CORE_PURPOSES = new Set([
  "life_plan",
  "life_event",
  "core_appraise",
  "core_resolve",
  "core_anticipate",
  "core_ruminate",
  "core_wander",
  "core_reflect",
  "core_consolidate",
  "core_render_snapshot",
  "core_drift_watch",
]);
// Three nights give no week of episodes to gist, so consolidation makes no call here; it stays in
// the probe so a future call is still covered.
const MAY_NOT_RUN = new Set(["core_consolidate"]);
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
const BOB_TABLES = [
  "fact",
  "entity",
  "thread",
  "session_log",
  "conversation_state",
  "judge_log",
  "retrieval_trace",
  "relationship_param",
  "relationship_event",
  "reach_out_log",
  "user_mind_run",
  "user_loop_trace",
];

function script(aText: string) {
  return ScriptSchema.parse({
    name: "mind-split-exit",
    profile: "none",
    config: {
      life: { timezone: "UTC" },
      core: { world: { event_probability: 1, events_per_day_max: 1 } },
    },
    // Friends, so her personal-tier episodes are theirs to hear about.
    relationship_seed: { closeness: 0.45 },
    life: {
      plan: "model",
      inject: [
        {
          day: 1,
          content: "Spica finally got the telescope images.",
          valence: 0.8,
          kind: "planned",
          thought: "Spica is counting the hours until the telescope images come in.",
          fallthrough: true,
        },
      ],
      until: "day 3 20:00",
    },
    outreach: { user_replies: "never" },
    sessions: [
      { at: "day 0 09:00", user: "alice", turns: [aText] },
      { at: "+10m", user: "bob", turns: ["BOB-SAYS hey, how's your week?"] },
      { at: "day 2 09:00", user: "alice", turns: ["ALICE-SAYS anything new with you?"] },
      { at: "+10m", user: "bob", turns: ["BOB-SAYS what have you been up to?"] },
    ],
    // The checks live in this file; the runner needs one assertion to report on.
    assertions: [{ type: "core", world_events: { min: 1 } }],
  });
}

async function run(aText: string) {
  const llm = new CapturingLLM({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  // Bob's first session is a big event too, so he gets a user mind run of his own.
  Object.assign(
    llm.handlers,
    scriptedLabels({
      memories: [{ said: "BOB-SAYS hey", label: "long week", salience: 0.9, valence: 0.2 }],
    }),
  );
  llm.handlers.core_resolve = () => ({
    content: "Spica still got the telescope images, though the observatory closed early.",
    valence: 0.8,
    stakes: "high",
  });
  const opts: RunOptions = {
    db: getTestDb(),
    dbUrl: testDbUrl,
    config,
    makeLlm: () => llm,
    real: false,
    annotate: false,
    turnJudgeReal: false,
  };
  const result = await runScript(script(aText), opts);
  expect(result.status, result.error ?? JSON.stringify(result.assertions)).toBe("pass");
  return llm;
}

async function rowsOf(table: string, where = ""): Promise<string[]> {
  const res = await getTestDb().execute(
    sql.raw(`SELECT row_to_json(x)::text AS j FROM "${table}" x ${where}`),
  );
  return res.rows.map((r) => String(r.j));
}

async function dumpTables(tables: string[]): Promise<string> {
  const parts: string[] = [];
  for (const t of tables) parts.push(...(await rowsOf(t)));
  return parts.join("\n");
}

async function userIdByName(name: string): Promise<string> {
  const res = await getTestDb().execute(sql`SELECT id FROM "user" WHERE name = ${name}`);
  return String(res.rows[0]!.id);
}

describe("leak canary", () => {
  let llm: CapturingLLM;
  beforeAll(async () => {
    llm = await run(`ALICE-SAYS my secret code word is ${TOKEN}, remember it`);
  });

  test("the canary reached user A (so the test can see a leak)", async () => {
    const alice = await userIdByName("alice");
    const facts = await getTestDb().execute(sql`SELECT content FROM fact WHERE user_id = ${alice}`);
    expect(facts.rows.some((r) => String(r.content).includes(TOKEN))).toBe(true);
  });

  test("the canary reached A's relationship: her hurt and its cause", async () => {
    const alice = await userIdByName("alice");
    const cause = await getTestDb().execute(
      sql`SELECT f.content FROM relationship r JOIN fact f ON f.id = r.hurt_cause_fact
          WHERE r.user_id = ${alice}`,
    );
    expect(String(cause.rows[0]?.content ?? "")).toContain(TOKEN);
    const hurt = await getTestDb().execute(
      sql`SELECT count(*)::int AS n FROM relationship_event
          WHERE user_id = ${alice} AND param = 'hurt' AND cause = 'signal'`,
    );
    expect(Number(hurt.rows[0]!.n)).toBeGreaterThan(0);
    // A's next reply carries the hurt line, so the relationship path really feeds a prompt.
    const aliceReply = llm.seen.find(
      (c) => c.kind === "reply" && c.text.includes("ALICE-SAYS anything new"),
    );
    expect(aliceReply?.text).toContain(`the user said "ALICE-SAYS my secret code word is ${TOKEN}`);
  });

  test("no core table holds it", async () => {
    expect(await dumpTables(CORE_TABLES)).not.toMatch(CANARY);
  });

  test("the capturing model echoes a planted token from each new core input into its text output", async () => {
    const probe = new CapturingLLM();
    const plain = `Upcoming plan: ${TOKEN}\nLanded episode: ${TOKEN}\nSeed memory: ${TOKEN}`;
    // Consolidation and snapshot rendering read JSON input.
    const json = JSON.stringify({ previous: TOKEN, sources: [{ content: TOKEN }] });
    const purposes = {
      core_resolve: plain,
      core_anticipate: plain,
      core_ruminate: plain,
      core_wander: plain,
      core_reflect: plain,
      core_consolidate: json,
      core_render_snapshot: json,
      core_drift_watch: plain,
      user_summarise: JSON.stringify({ new_memories: [{ content: TOKEN }], what_happened: [] }),
      user_reflect: JSON.stringify({ new_memories: [{ content: TOKEN }] }),
      user_ideate: JSON.stringify({ new_memories: [{ content: TOKEN }] }),
    };
    const outputs = await Promise.all(
      Object.entries(purposes).map(([purpose, input]) =>
        probe.classifyJson({
          purpose,
          model: "core",
          system: "probe",
          input,
          schema: z.unknown(),
          timeoutMs: 1000,
          maxTokens: 512,
        }),
      ),
    );
    const [
      resolve,
      anticipate,
      ruminate,
      wander,
      reflect,
      consolidate,
      render,
      drift,
      summary,
      userReflect,
      userIdea,
    ] = outputs as [
      { content: string },
      { thought: { content: string } },
      { thought: { content: string } },
      { items: { content: string }[] },
      { narrative: string | null },
      { gist: string },
      { Lately: string[] },
      { findings: { excerpt: string }[] },
      { how_i_feel: string },
      { reflection: string | null },
      { idea: string | null },
    ];
    expect(resolve.content).toContain(TOKEN);
    expect(anticipate.thought.content).toContain(TOKEN);
    expect(ruminate.thought.content).toContain(TOKEN);
    expect(wander.items[0]!.content).toContain(TOKEN);
    expect(reflect.narrative).toContain(TOKEN);
    expect(consolidate.gist).toContain(TOKEN);
    expect(render.Lately[0]).toContain(TOKEN);
    expect(drift.findings[0]!.excerpt).toContain(TOKEN);
    expect(summary.how_i_feel).toContain(TOKEN);
    expect(userReflect.reflection).toContain(TOKEN);
    expect(userIdea.idea).toContain(TOKEN);
  });

  test("user mind runs stay in their own user's scope", async () => {
    for (const purpose of ["user_summarise", "user_reflect", "user_model", "user_ideate"]) {
      const calls = llm.seen.filter((c) => c.purpose === purpose);
      const alice = calls.filter((c) => c.text.includes(TOKEN));
      // Bob's calls are picked by his own memory, so a leak into them can't hide in Alice's group.
      // The loops read JSON, so the quote in his memory's line arrives escaped.
      const bob = calls.filter((c) => c.text.includes('long week — the user said \\"BOB-SAYS hey'));
      expect(alice.length, purpose).toBeGreaterThan(0);
      expect(bob.length, purpose).toBeGreaterThan(0);
      for (const c of bob) expect(c.text, purpose).not.toMatch(CANARY);
    }
    // Alice's user mind writing carries the canary (the echo works), and it is hers alone.
    const aliceId = await userIdByName("alice");
    const res = await getTestDb().execute(
      sql`SELECT user_id, kind, content FROM fact WHERE kind IN ('summary', 'reflection', 'idea', 'model', 'belief', 'episode')`,
    );
    const leaked = res.rows.filter((r) => String(r.content).includes(TOKEN));
    // Three days give no old week to gist, so no episode carries it here; the two-week exit covers that.
    expect(new Set(leaked.map((r) => String(r.kind)))).toEqual(
      new Set(["summary", "reflection", "idea", "model", "belief"]),
    );
    for (const r of leaked) expect(String(r.user_id)).toBe(aliceId);
  });

  test("no core prompt saw it", () => {
    const corePrompts = llm.seen.filter(
      (c) =>
        CORE_PURPOSES.has(c.purpose) || (c.purpose === "reconcile" && c.text.includes("(episode)")),
    );
    expect(corePrompts.length).toBeGreaterThan(0);
    // Each core generator ran, so none of these checks passes vacuously.
    for (const purpose of [...CORE_PURPOSES].filter((p) => !MAY_NOT_RUN.has(p)))
      expect(
        corePrompts.some((c) => c.purpose === purpose),
        purpose,
      ).toBe(true);
    for (const c of corePrompts) expect(c.text).not.toMatch(CANARY);
  });

  test("none of user B's prompts or stored data saw it", async () => {
    const bobPrompts = llm.seen.filter((c) => c.text.includes("BOB-SAYS"));
    expect(bobPrompts.length).toBeGreaterThan(0);
    for (const c of bobPrompts) expect(c.text).not.toMatch(CANARY);

    const bob = await userIdByName("bob");
    // A reach-out to B is one of the paths a leak could take, so it must have run.
    const reachOuts = await getTestDb().execute(
      sql`SELECT count(*)::int AS n FROM session_log WHERE user_id = ${bob} AND trigger = 'reach_out'`,
    );
    expect(Number(reachOuts.rows[0]!.n)).toBeGreaterThan(0);
    for (const table of BOB_TABLES) {
      for (const row of await rowsOf(table, `WHERE user_id = '${bob}'`))
        expect(row, table).not.toMatch(CANARY);
    }
  });

  test("her events happened once, and both users' replies could draw on them", async () => {
    const days = await getTestDb().execute(
      sql`SELECT life_day, count(*)::int AS n FROM world_event
          WHERE plan_ref IS NULL GROUP BY life_day`,
    );
    expect(days.rows.length).toBeGreaterThan(0);
    for (const r of days.rows) expect(Number(r.n)).toBeLessThanOrEqual(1);
    // Either form of the event: as planned, or as the day resolved it. Which one ranks first in
    // retrieval follows the wording of her earlier replies.
    const event = "got the telescope images";
    const replyPrompts = (needle: string) =>
      llm.seen.filter((c) => c.kind === "reply" && c.text.includes(needle));
    const alicePrompts = replyPrompts("ALICE-SAYS anything new");
    const bobPrompts = replyPrompts("BOB-SAYS what have you");
    expect(alicePrompts.length).toBeGreaterThan(0);
    expect(bobPrompts.length).toBeGreaterThan(0);
    expect(alicePrompts.some((c) => c.text.includes(event))).toBe(true);
    expect(bobPrompts.some((c) => c.text.includes(event))).toBe(true);
  });

  test("the plan was on her mind before it happened; the episode only exists from its time", async () => {
    const intentions = await getTestDb().execute(
      sql`SELECT content, status, created_at FROM core_memory WHERE kind = 'intention'`,
    );
    expect(intentions.rows.map((r) => [r.content, r.status])).toEqual([
      ["Spica is counting the hours until the telescope images come in.", "resolved"],
    ]);
    const episodes = await getTestDb().execute(
      sql`SELECT content, occurred_at, created_at FROM core_memory WHERE kind = 'episode'`,
    );
    expect(episodes.rows.some((r) => String(r.content).includes("telescope images"))).toBe(true);
    for (const r of episodes.rows)
      expect(new Date(String(r.created_at)).getTime()).toBeGreaterThanOrEqual(
        new Date(String(r.occurred_at)).getTime(),
      );
  });

  test("every reply read the snapshot her nights had rendered by then, and logged it", async () => {
    const replies = llm.seen.filter((c) => c.kind === "reply");
    expect(replies.length).toBeGreaterThan(0);
    for (const r of replies) expect(r.text).toContain("## Who you are lately");
    const rows = await getTestDb()
      .select({
        v: session_log.snapshot_version,
        trigger: session_log.trigger,
        at: session_log.created_at,
      })
      .from(session_log)
      .where(eq(session_log.role, "companion"));
    const snaps = await getTestDb()
      .select({ v: core_snapshot.version, at: core_snapshot.rendered_at })
      .from(core_snapshot);
    const latestAt = (at: Date) =>
      Math.max(...snaps.filter((x) => x.at.getTime() <= at.getTime()).map((x) => x.v));
    const composed = rows.filter((r) => r.trigger === null || r.trigger === "reach_out");
    expect(composed.length).toBeGreaterThan(0);
    for (const r of composed) expect(r.v).toBe(latestAt(r.at));
    // Her nights moved the self on, so this isn't only v0.
    expect(Math.max(...composed.map((r) => r.v ?? 0))).toBeGreaterThan(0);
  });
});

describe("side channel", () => {
  test("A's emotional exchange leaves core state and her loops' traces exactly as without it", async () => {
    const fixedEventId = "00000000-0000-4000-8000-000000000001";
    const morning = new Date("2026-01-05T09:00:00Z");
    const landing = new Date("2026-01-05T10:00:00Z");
    const later = new Date("2026-01-05T12:00:00Z");
    const coreAfter = async (exchange: boolean) => {
      await resetDb();
      const deps = makeTestDeps({
        life: { timezone: "UTC" },
        core: { world: { events_local_hour: 20 } },
      });
      const alice = await createTestUser("alice");
      await ensureRelationship(deps.db, alice, morning, deps.config.relationship);
      if (exchange) {
        Object.assign(
          deps.llm.handlers,
          scriptedLabels({
            memories: [
              {
                said: "love talking to you",
                label: `loves talking to Spica ${TOKEN}`,
                kind: "trait",
                salience: 0.8,
                valence: 0.9,
                confidence: 1,
              },
            ],
            relationship: { warmth: 0.8, trust: 0.4 },
          }),
        );
        const userTurn = await insertTurn(deps.db, alice, {
          id: randomUUID(),
          session_id: randomUUID(),
          role: "user",
          text: `I love talking to you so much ${TOKEN}.`,
          created_at: morning,
        });
        const reply = await insertTurn(deps.db, alice, {
          id: randomUUID(),
          session_id: userTurn.session_id,
          role: "companion",
          text: "I love talking with you too.",
          created_at: morning,
          reply_to: userTurn.id,
        });
        expect(
          await runColdPath(deps, {
            userId: alice,
            turnIds: [userTurn.id, reply.id],
            replyTurnId: reply.id,
            recalled: [],
          }),
        ).toMatchObject({ status: "done" });
      }
      const affect = (await getParams(deps.db, alice)).affect_valence.value;
      await deps.db.insert(world_event).values({
        id: fixedEventId,
        at: landing,
        kind: "planned",
        content: "Spica plans to inspect the telescope images.",
        valence: 0.8,
        stakes: "high",
        agents: [],
        agent_names: [],
        life_day: "2026-01-05",
        created_at: morning,
        fallthrough: null,
      });
      await deps.core.memory.insert({
        kind: "intention",
        content: "Spica expects the telescope images.",
        payload: { event_at: landing.toISOString() },
        embedding: vec(),
        entity_refs: [],
        occurred_at: morning,
        created_at: morning,
        status: "open",
        salience: 0.4,
        valence: 0.8,
        confidence: 1,
        source: "world",
        source_ref: `world_event:${fixedEventId}`,
      });
      const core = coreDepsOf(deps);
      await coreMindTick(core, morning);
      await coreWorldTick(core, landing);
      await deps.core.world.insertPlan({
        date: "2026-01-05",
        plan: { blocks: [] },
        source: "scripted",
        model: "fake",
        prompt_version: "scripted",
        generated_at: later,
      });
      await coreMindTick(core, later);
      const memories = await deps.db.select().from(core_memory);
      const traces = await deps.db.select().from(core_loop_trace);
      const events = await deps.db.select().from(world_event);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ id: fixedEventId, outcome: "happened" });
      for (const loop of ["core_anticipate", "core_appraise", "core_ruminate", "core_wander"])
        expect(
          traces.filter((trace) => trace.loop === loop && trace.status === "done"),
          loop,
        ).toHaveLength(1);
      const labels = new Map([
        ...memories.map((row) => [row.id, `<memory:${row.content}>`] as const),
        ...traces.map((row) => [row.id, `<trace:${row.loop}>`] as const),
      ]);
      const state = await deps.db.select().from(core_state);
      const snapshotOf = (
        stateRows: typeof state,
        memoryRows: typeof memories,
        eventRows: typeof events,
        traceRows: typeof traces,
      ) =>
        JSON.stringify({
          state: [...stateRows].sort((a, b) => a.id - b.id),
          memories: [...memoryRows].sort((a, b) =>
            `${a.kind}:${a.source_ref ?? ""}:${a.content}`.localeCompare(
              `${b.kind}:${b.source_ref ?? ""}:${b.content}`,
            ),
          ),
          events: [...eventRows].sort((a, b) =>
            `${a.at.toISOString()}:${a.kind}:${a.content}:${a.id}`.localeCompare(
              `${b.at.toISOString()}:${b.kind}:${b.content}:${b.id}`,
            ),
          ),
          traces: [...traceRows].sort((a, b) =>
            `${a.created_at.toISOString()}:${a.loop}:${a.status}`.localeCompare(
              `${b.created_at.toISOString()}:${b.loop}:${b.status}`,
            ),
          ),
        }).replace(UUID, (id) => labels.get(id) ?? id);
      const snapshot = snapshotOf(state, memories, events, traces);
      expect(
        snapshotOf(
          [...state].reverse(),
          [...memories].reverse(),
          [...events].reverse(),
          [...traces].reverse(),
        ),
      ).toBe(snapshot);
      expect(snapshot).not.toContain(TOKEN);
      return { snapshot, affect };
    };

    const neutral = await coreAfter(false);
    const emotional = await coreAfter(true);
    expect(emotional.snapshot).toBe(neutral.snapshot);
    expect(emotional.affect).toBeGreaterThan(neutral.affect);
  });
});
