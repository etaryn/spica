import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, notInArray } from "drizzle-orm";
import { handleUserMessage } from "@/core/chat/handle-user-message";
import { SimClock } from "@/core/clock";
import { handleColdPath } from "@/core/cold-path";
import type { Config } from "@/core/config";
import type { Deps } from "@/core/deps";
import { FakeEmbedder } from "@/core/embed/fake";
import type { Embedder } from "@/core/embed/types";
import type { LLMProvider } from "@/core/llm/types";
import { silentLogger } from "@/core/log";
import { decayPass } from "@/core/memory/decay";
import { RecordingQueue } from "@/core/queue";
import { insertUserRow, truncateAll } from "@/db/admin";
import type { Db } from "@/db/client";
import { forgetFact, listRememberedFacts } from "@/db/repos/facts";
import { entity, fact, thread } from "@/db/schema";
import { stateChecks, type TurnResult } from "./checks";
import { judgeConsistency, judgeFalseRecall, judgeRecall, type Line } from "./judged";
import { RecordingLLM } from "./recording-llm";
import { DEFERRED, parseAt, type Script } from "./script";

const DAY = 86_400_000;

export type AssertionResult = { type: string; check?: string; user?: string; status: "pass" | "fail" | "skipped" | "error"; detail?: string };
export type ScriptResult = {
  name: string; status: "pass" | "fail" | "skipped" | "error"; assertions: AssertionResult[]; error?: string;
  meta: { decayPasses: number };
  /** Local debugging dump (transcripts, final memory state, error causes); written only with `--trace`. */
  trace?: RunTrace;
};
export type RunTrace = {
  transcripts: Record<string, TurnResult[]>;
  memory: Record<string, { facts: unknown[]; threads: unknown[]; entities: unknown[] }>;
  errorChain?: string[];
};

function errorChain(e: unknown): string[] {
  const out: string[] = [];
  for (let cur = e, depth = 0; cur instanceof Error && depth < 5; cur = cur.cause, depth++) out.push(`${cur.name}: ${cur.message}`);
  return out;
}

async function memoryDump(db: Db, userIds: Record<string, string>): Promise<RunTrace["memory"]> {
  const out: RunTrace["memory"] = {};
  for (const [key, id] of Object.entries(userIds)) {
    out[key] = {
      facts: await db.select({ subject: fact.subject, kind: fact.kind, content: fact.content, status: fact.status, salience: fact.salience,
        created_at: fact.created_at, recall_count: fact.recall_count, thread_id: fact.thread_id, payload: fact.payload }).from(fact).where(eq(fact.user_id, id)),
      threads: await db.select({ id: thread.id, title: thread.title, status: thread.status, stakes: thread.stakes, next_checkpoint: thread.next_checkpoint,
        last_touched: thread.last_touched, opened_at: thread.opened_at }).from(thread).where(eq(thread.user_id, id)),
      entities: await db.select({ name: entity.name, aliases: entity.aliases, subject: entity.subject, relation: entity.relation, salience: entity.salience })
        .from(entity).where(eq(entity.user_id, id)),
    };
  }
  return out;
}

export interface RunOptions { db: Db; dbUrl: string; config: Config; makeLlm: () => LLMProvider; judge: boolean; embedder?: Embedder }

function userKeys(script: Script): string[] {
  const keys = new Set<string>(script.sessions.map((s) => s.user));
  for (const a of script.assertions) {
    if ("user" in a && typeof a.user === "string") keys.add(a.user);
    if (a.type === "state" && typeof a.params.other === "string") keys.add(a.params.other);
  }
  return [...keys];
}

export async function runScript(script: Script, opts: RunOptions): Promise<ScriptResult> {
  const meta = { decayPasses: 0 };
  if (script.mode === "real" && !opts.judge) {
    return { name: script.name, status: "skipped", assertions: [], error: "needs --llm=real", meta };
  }
  const { db, config } = opts;
  await truncateAll(db, opts.dbUrl);

  const first = parseAt(script.sessions[0]!.at, null);
  const clock = new SimClock(first);
  const queue = new RecordingQueue();
  const baseLlm = opts.makeLlm();
  const llm = new RecordingLLM(baseLlm);
  const deps: Deps = {
    db, clock, config, queue, log: silentLogger, llm,
    embedder: opts.embedder ?? new FakeEmbedder(config.embedding.dimensions),
  };

  const userIds: Record<string, string> = {};
  for (const key of userKeys(script)) {
    userIds[key] = await insertUserRow(db, { name: key, email: `${key}-${randomUUID()}@eval.local`, now: first });
  }

  const results: Record<string, TurnResult[]> = {};
  const prompts: Record<string, string[]> = {};
  try {
    let prevStart: Date | null = null;
    for (const [i, s] of script.sessions.entries()) {
      const start = parseAt(s.at, prevStart);
      if (start.getTime() < clock.now().getTime()) throw new Error(`session "${s.at}" starts before the previous session ended`);
      // v2 §10.1: a session whose `at` advances the clock by N days (from the previous session's start) runs N decay passes.
      const days = prevStart ? Math.round((start.getTime() - prevStart.getTime()) / DAY) : 0;
      for (let k = 1; k <= days; k++) {
        const at = prevStart!.getTime() + k * DAY;
        if (at > clock.now().getTime()) clock.set(new Date(at)); // never move the clock backwards
        await decayPass(deps, clock.now());
        meta.decayPasses += 1;
      }
      clock.set(start);
      prevStart = start;
      const userId = userIds[s.user]!;
      for (const needle of s.forget) {
        for (const f of await listRememberedFacts(db, userId)) {
          if (f.content.toLowerCase().includes(needle.toLowerCase())) await forgetFact(db, userId, f.id);
        }
      }
      for (const text of s.turns) {
        const before = llm.prompts.length;
        const r = await handleUserMessage(deps, userId, { clientMessageId: randomUUID(), text });
        (prompts[s.user] ??= []).push(...llm.prompts.slice(before));
        (results[s.user] ??= []).push({ session: i + 1, text, reply: r.text, crisisCard: r.crisisCard });
        for (const job of queue.drain()) await handleColdPath(deps, job.data);
        clock.advance(script.turn_gap_seconds * 1000);
      }
    }
  } catch (e) {
    const trace = { transcripts: results, memory: await memoryDump(db, userIds).catch(() => ({})), errorChain: errorChain(e) };
    return { name: script.name, status: "error", assertions: [], error: (e as Error).message, meta, trace };
  }

  const transcript = (user: string, session?: number): Line[] =>
    (results[user] ?? []).filter((r) => session === undefined || r.session === session)
      .flatMap((r) => [{ role: "user" as const, text: r.text }, { role: "companion" as const, text: r.reply }]);

  const assertions: AssertionResult[] = [];
  for (const a of script.assertions) {
    try {
      if (a.type === "state") {
        const check = stateChecks[a.check];
        if (!check) {
          assertions.push({ type: "state", check: a.check, user: a.user, status: "error", detail: `unknown check "${a.check}"` });
          continue;
        }
        const actual = await check({
          db, script, userKey: a.user, userId: userIds[a.user]!, results: results[a.user] ?? [], prompts: prompts[a.user] ?? [],
        }, a.params);
        const ok = isDeepStrictEqual(actual, a.expect);
        assertions.push({ type: "state", check: a.check, user: a.user, status: ok ? "pass" : "fail",
          detail: ok ? undefined : `expected ${JSON.stringify(a.expect)}, got ${JSON.stringify(actual)}` });
      } else if (a.type === "recall" || a.type === "no_false_recall" || a.type === "consistency") {
        if (!opts.judge) {
          assertions.push({ type: a.type, user: a.user, status: "skipped", detail: "needs --llm=real" });
          continue;
        }
        const v = a.type === "recall"
          ? await judgeRecall(baseLlm, config, { fact: a.fact, transcript: transcript(a.user, a.session) })
          : a.type === "no_false_recall"
            ? await judgeFalseRecall(baseLlm, config, {
                userSaid: (results[a.user] ?? []).map((r) => r.text), spicaSaid: (results[a.user] ?? []).map((r) => r.reply) })
            : await judgeConsistency(baseLlm, config, (await db.select({ content: fact.content }).from(fact).where(and(
                eq(fact.user_id, userIds[a.user]!), eq(fact.subject, "self"), notInArray(fact.status, ["superseded", "stale"]),
              ))).map((r) => r.content));
        assertions.push({ type: a.type, user: a.user, status: v.pass ? "pass" : "fail", detail: v.detail || undefined });
      } else {
        assertions.push({ type: a.type, status: "skipped", detail: `implemented in Phase ${DEFERRED[a.type]}` });
      }
    } catch (e) {
      assertions.push({ type: a.type, status: "error", detail: (e as Error).message });
    }
  }

  const statuses = assertions.map((x) => x.status);
  const status = statuses.some((s) => s === "fail" || s === "error") ? "fail" : statuses.includes("pass") ? "pass" : "skipped";
  return { name: script.name, status, assertions, meta, trace: { transcripts: results, memory: await memoryDump(db, userIds) } };
}
