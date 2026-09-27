import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, notInArray } from "drizzle-orm";
import { SimClock } from "@/core/clock";
import { deepMerge, loadConfig, type Config } from "@/core/config";
import type { Deps } from "@/core/deps";
import { FakeEmbedder } from "@/core/embed/fake";
import type { Embedder } from "@/core/embed/types";
import { RecordingEventBus } from "@/core/events";
import type { LLMProvider } from "@/core/llm/types";
import { silentLogger } from "@/core/log";
import { decayPass } from "@/core/memory/decay";
import { RecordingQueue } from "@/core/queue";
import { crisisCardFor } from "@/core/safety/crisis";
import { receiveMessage } from "@/core/turn/receive-message";
import { insertUserRow, truncateAll } from "@/db/admin";
import type { Db } from "@/db/client";
import { forgetFact, insertFact, listRememberedFacts } from "@/db/repos/facts";
import { guardOutcomes, listJudgeLogs } from "@/db/repos/judge-log";
import { listTurns } from "@/db/repos/session-log";
import { entity, fact, thread } from "@/db/schema";
import { stateChecks, type TurnResult } from "./checks";
import { judgeConsistency, judgeFalseRecall, judgeRecall, judgeReplyAbout, type Line, type TimedSession } from "./judged";
import { RecordingLLM } from "./recording-llm";
import { runAllJobs, runDueJobs } from "./scheduler";
import { DEFERRED, parseAt, turnText, type Profile, type Script } from "./script";
import { checkTurn } from "./turn-check";

const DAY = 86_400_000;

export type AssertionResult = {
  type: string; check?: string; user?: string; status: "pass" | "fail" | "skipped" | "error"; detail?: string;
  /** `turn` assertions only: `majority` passes on a majority of runs instead of every run (design §9.6). */
  gate?: "every" | "majority";
};
/** A judged review note (v2 §15): never part of status or the exit code. */
export type Annotation = { type: string; user: string; verdict: "yes" | "no" | "n/a"; detail?: string };
export type ScriptResult = {
  name: string; status: "pass" | "fail" | "skipped" | "error"; assertions: AssertionResult[]; error?: string;
  annotations: Annotation[];
  meta: { decayPasses: number };
  /** Debugging and review dump (transcripts, turns, decisions, final memory state, error causes). */
  trace?: RunTrace;
};
/** One session_log row, with the script session it fell in. */
export type TraceTurn = {
  id: string; session: number; created_at: Date; role: "user" | "companion"; trigger: string | null; text: string; reply_to: string | null;
};
/** One judge_log row (turn judge or guard). */
export type TraceDecision = {
  kind: string; turn_id: string | null; source: string; outcome: string | null; output: unknown;
  /** Guard rows: what was checked (`reply`, `crisis_reply`, `backchannel`). */
  for?: string;
};
export type RunTrace = {
  transcripts: Record<string, TurnResult[]>;
  memory: Record<string, { facts: unknown[]; threads: unknown[]; entities: unknown[] }>;
  turns?: Record<string, TraceTurn[]>;
  decisions?: Record<string, TraceDecision[]>;
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
  db: Db; dbUrl: string; config: Config; makeLlm: () => LLMProvider; embedder?: Embedder;
  /** This run makes real model calls, so `mode: real` scripts may run. */
  real: boolean;
  /** Run the judged review annotations (`recall`, `no_false_recall`, `consistency`, `reply_about`). */
  annotate: boolean;
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

type SessionLine = { session: number; role: "user" | "companion"; text: string };

/** One user's lines grouped by session, each labelled with the time since that user's previous session. */
function timedSessions(lines: SessionLine[], starts: Date[]): TimedSession[] {
  const out: TimedSession[] = [];
  let prev: Date | null = null;
  let current = -1;
  for (const l of lines) {
    if (l.session !== current) {
      const start = starts[l.session - 1]!;
      out.push({ label: `Session ${out.length + 1}${prev ? `, ${elapsedLabel(start.getTime() - prev.getTime())}` : ""}`, lines: [] });
      prev = start;
      current = l.session;
    }
    out[out.length - 1]!.lines.push({ role: l.role, text: l.text });
  }
  return out;
}

/** The 1-based script session a row created at `d` belongs to (the last session started at or before it). */
function sessionOfAt(starts: Date[], d: Date): number {
  let idx = 0;
  starts.forEach((st, j) => { if (st && d >= st) idx = j; });
  return idx + 1;
}

async function turnsAndDecisions(db: Db, userIds: Record<string, string>, starts: Date[]) {
  const turns: Record<string, TraceTurn[]> = {};
  const decisions: Record<string, TraceDecision[]> = {};
  for (const [key, id] of Object.entries(userIds)) {
    turns[key] = (await listTurns(db, id)).map((t) => ({
      id: t.id, session: sessionOfAt(starts, t.created_at), created_at: t.created_at, role: t.role, trigger: t.trigger, text: t.text, reply_to: t.reply_to,
    }));
    decisions[key] = (await listJudgeLogs(db, id, 100_000)).reverse()
      .map((d) => {
        const checked = (d.input as { kind?: unknown } | null)?.kind;
        return { kind: d.kind, turn_id: d.turn_id, source: d.source, outcome: d.outcome, output: d.output, ...(d.kind === "guard" && typeof checked === "string" ? { for: checked } : {}) };
      });
  }
  return { turns, decisions };
}

export async function runScript(script: Script, opts: RunOptions): Promise<ScriptResult> {
  const meta = { decayPasses: 0 };
  if (script.mode === "real" && !opts.real) {
    return { name: script.name, status: "skipped", assertions: [], annotations: [], error: "needs real model calls (--llm=real or --real)", meta };
  }
  const { db } = opts;
  // A script's `config:` is deep-merged over the run config and used everywhere in this run.
  const config: Config = script.config ? loadConfig(deepMerge(opts.config, script.config)) : opts.config;
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
  const lines: Record<string, SessionLine[]> = {};
  const prompts: Record<string, string[]> = {};
  const sessionStarts: Date[] = [];
  const sessionOf = (d: Date) => sessionOfAt(sessionStarts, d);
  /** Runs `fn` and attributes the reply prompts it produced to `user`. */
  const recording = async (user: string, fn: () => Promise<unknown>) => {
    const before = llm.prompts.length;
    await fn();
    (prompts[user] ??= []).push(...llm.prompts.slice(before));
  };
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
      // Simulated turn scheduling (design §9.1): each message arrives at its scripted time; turn jobs due before
      // it run first (their pacing sleeps advance the clock, so a message due mid-reply arrives after it).
      let at = start.getTime();
      for (const [k, raw] of s.turns.entries()) {
        const text = turnText(raw);
        if (k > 0) at += (typeof raw === "string" ? script.turn_gap_seconds : raw.after_s) * 1000;
        await recording(s.user, () => runDueJobs(deps, queue, clock, new Date(at)));
        if (clock.now().getTime() < at) clock.set(new Date(at));
        // Replies are read back from session_log after the session.
        await recording(s.user, () => receiveMessage(deps, userId, { clientMessageId: randomUUID(), text }));
      }
      // End of session: every pending reply lands (design §9.2).
      await recording(s.user, () => runAllJobs(deps, queue, clock));
    }
  } catch (e) {
    // Collect as much of the run as possible for the trace.
    await collectResults().catch(() => undefined);
    const extra = await turnsAndDecisions(db, userIds, sessionStarts).catch(() => ({}));
    const trace = { transcripts: results, memory: await memoryDump(db, userIds).catch(() => ({})), ...extra, errorChain: errorChain(e) };
    return { name: script.name, status: "error", assertions: [], annotations: [], error: (e as Error).message, meta, trace };
  }

  /** Per-user results and transcript lines, read back from session_log. */
  async function collectResults(): Promise<void> {
    for (const [key, id] of Object.entries(userIds)) {
      const turns = await listTurns(db, id);
      const byId = new Map(turns.map((t) => [t.id, t]));
      const replies = turns.filter((t) => t.role === "companion" && t.reply_to);
      results[key] = turns.filter((t) => t.role === "user").map((u) => {
        const own = replies.find((r) => r.reply_to === u.id) ?? null;
        const covering = replies.find((r) => byId.get(r.reply_to!)!.created_at >= u.created_at) ?? null;
        return { session: sessionOf(u.created_at), text: u.text, reply: own?.text ?? null, crisisCard: crisisCardFor(covering?.safety_flag, config), coveredBy: covering?.id ?? null };
      });
      lines[key] = turns.map((t) => ({ session: sessionOf(t.created_at), role: t.role, text: t.text }));
    }
  }
  await collectResults();

  const transcript = (user: string, session?: number): Line[] =>
    (lines[user] ?? []).filter((l) => session === undefined || l.session === session).map(({ role, text }) => ({ role, text }));

  // Each deterministic result stays paired with its script entry, so known_failure applies to the right one.
  const checked: { reason?: string; result: AssertionResult }[] = [];
  const annotations: Annotation[] = [];
  for (const a of script.assertions) {
    const reason = "known_failure" in a && typeof a.known_failure === "string" ? a.known_failure : undefined;
    const push = (result: AssertionResult) => checked.push({ reason, result });
    try {
      if (a.type === "state") {
        const check = stateChecks[a.check];
        if (!check) {
          push({ type: "state", check: a.check, user: a.user, status: "error", detail: `unknown check "${a.check}"` });
          continue;
        }
        const actual = await check({
          db, script, userKey: a.user, userId: userIds[a.user]!, results: results[a.user] ?? [], prompts: prompts[a.user] ?? [],
        }, a.params);
        const ok = isDeepStrictEqual(actual, a.expect);
        push({ type: "state", check: a.check, user: a.user, status: ok ? "pass" : "fail",
          detail: ok ? undefined : `expected ${JSON.stringify(a.expect)}, got ${JSON.stringify(actual)}` });
      } else if (a.type === "recall" || a.type === "no_false_recall" || a.type === "consistency" || a.type === "reply_about") {
        // Judged entries are review annotations (v2 §15): never assertions, run only with annotate.
        if (!opts.annotate) continue;
        const note = (v: { pass: boolean; detail: string }) => {
          const detail = [reason ? `known failure (${reason})` : "", v.detail].filter(Boolean).join(": ");
          annotations.push({ type: a.type, user: a.user, verdict: v.pass ? "yes" : "no", detail: detail || undefined });
        };
        try {
          if (a.type === "reply_about") {
            // Reply N counts full replies only (reply_to set), not backchannels.
            const full = (await listTurns(db, userIds[a.user]!)).filter((t) => t.role === "companion" && t.reply_to && sessionOf(t.created_at) === a.session);
            const target = full[a.reply - 1];
            if (!target) {
              annotations.push({ type: a.type, user: a.user, verdict: "n/a", detail: `no reply ${a.reply} in session ${a.session}` });
              continue;
            }
            note(await retrying(1, () => judgeReplyAbout(baseLlm, config, { transcript: transcript(a.user, a.session), reply: target.text, about: a.about, not_about: a.not_about })));
            continue;
          }
          const selfFacts = a.type === "consistency"
            ? (await db.select({ content: fact.content }).from(fact).where(and(
                eq(fact.user_id, userIds[a.user]!), eq(fact.subject, "self"), notInArray(fact.status, ["superseded", "stale"]),
              ))).map((r) => r.content)
            : [];
          // One retry: a judge call can transiently return no parsed output.
          note(await retrying(1, () => a.type === "recall"
            ? judgeRecall(baseLlm, config, { fact: a.fact, transcript: transcript(a.user, a.session) })
            : a.type === "no_false_recall"
              ? judgeFalseRecall(baseLlm, config, { known, sessions: timedSessions(lines[a.user] ?? [], sessionStarts) })
              : judgeConsistency(baseLlm, config, selfFacts)));
        } catch (e) {
          annotations.push({ type: a.type, user: a.user, verdict: "n/a", detail: `judge error: ${(e as Error).message}` });
        }
      } else if (a.type === "guard") {
        const counts: Record<string, number> = {};
        for (const o of await guardOutcomes(db, userIds[a.user]!)) counts[o] = (counts[o] ?? 0) + 1;
        const banned = a.outcome_not.filter((o) => (counts[o] ?? 0) > 0);
        const over = Object.entries(a.max).filter(([o, n]) => (counts[o] ?? 0) > (n ?? 0));
        const ok = banned.length === 0 && over.length === 0;
        push({ type: "guard", user: a.user, status: ok ? "pass" : "fail", detail: ok ? undefined : `outcomes ${JSON.stringify(counts)}` });
      } else if (a.type === "turn") {
        const i = a.session - 1;
        const start = sessionStarts[i];
        if (!start) throw new Error(`no session ${a.session}`);
        const range = { start, end: sessionStarts[i + 1] ?? new Date(8.64e15) };
        const r = checkTurn(await listTurns(db, userIds[a.user]!), range, a);
        push({ type: "turn", user: a.user, status: r.ok ? "pass" : "fail", detail: r.detail, ...(a.gate ? { gate: a.gate } : {}) });
      } else {
        push({ type: a.type, status: "skipped", detail: `implemented in Phase ${DEFERRED[a.type]}` });
      }
    } catch (e) {
      push({ type: a.type, status: "error", detail: (e as Error).message });
    }
  }

  // Decided deferrals: a failing assertion marked known_failure is reported, not failed.
  const assertions = checked.map(({ reason, result: r }) =>
    reason && r.status === "fail" ? { ...r, status: "pass" as const, detail: `known failure (${reason}): ${r.detail ?? ""}` } : r);

  const statuses = assertions.map((x) => x.status);
  const status = statuses.some((s) => s === "fail" || s === "error") ? "fail" : statuses.includes("pass") ? "pass" : "skipped";
  const extra = await turnsAndDecisions(db, userIds, sessionStarts);
  return { name: script.name, status, assertions, annotations, meta, trace: { transcripts: results, memory: await memoryDump(db, userIds), ...extra } };
}
