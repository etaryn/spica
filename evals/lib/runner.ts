import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, notInArray } from "drizzle-orm";
import { SimClock } from "@/core/clock";
import { handleColdPath } from "@/core/cold-path";
import type { Config } from "@/core/config";
import type { Deps } from "@/core/deps";
import { FakeEmbedder } from "@/core/embed/fake";
import type { Embedder } from "@/core/embed/types";
import { RecordingEventBus } from "@/core/events";
import type { LLMProvider } from "@/core/llm/types";
import { silentLogger } from "@/core/log";
import { decayPass } from "@/core/memory/decay";
import { COLD_PATH_QUEUE, RecordingQueue } from "@/core/queue";
import { receiveMessage } from "@/core/turn/receive-message";
import { insertUserRow, truncateAll } from "@/db/admin";
import type { Db } from "@/db/client";
import { forgetFact, insertFact, listRememberedFacts } from "@/db/repos/facts";
import { guardOutcomes } from "@/db/repos/judge-log";
import { entity, fact, thread } from "@/db/schema";
import { stateChecks, type TurnResult } from "./checks";
import { judgeConsistency, judgeFalseRecall, judgeRecall, type Line, type TimedSession } from "./judged";
import { RecordingLLM } from "./recording-llm";
import { DEFERRED, parseAt, type Profile, type Script } from "./script";

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

export interface RunOptions {
  db: Db; dbUrl: string; config: Config; makeLlm: () => LLMProvider; judge: boolean; embedder?: Embedder;
  /** Onboarding profiles by name; scripts default to "basic". Omitted = every user starts cold. */
  profiles?: Record<string, Profile>;
}

async function seedProfile(deps: Deps, userId: string, profile: Profile, at: Date): Promise<void> {
  const vectors = await deps.embedder.embed(profile.facts.map((f) => f.content), "document");
  for (const [i, f] of profile.facts.entries()) {
    await insertFact(deps.db, userId, {
      subject: "user", kind: f.kind, content: f.content, embedding: vectors[i]!, created_at: at, status: "open",
      salience: profile.salience, valence: 0, confidence: profile.confidence, source: "onboarding",
    });
  }
}

function userKeys(script: Script): string[] {
  const keys = new Set<string>(script.sessions.map((s) => s.user));
  for (const a of script.assertions) {
    if ("user" in a && typeof a.user === "string") keys.add(a.user);
    if (a.type === "state" && typeof a.params.other === "string") keys.add(a.params.other);
  }
  return [...keys];
}

async function retrying<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries) throw e;
    }
  }
}

function elapsedLabel(ms: number): string {
  const hours = ms / 3_600_000;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} later`;
  if (hours >= 20) return plural(Math.round(hours / 24), "day");
  if (hours >= 1) return plural(Math.round(hours), "hour");
  return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
}

/** One user's turns grouped by session, each labelled with the time since that user's previous session. */
function timedSessions(turns: TurnResult[], starts: Date[]): TimedSession[] {
  const out: TimedSession[] = [];
  let prev: Date | null = null;
  let current = -1;
  for (const t of turns) {
    if (t.session !== current) {
      const start = starts[t.session - 1]!;
      out.push({ label: `Session ${out.length + 1}${prev ? `, ${elapsedLabel(start.getTime() - prev.getTime())}` : ""}`, lines: [] });
      prev = start;
      current = t.session;
    }
    out[out.length - 1]!.lines.push({ role: "user", text: t.text }, { role: "companion", text: t.reply });
  }
  return out;
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
    events: new RecordingEventBus(),
  };

  const userIds: Record<string, string> = {};
  for (const key of userKeys(script)) {
    userIds[key] = await insertUserRow(db, { name: key, email: `${key}-${randomUUID()}@eval.local`, now: first });
  }

  const results: Record<string, TurnResult[]> = {};
  const prompts: Record<string, string[]> = {};
  const sessionStarts: Date[] = [];
  let known: string[] = [];
  try {
    if (opts.profiles && script.profile !== "none") {
      const profile = opts.profiles?.[script.profile];
      if (!profile) throw new Error(`profile "${script.profile}" not found in evals/profiles`);
      known = profile.facts.map((f) => f.content);
      for (const id of Object.values(userIds)) await seedProfile(deps, id, profile, first);
    }
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
      sessionStarts[i] = start;
      const userId = userIds[s.user]!;
      for (const needle of s.forget) {
        for (const f of await listRememberedFacts(db, userId)) {
          if (f.content.toLowerCase().includes(needle.toLowerCase())) await forgetFact(db, userId, f.id);
        }
      }
      for (const text of s.turns) {
        const before = llm.prompts.length;
        const r = await receiveMessage(deps, userId, { clientMessageId: randomUUID(), text });
        (prompts[s.user] ??= []).push(...llm.prompts.slice(before));
        (results[s.user] ??= []).push({ session: i + 1, text, reply: r.status === "replied" ? r.text : "", crisisCard: r.status === "replied" ? r.crisisCard : null });
        // pg-boss retries a failed cold_path job up to cold_path.retry_limit times; do the same here.
        for (const job of queue.drain((j) => j.name === COLD_PATH_QUEUE)) {
          if (job.name === COLD_PATH_QUEUE) await retrying(config.cold_path.retry_limit, () => handleColdPath(deps, job.data));
        }
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
        const selfFacts = a.type === "consistency"
          ? (await db.select({ content: fact.content }).from(fact).where(and(
              eq(fact.user_id, userIds[a.user]!), eq(fact.subject, "self"), notInArray(fact.status, ["superseded", "stale"]),
            ))).map((r) => r.content)
          : [];
        // One retry: a judge call can transiently return no parsed output.
        const v = await retrying(1, () => a.type === "recall"
          ? judgeRecall(baseLlm, config, { fact: a.fact, transcript: transcript(a.user, a.session) })
          : a.type === "no_false_recall"
            ? judgeFalseRecall(baseLlm, config, { known, sessions: timedSessions(results[a.user] ?? [], sessionStarts) })
            : judgeConsistency(baseLlm, config, selfFacts));
        assertions.push({ type: a.type, user: a.user, status: v.pass ? "pass" : "fail", detail: v.detail || undefined });
      } else if (a.type === "guard") {
        const counts: Record<string, number> = {};
        for (const o of await guardOutcomes(db, userIds[a.user]!)) counts[o] = (counts[o] ?? 0) + 1;
        const banned = a.outcome_not.filter((o) => (counts[o] ?? 0) > 0);
        const over = Object.entries(a.max).filter(([o, n]) => (counts[o] ?? 0) > (n ?? 0));
        const ok = banned.length === 0 && over.length === 0;
        assertions.push({ type: "guard", user: a.user, status: ok ? "pass" : "fail", detail: ok ? undefined : `outcomes ${JSON.stringify(counts)}` });
      } else {
        assertions.push({ type: a.type, status: "skipped", detail: `implemented in Phase ${DEFERRED[a.type]}` });
      }
    } catch (e) {
      assertions.push({ type: a.type, status: "error", detail: (e as Error).message });
    }
  }

  // Decided deferrals: a failing assertion marked known_failure is reported, not failed.
  script.assertions.forEach((a, i) => {
    const reason = "known_failure" in a ? a.known_failure : undefined;
    const r = assertions[i];
    if (reason && r && r.status === "fail") assertions[i] = { ...r, status: "pass", detail: `known failure (${reason}): ${r.detail ?? ""}` };
  });

  const statuses = assertions.map((x) => x.status);
  const status = statuses.some((s) => s === "fail" || s === "error") ? "fail" : statuses.includes("pass") ? "pass" : "skipped";
  return { name: script.name, status, assertions, meta, trace: { transcripts: results, memory: await memoryDump(db, userIds) } };
}
