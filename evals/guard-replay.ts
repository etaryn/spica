/**
 * Calibration replay: runs the real guard over every message that went out unchecked while the
 * guard was off, and writes a review file to label by hand. A dev tool over the local database
 * only: it reads across users (like the offline cross-user comparison) and writes nothing back.
 * Logged inputs keep memory ids, not content, so honesty verdicts here are advisory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { assertLocalDatabase } from "@/db/reset-self";
import { judge_log } from "@/db/schema";
import { systemClock } from "@/mind/platform/clock";
import { loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { AnthropicProvider } from "@/mind/platform/llm/anthropic";
import { checkMessage, type GuardKind, type GuardTurn } from "@/mind/process/guard/guard";
import { UsageTally } from "./lib/usage";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("pnpm calibrate:guard-replay needs DATABASE_URL");
assertLocalDatabase(url);
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error("pnpm calibrate:guard-replay needs ANTHROPIC_API_KEY");

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const usage = new UsageTally();
const deps = {
  llm: new AnthropicProvider(new Anthropic(), config.models, usage.record),
  config,
  clock: systemClock,
};
const { db, pool } = createDb(url);

type Logged = {
  kind: GuardKind;
  text: string;
  recentTurns: { role: "user" | "companion"; text: string; at: string }[];
};
const rows = await db
  .select()
  .from(judge_log)
  .where(eq(judge_log.outcome, "guard_disabled"))
  .orderBy(asc(judge_log.created_at));

const out = [`# Guard replay ${new Date().toISOString()}`, "", `${rows.length} messages`, ""];
for (const row of rows) {
  const logged = row.input as Logged;
  const recentTurns: GuardTurn[] = logged.recentTurns.map((t) => ({ ...t, at: new Date(t.at) }));
  const v = await checkMessage(deps, {
    kind: logged.kind,
    text: logged.text,
    recentTurns,
    recalledFacts: [],
    onboardingFacts: [],
  });
  out.push(
    `## ${row.created_at.toISOString()} (${logged.kind})`,
    ...recentTurns.map((t) => `> ${t.role === "user" ? "User" : "Spica"}: ${t.text}`),
    "",
    `**Message:** ${logged.text}`,
    "",
    `- verdict: ${v.ok ? "ok" : v.violations.map((x) => `${x.category} (${x.claim})`).join("; ")}`,
    `- reasoning: ${v.reasoning ?? `(keyword fallback: ${v.error})`}`,
    `- self claims: ${v.selfClaims.join("; ") || "none"}`,
    `- label (ok / wrong: why):`,
    "",
  );
}
await pool.end();

const dir = path.join(process.cwd(), "evals", "results");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `guard-replay-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
writeFileSync(file, [...out, ...usage.format()].join("\n"));
console.log(`wrote ${file}`);
for (const line of usage.format()) console.log(line);
