/**
 * Two simulated weeks of her core mind, all fake: every loop runs and traces, no day spends more
 * than its budget, the self advances nightly with drift rows, and a tight budget sheds the optional
 * loops first while the essential ones fall back.
 */
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { loadConfig, type Config } from "@/mind/platform/config";
import { FakeLLMProvider, keywordClassifier } from "@/mind/platform/llm/fake";
import { budgetDayStart } from "@/mind/process/core/runner";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { runScript } from "../../evals/lib/runner";
import { loadScripts, type Script } from "../../evals/lib/script";
import { closeTestDb, getTestDb, resetDb, testDbUrl } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const base = loadScripts(path.join(process.cwd(), "evals", "scripts")).find(
  (s) => s.name === "core-two-weeks",
)!;

/** The fake appraisal also advances the first goal it is shown, so progress can move. */
function makeLlm(config: Config) {
  const llm = new FakeLLMProvider({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  const appraise = llm.handlers.core_appraise!;
  llm.handlers.core_appraise = async (input: string) => {
    const out = (await appraise(input)) as { goal_effects: unknown[] };
    const goal = /^- \[([0-9a-f-]{36})\]/m.exec(input)?.[1];
    return goal
      ? { ...out, goal_effects: [{ goal_id: goal, effect: "advance", size: "small" }] }
      : out;
  };
  return llm;
}

async function run(script: Script) {
  // The runner merges the script's config itself; this copy is for checking budgets afterwards.
  const config = loadConfig(script.config as Partial<Config> | undefined);
  const result = await runScript(script, {
    db: getTestDb(),
    dbUrl: testDbUrl,
    config,
    makeLlm: () => makeLlm(config),
    real: false,
    annotate: false,
    turnJudgeReal: false,
  });
  return { result, config };
}

/** Summed core calls per her local day. */
async function callsPerDay(config: Config): Promise<number[]> {
  const rows = await getTestDb().execute(
    sql`SELECT created_at, calls FROM core_loop_trace ORDER BY created_at`,
  );
  const days = new Map<number, number>();
  for (const r of rows.rows) {
    const day = budgetDayStart(config, new Date(String(r.created_at))).getTime();
    days.set(day, (days.get(day) ?? 0) + Number(r.calls));
  }
  return [...days.values()];
}

const one = async (q: SQL) => Number((await getTestDb().execute(q)).rows[0]!.n);

test("fourteen days: every loop runs within budget and the self advances", async () => {
  const { result, config } = await run(base);
  expect(result.status, result.error ?? JSON.stringify(result.assertions)).toBe("pass");
  for (const n of await callsPerDay(config))
    expect(n).toBeLessThanOrEqual(config.core.daily_call_budget);
  const count = (where: SQL) => one(sql`SELECT count(*)::int AS n FROM core_memory WHERE ${where}`);
  expect(await count(sql`payload ? 'gist_of'`)).toBeGreaterThan(0);
  expect(await count(sql`payload ? 'ruminates'`)).toBeGreaterThan(0);
  expect(
    await one(sql`SELECT count(*)::int AS n FROM core_goal WHERE progress > 0`),
  ).toBeGreaterThan(0);
  const needs = (await getTestDb().execute(sql`SELECT needs FROM core_state`)).rows[0]!
    .needs as Record<string, number>;
  expect(Object.values(needs).some((v) => v !== config.core.state.needs_baseline)).toBe(true);
}, 600_000);

test("a budget of 6 sheds optional loops and falls back on essentials", async () => {
  const tight = {
    ...base,
    config: {
      ...base.config,
      core: {
        ...(base.config?.core as object),
        // Optional loops get 2 calls a day; the essential ones may use all 6.
        daily_call_budget: 6,
        budget_reserve: 4,
      },
    },
  };
  const { config } = await run(tight as Script);
  expect(config.core.daily_call_budget).toBe(6);
  for (const n of await callsPerDay(config)) expect(n).toBeLessThanOrEqual(6);
  const statuses = await getTestDb().execute(
    sql`SELECT DISTINCT loop, status FROM core_loop_trace WHERE status IN ('skipped_budget', 'fallback')`,
  );
  const seen = statuses.rows.map((r) => `${r.loop}:${r.status}`);
  expect(seen.some((s) => /^core_(wander|anticipate|ruminate):skipped_budget$/.test(s))).toBe(true);
  expect(seen.some((s) => s.endsWith(":fallback"))).toBe(true);
}, 600_000);
