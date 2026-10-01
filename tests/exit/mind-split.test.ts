/**
 * The mind split's exit run, all fake. Two users over three of her days, with every hourly world
 * job, replies, the cold path and a reach-out. A canary in user A's data (a fact, and the cause of
 * a hurt in A's relationship) must never reach the core or user B; A's emotional exchange must
 * leave core state and her core loops' traces untouched; her events happen once for both; every
 * reply reads snapshot v0.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { session_log } from "@/db/schema";
import { loadConfig } from "@/mind/platform/config";
import { keywordClassifier } from "@/mind/platform/llm/fake";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { runScript, type RunOptions } from "../../evals/lib/runner";
import { ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, testDbUrl } from "../helpers/db";
import { CANARY, CapturingLLM } from "../helpers/llm";

afterAll(closeTestDb);
const TOKEN = "CANARY-7f3a91";
const config = loadConfig({ life: { timezone: "UTC" } });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CORE_PURPOSES = new Set(["life_plan", "life_event"]);
const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "life_day",
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
];

function script(aText: string) {
  return ScriptSchema.parse({
    name: "mind-split-exit",
    profile: "none",
    config: {
      life: { timezone: "UTC" },
      core: { world: { event_probability: 1, events_per_day_max: 1 } },
    },
    relationship_seed: {},
    life: {
      plan: "model",
      inject: [{ day: 1, content: "Spica finally got the telescope images.", valence: 0.8 }],
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
    expect(aliceReply?.text).toContain(`the user kept ${TOKEN} from her`);
  });

  test("no core table holds it", async () => {
    expect(await dumpTables(CORE_TABLES)).not.toMatch(CANARY);
  });

  test("no core prompt saw it", () => {
    const corePrompts = llm.seen.filter(
      (c) =>
        CORE_PURPOSES.has(c.purpose) || (c.purpose === "reconcile" && c.text.includes("(episode)")),
    );
    expect(corePrompts.length).toBeGreaterThan(0);
    // Each core generator ran, so none of these checks passes vacuously.
    for (const purpose of CORE_PURPOSES)
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
      sql`SELECT life_day, count(*)::int AS n FROM world_event GROUP BY life_day`,
    );
    expect(days.rows.length).toBeGreaterThan(0);
    for (const r of days.rows) expect(Number(r.n)).toBeLessThanOrEqual(1);
    const event = "Spica finally got the telescope images.";
    const replyPrompts = (needle: string) =>
      llm.seen.filter((c) => c.kind === "reply" && c.text.includes(needle));
    const alicePrompts = replyPrompts("ALICE-SAYS anything new");
    const bobPrompts = replyPrompts("BOB-SAYS what have you");
    expect(alicePrompts.length).toBeGreaterThan(0);
    expect(bobPrompts.length).toBeGreaterThan(0);
    expect(alicePrompts.some((c) => c.text.includes(event))).toBe(true);
    expect(bobPrompts.some((c) => c.text.includes(event))).toBe(true);
  });

  test("every reply read snapshot v0 and logged it", async () => {
    const replies = llm.seen.filter((c) => c.kind === "reply");
    expect(replies.length).toBeGreaterThan(0);
    for (const r of replies) expect(r.text).toContain("## Who you are lately");
    const rows = await getTestDb()
      .select({ v: session_log.snapshot_version, trigger: session_log.trigger })
      .from(session_log)
      .where(eq(session_log.role, "companion"));
    const composed = rows.filter((r) => r.trigger === null || r.trigger === "reach_out");
    expect(composed.length).toBeGreaterThan(0);
    for (const r of composed) expect(r.v).toBe(0);
  });
});

describe("side channel", () => {
  test("A's emotional exchange leaves core state and her loops' traces exactly as without it", async () => {
    // Ids are random per run, so every uuid is replaced by what it points at (a memory or event by
    // its content, a person by name): her preoccupation and each trace's outputs are compared by
    // the memory they name. Rows are sorted; everything else (mood, energy, timestamps) must match.
    const coreAfter = async (aText: string) => {
      await run(aText);
      const labels = new Map<string, string>();
      const label = async (table: string, column: string, tag: string) => {
        const res = await getTestDb().execute(
          sql.raw(`SELECT id::text AS id, ${column} AS v FROM "${table}"`),
        );
        for (const r of res.rows) labels.set(String(r.id), `<${tag}:${String(r.v)}>`);
      };
      await label("core_memory", "content", "memory");
      await label("world_event", "content", "event");
      await label("core_entity", "name", "person");
      const rows: string[] = [];
      for (const t of ["core_state", "core_memory", "world_event", "core_loop_trace"])
        rows.push(
          ...(await rowsOf(t)).map(
            (r) => `${t} ${r.replace(UUID, (id) => labels.get(id) ?? "<id>")}`,
          ),
        );
      return rows.sort().join("\n");
    };
    const affectOf = async () => {
      const alice = await userIdByName("alice");
      const res = await getTestDb().execute(
        sql`SELECT value FROM relationship_param WHERE user_id = ${alice} AND name = 'affect_valence'`,
      );
      return Number(res.rows[0]!.value);
    };
    const neutral = await coreAfter("ALICE-SAYS morning");
    const neutralAffect = await affectOf();
    const emotional = await coreAfter(`ALICE-SAYS I love talking to you so much ${TOKEN}`);
    const emotionalAffect = await affectOf();

    expect(emotional).toBe(neutral);
    expect(emotionalAffect).toBeGreaterThan(neutralAffect);
  });
});
