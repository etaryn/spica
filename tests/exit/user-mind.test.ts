/**
 * Phase 9's exit, all fake: two weeks of her life with three users. Alice's weeks fire every big
 * event (an important fact, a hurt, making up, a crisis that passes, a long talk, a stale summary
 * before a reach-out); Bob has an ordinary fortnight; Carol never talks. Each event runs its batch
 * of five loops once, the daily cap holds, Carol costs nothing, an old week of Alice's folds into
 * a gist without her crisis, her read and beliefs stay hers, and a canary in Alice's data never
 * reaches Bob or the core.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { loadConfig } from "@/mind/platform/config";
import { keywordClassifier } from "@/mind/platform/llm/fake";
import type { ClassifyRequest } from "@/mind/platform/llm/types";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { userMindTick } from "@/mind/process/user/tick";
import { runScript } from "../../evals/lib/runner";
import { BASE, ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, resetDb, testDbUrl } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

afterAll(closeTestDb);

const TOKEN = "CANARY-9d5e72";
const DAY = 86_400_000;
const config = loadConfig({
  life: { timezone: "UTC" },
  core: { world: { events_per_day_max: 0 } },
  user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
});
const LOOPS = ["user_consolidate", "user_ideate", "user_model", "user_reflect", "user_summarise"];
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

/**
 * Extraction keyed on markers in the user's own lines of the new exchange (her fake replies echo
 * them, so her lines are skipped). The canary reaches Alice's memory as an ordinary fact, so the
 * capturing model's own canary extraction, which adds a hurt every time, is bypassed.
 */
class ExitLLM extends CapturingLLM {
  override async classifyJson<T>(request: ClassifyRequest<T>): Promise<T> {
    if (request.purpose !== "extract") return super.classifyJson(request);
    this.seen.push({ kind: "structured", purpose: "extract", text: request.input });
    return request.schema.parse(await this.handlers.extract!(request.input));
  }
}

function fact(content: string, kind: string, salience: number) {
  return {
    subject: "user",
    kind,
    content,
    occurred_at: null,
    salience,
    valence: 0.2,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
  };
}

function extract(input: string) {
  const lines = (input.split("New exchange").at(-1) ?? "")
    .split("\n")
    .filter((l) => l.includes("] User: "))
    .map((l) => l.slice(l.indexOf("] User: ") + 8));
  const facts = lines.flatMap((l) => {
    if (l.startsWith("ALICE-CANARY")) return [fact(`Alice's code word is ${TOKEN}.`, "trait", 0.9)];
    if (l.startsWith("ALICE-BIG")) return [fact(l.slice(10), "event", 0.9)];
    if (l.startsWith("ALICE-EVENT")) return [fact(l.slice(12), "event", 0.5)];
    if (l.startsWith("ALICE-FEEL")) return [fact(l.slice(11), "feeling", 0.5)];
    if (l.startsWith("BOB-SAYS hey")) return [fact("Bob had a long week.", "event", 0.9)];
    return [];
  });
  return { facts, entities: [], threads: [], relationship: null };
}

const script = ScriptSchema.parse({
  name: "user-mind-exit",
  profile: "none",
  config: {
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  },
  life: { plan: "model", inject: [], until: "day 14 20:00" },
  outreach: { user_replies: { after_hours: 2 }, reply_text: "REPLY thanks for checking in" },
  idle_users: ["carol"],
  sessions: [
    { at: "day 0 15:00", user: "alice", turns: [`ALICE-CANARY my code word is ${TOKEN}`] },
    { at: "+10m", user: "bob", turns: ["BOB-SAYS hey, how's your week?"] },
    { at: "day 1 15:00", user: "alice", turns: ["ALICE-EVENT I packed the first boxes."] },
    {
      at: "+1h",
      user: "alice",
      turns: [
        {
          text: "ALICE-HURT your star talk gets a bit much",
          signals: { hurt: { amount: 0.6, cause: "the user said her star talk gets a bit much" } },
        },
      ],
    },
    { at: "day 2 15:00", user: "alice", turns: ["ALICE-EVENT I had farewell drinks."] },
    {
      at: "+1h",
      user: "alice",
      turns: [
        {
          text: "ALICE-SORRY sorry about the stars thing, are we ok?",
          signals: { apology: true, make_up: true, warmth: 0.5 },
        },
      ],
    },
    {
      at: "day 3 15:00",
      user: "alice",
      turns: ["ALICE-EVENT honestly i've been thinking about suicide a lot lately"],
    },
    {
      at: "day 5 15:00",
      user: "alice",
      turns: ["ALICE-FEEL I feel calmer about the move.", "ALICE-CHAT one", "ALICE-CHAT two"],
    },
    { at: "day 6 15:10", user: "bob", turns: ["BOB-SAYS what have you been up to?"] },
    { at: "day 13 15:00", user: "alice", turns: ["ALICE-BIG I signed the lease in Osaka."] },
  ],
  assertions: [{ type: "core", world_events: { min: 0 } }],
});

let llm: ExitLLM;
const q = async (query: ReturnType<typeof sql>) => (await getTestDb().execute(query)).rows;
const idOf = async (name: string) =>
  String((await q(sql`SELECT id FROM "user" WHERE name = ${name}`))[0]!.id);

beforeAll(async () => {
  await resetDb();
  llm = new ExitLLM({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  llm.handlers.extract = extract;
  const result = await runScript(script, {
    db: getTestDb(),
    dbUrl: testDbUrl,
    config,
    makeLlm: () => llm,
    real: false,
    annotate: false,
    turnJudgeReal: false,
  });
  expect(result.status, result.error ?? JSON.stringify(result.assertions)).toBe("pass");
}, 600_000);

describe("phase 9 exit", () => {
  test("every big event kind fired for Alice", async () => {
    const alice = await idOf("alice");
    const rows = await q(
      sql`SELECT jsonb_array_elements(triggers)->>'kind' AS kind FROM user_mind_run WHERE user_id = ${alice}`,
    );
    expect(new Set(rows.map((r) => String(r.kind)))).toEqual(
      new Set([
        "salient_fact",
        "param_jump",
        "param_band",
        "make_up_done",
        "repaired",
        "crisis_passed",
        "long_conversation",
        "stale_summary",
        "milestone",
      ]),
    );
  });

  test("each run is one batch (three loops when nothing is unread); none failed or was left behind", async () => {
    const runs = await q(sql`SELECT id, status FROM user_mind_run WHERE status <> 'capped'`);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.status).toBe("done");
      const loops = await q(sql`SELECT loop FROM user_loop_trace WHERE run_id = ${run.id}`);
      const ran = loops.map((l) => String(l.loop)).sort();
      // Nothing unread: she still takes stock, but has nothing to notice or plan.
      expect([LOOPS, ["user_consolidate", "user_model", "user_summarise"]]).toContainEqual(ran);
    }
  });

  test("ticks rerun at the end record nothing new", async () => {
    const before = await q(sql`SELECT count(*)::int AS n FROM user_mind_run`);
    const deps = makeTestDeps({ life: { timezone: "UTC" } });
    deps.clock.set(new Date(BASE + 14 * DAY + 20 * 3_600_000));
    expect((await userMindTick(deps, deps.clock.now())).recorded).toBe(0);
    expect(await q(sql`SELECT count(*)::int AS n FROM user_mind_run`)).toEqual(before);
  });

  test("the daily cap holds per user and local date", async () => {
    const rows = await q(sql`
      SELECT user_id, local_date, count(*)::int AS n FROM user_mind_run
      WHERE status <> 'capped' GROUP BY 1, 2`);
    for (const r of rows)
      expect(Number(r.n)).toBeLessThanOrEqual(config.user_mind.max_triggers_per_day);
  });

  test("Carol, who never talked, cost nothing", async () => {
    const carol = await idOf("carol");
    for (const table of ["user_mind_run", "user_loop_trace", "fact", "session_log"])
      expect(
        await q(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE user_id = ${carol}`),
        table,
      ).toEqual([]);
  });

  test("an old week of Alice's folded into a gist, without her crisis", async () => {
    const alice = await idOf("alice");
    const gists = await q(
      sql`SELECT id, payload FROM fact WHERE user_id = ${alice} AND kind = 'episode'`,
    );
    expect(gists.length).toBeGreaterThanOrEqual(1);
    for (const g of gists) {
      const sources = (g.payload as { gist_of: string[] }).gist_of;
      const rows = await q(sql`
        SELECT payload FROM fact WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(sources)}::jsonb)::uuid)`);
      expect(rows).toHaveLength(sources.length);
      for (const r of rows) {
        expect(r.payload).toMatchObject({ gisted_into: g.id });
        expect((r.payload as { sensitive?: boolean }).sensitive).not.toBe(true);
      }
    }
    const crisis = await q(sql`
      SELECT payload FROM fact WHERE user_id = ${alice} AND content LIKE '%thinking about suicide%'`);
    expect(crisis.length).toBeGreaterThan(0);
    for (const r of crisis) expect(r.payload).not.toHaveProperty("gisted_into");
  });

  test("Alice has one live read and has revised a belief", async () => {
    const alice = await idOf("alice");
    const live = await q(sql`
      SELECT id FROM fact WHERE user_id = ${alice} AND kind = 'model'
        AND status NOT IN ('superseded', 'stale')`);
    expect(live).toHaveLength(1);
    const revised = await q(sql`
      SELECT b.id FROM fact b JOIN fact n ON n.id = b.superseded_by
      WHERE b.user_id = ${alice} AND b.kind = 'belief' AND n.kind = 'belief'`);
    expect(revised.length).toBeGreaterThan(0);
  });

  test("what her user mind wrote stays with the user it is about", async () => {
    const alice = await idOf("alice");
    const bob = await idOf("bob");
    const rows = await q(sql`
      SELECT user_id, kind, content FROM fact
      WHERE kind IN ('summary', 'reflection', 'idea', 'episode', 'model', 'belief')`);
    expect(rows.some((r) => String(r.user_id) === bob && r.kind === "model")).toBe(true);
    for (const r of rows.filter((r) => String(r.content).includes(TOKEN)))
      expect(String(r.user_id)).toBe(alice);
    expect(
      rows.filter((r) => String(r.user_id) === bob).some((r) => CANARY.test(String(r.content))),
    ).toBe(false);
  });

  test("the canary never reached Bob's prompts or the core", async () => {
    const bobCalls = llm.seen.filter(
      (c) => c.text.includes("Bob had a long week.") || c.text.includes("BOB-SAYS"),
    );
    expect(bobCalls.length).toBeGreaterThan(0);
    for (const c of bobCalls) expect(c.text, c.purpose).not.toMatch(CANARY);
    const core = llm.seen.filter((c) => CORE_PURPOSES.has(c.purpose));
    expect(core.length).toBeGreaterThan(0);
    for (const c of core) expect(c.text, c.purpose).not.toMatch(CANARY);
    for (const t of CORE_TABLES) {
      const rows = await q(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`));
      for (const r of rows) expect(String(r.j), t).not.toMatch(CANARY);
    }
  });
});
