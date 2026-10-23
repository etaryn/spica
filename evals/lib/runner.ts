import { createCoreLayer } from "@/db/repos/core";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, eq, inArray, notInArray } from "drizzle-orm";
import { SimClock } from "@/mind/platform/clock";
import { deepMerge, loadConfig, type Config } from "@/mind/platform/config";
import { coreDepsOf, type Deps } from "@/mind/platform/deps";
import { RecordingPusher } from "@/mind/platform/push";
import { FakeEmbedder } from "@/mind/platform/embedder/fake";
import type { Embedder } from "@/mind/platform/embedder/types";
import { RecordingEventBus } from "@/mind/platform/events";
import type { LLMProvider } from "@/mind/platform/llm/types";
import { silentLogger } from "@/mind/platform/log";
import { createModuleBus } from "@/mind/platform/modules";
import { seedCore } from "@/mind/memory/core/seed";
import { decayPass } from "@/mind/memory/user/decay";
import { RecordingQueue } from "@/mind/platform/jobs";
import type { Signals } from "@/mind/state/user/relationship/signals";
import { relationshipDailyTick } from "@/mind/state/user/relationship/daily-tick";
import { crisisCardFor } from "@/mind/process/crisis/classifier";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { insertUserRow, truncateAll } from "@/db/admin";
import type { Db } from "@/db/client";
import { insertFact } from "@/db/repos/user/facts";
import { guardOutcomes, listJudgeLogs } from "@/db/repos/user/judge-log";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn, listTurns } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import {
  core_loop_trace,
  entity,
  fact,
  relationship,
  relationship_param,
  thread,
} from "@/db/schema";
import { stateChecks, type TurnResult } from "./checks";
import {
  judgeConsistency,
  judgeFalseRecall,
  judgeRecall,
  judgeReplyAbout,
  type Line,
  type TimedSession,
} from "./judged";
import { checkCore, checkLife, coreHistory, lifeSnapshot, type LifeSnapshot } from "./core-check";
import { makeLifeLoop } from "./life-loop";
import { checkReachOut, outreachSnapshot, type OutreachSnapshot } from "./outreach-check";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { RecordingLLM, type CoreCall } from "./recording-llm";
import type { VoiceCall } from "./voice-report";
import { checkRelationship, relationshipSnapshot, type RelSnapshot } from "./relationship-check";
import { drainUserMind, runAllJobs, runDueJobs } from "./scheduler";
import { DEFERRED, parseAt, turnText, type Profile, type Script } from "./script";
import { SignalLLM } from "./signal-llm";
import { checkTurn } from "./turn-check";
import { DAY, HOUR } from "@/mind/platform/time";

export type AssertionResult = {
  type: string;
  check?: string;
  user?: string;
  status: "pass" | "fail" | "skipped" | "error";
  detail?: string;
  /** `turn` and `relationship` assertions only: `majority` passes on a majority of runs instead of every run. */
  gate?: "every" | "majority";
};
/** A judged review note: never part of status or the exit code. */
export type Annotation = {
  type: string;
  user: string;
  verdict: "yes" | "no" | "n/a";
  detail?: string;
};
export type ScriptResult = {
  name: string;
  status: "pass" | "fail" | "skipped" | "error";
  assertions: AssertionResult[];
  error?: string;
  annotations: Annotation[];
  /** `ungroundedClaims`: her life and opinion claims core didn't back, across every user. */
  meta: { decayPasses: number; ticks: number; lifeHours: number; ungroundedClaims: number };
  /** Debugging and review dump (transcripts, turns, decisions, final memory state, error causes). */
  trace?: RunTrace;
};
/** One session_log row, with the script session it fell in. */
export type TraceTurn = {
  id: string;
  session: number;
  created_at: Date;
  role: "user" | "companion";
  trigger: string | null;
  text: string;
  reply_to: string | null;
};
/** One judge_log row (turn judge or guard). */
export type TraceDecision = {
  kind: string;
  turn_id: string | null;
  source: string;
  outcome: string | null;
  output: unknown;
  /** Guard rows: what was checked (`reply`, `crisis_reply`, `backchannel`). */
  for?: string;
};
export type RunTrace = {
  transcripts: Record<string, TurnResult[]>;
  memory: Record<string, { facts: unknown[]; threads: unknown[]; entities: unknown[] }>;
  turns?: Record<string, TraceTurn[]>;
  decisions?: Record<string, TraceDecision[]>;
  errorChain?: string[];
  /** Per user, per session (index = session − 1): the relationship snapshot right after that session. */
  relationship?: Record<string, (RelSnapshot | null)[]>;
  /** Her world (shared by every user) at the end of a script with a `life` key. */
  life?: LifeSnapshot;
  /** Per user: the outreach snapshot at the end of a script with an `outreach` key, for review. */
  outreach?: Record<string, OutreachSnapshot>;
  /** Every core loop run, oldest first, for a script with a `life` key. */
  coreTraces?: CoreTrace[];
  /** Every core-loop model call (prompt input and parsed output), in order. */
  coreCalls?: CoreCall[];
  /** Per user: every reply prompt and draft, for the voice report. */
  voice?: Record<string, VoiceCall[]>;
};
export type CoreTrace = Pick<
  typeof core_loop_trace.$inferSelect,
  | "loop"
  | "status"
  | "calls"
  | "model"
  | "prompt_version"
  | "inputs"
  | "outputs"
  | "error"
  | "created_at"
>;

async function coreTraceDump(db: Db): Promise<CoreTrace[]> {
  const t = core_loop_trace;
  return db
    .select({
      loop: t.loop,
      status: t.status,
      calls: t.calls,
      model: t.model,
      prompt_version: t.prompt_version,
      inputs: t.inputs,
      outputs: t.outputs,
      error: t.error,
      created_at: t.created_at,
    })
    .from(t)
    .orderBy(asc(t.created_at));
}

async function ungroundedClaims(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(fact)
    .where(
      and(
        eq(fact.subject, "self"),
        inArray(fact.claim_kind, ["life", "opinion"]),
        eq(fact.grounded, false),
      ),
    );
  return row?.n ?? 0;
}

function errorChain(e: unknown): string[] {
  const out: string[] = [];
  for (let cur = e, depth = 0; cur instanceof Error && depth < 5; cur = cur.cause, depth++)
    out.push(`${cur.name}: ${cur.message}`);
  return out;
}

async function memoryDump(db: Db, userIds: Record<string, string>): Promise<RunTrace["memory"]> {
  const out: RunTrace["memory"] = {};
  for (const [key, id] of Object.entries(userIds)) {
    out[key] = {
      facts: await db
        .select({
          subject: fact.subject,
          kind: fact.kind,
          content: fact.content,
          status: fact.status,
          salience: fact.salience,
          created_at: fact.created_at,
          recall_count: fact.recall_count,
          thread_id: fact.thread_id,
          payload: fact.payload,
        })
        .from(fact)
        .where(eq(fact.user_id, id)),
      threads: await db
        .select({
          id: thread.id,
          title: thread.title,
          status: thread.status,
          stakes: thread.stakes,
          next_checkpoint: thread.next_checkpoint,
          last_touched: thread.last_touched,
          opened_at: thread.opened_at,
        })
        .from(thread)
        .where(eq(thread.user_id, id)),
      entities: await db
        .select({
          name: entity.name,
          aliases: entity.aliases,
          subject: entity.subject,
          relation: entity.relation,
          salience: entity.salience,
        })
        .from(entity)
        .where(eq(entity.user_id, id)),
    };
  }
  return out;
}

export interface RunOptions {
  db: Db;
  dbUrl: string;
  config: Config;
  makeLlm: () => LLMProvider;
  embedder?: Embedder;
  /** This run has a real reply model, so `mode: real` scripts may run. */
  real: boolean;
  /** Run the judged review annotations (`recall`, `no_false_recall`, `consistency`, `reply_about`). */
  annotate: boolean;
  /** Onboarding profiles by name; scripts default to "basic". Omitted = every user starts cold. */
  profiles?: Record<string, Profile>;
  /** This run's turn judge is real (`--real turn_judge` or `--llm=real`): `fake_known_failure` no longer masks a failing `turn` assertion. Default false. */
  turnJudgeReal?: boolean;
  /** This run's extract purpose is real (`--real extract` or `--llm=real`): a script's `signal_source: "model"` then skips SignalLLM. Default false. */
  extractReal?: boolean;
  /** This run's real purposes, for `needs_real`. */
  realPurposes?: ReadonlySet<string>;
}

async function seedProfile(deps: Deps, userId: string, profile: Profile, at: Date): Promise<void> {
  const vectors = await deps.embedder.embed(
    profile.facts.map((f) => f.content),
    "document",
  );
  for (const [i, f] of profile.facts.entries()) {
    await insertFact(deps.db, userId, {
      subject: "user",
      kind: f.kind,
      content: f.content,
      embedding: vectors[i]!,
      created_at: at,
      status: "open",
      salience: profile.salience,
      valence: 0,
      confidence: profile.confidence,
      source: "onboarding",
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
  const hours = ms / HOUR;
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
      out.push({
        label: `Session ${out.length + 1}${prev ? `, ${elapsedLabel(start.getTime() - prev.getTime())}` : ""}`,
        lines: [],
      });
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
  starts.forEach((st, j) => {
    if (st && d >= st) idx = j;
  });
  return idx + 1;
}

async function turnsAndDecisions(db: Db, userIds: Record<string, string>, starts: Date[]) {
  const turns: Record<string, TraceTurn[]> = {};
  const decisions: Record<string, TraceDecision[]> = {};
  for (const [key, id] of Object.entries(userIds)) {
    turns[key] = (await listTurns(db, id)).map((t) => ({
      id: t.id,
      session: sessionOfAt(starts, t.created_at),
      created_at: t.created_at,
      role: t.role,
      trigger: t.trigger,
      text: t.text,
      reply_to: t.reply_to,
    }));
    decisions[key] = (await listJudgeLogs(db, id, 100_000)).reverse().map((d) => {
      const checked = (d.input as { kind?: unknown } | null)?.kind;
      return {
        kind: d.kind,
        turn_id: d.turn_id,
        source: d.source,
        outcome: d.outcome,
        output: d.output,
        ...(d.kind === "guard" && typeof checked === "string" ? { for: checked } : {}),
      };
    });
  }
  return { turns, decisions };
}

export async function runScript(script: Script, opts: RunOptions): Promise<ScriptResult> {
  const meta = { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 };
  if (script.mode === "real" && !opts.real) {
    return {
      name: script.name,
      status: "skipped",
      assertions: [],
      annotations: [],
      error: "needs real model calls (--llm=real or --real)",
      meta,
    };
  }
  const { db } = opts;
  // A script's `config:` is deep-merged over the run config and used everywhere in this run.
  const config: Config = script.config
    ? loadConfig(deepMerge(opts.config, script.config))
    : opts.config;
  await truncateAll(db, opts.dbUrl);

  const first = parseAt(script.sessions[0]!.at, null);
  const clock = new SimClock(first);
  const queue = new RecordingQueue();
  const baseLlm = opts.makeLlm();
  const byText = new Map<string, Partial<Signals>>();
  for (const s of script.sessions)
    for (const t of s.turns) {
      if (typeof t === "string" || !t.signals) continue;
      // SignalLLM matches on text alone: a repeated scripted text would be ambiguous about which
      // exchange's signals apply, so it's a script error rather than a silent "last one wins".
      if (byText.has(t.text)) {
        return {
          name: script.name,
          status: "error",
          assertions: [],
          annotations: [],
          error: `script error: scripted signals text "${t.text}" is used more than once`,
          meta,
        };
      }
      byText.set(t.text, t.signals);
    }
  // Scripted signals stand in for the extractor unless this run's extract is real and the script asks for the model's.
  const useScripted = byText.size > 0 && !(opts.extractReal && script.signal_source === "model");
  const recorder = new RecordingLLM(useScripted ? new SignalLLM(baseLlm, byText) : baseLlm);
  // The recorder sits inside, so it keeps the prompts as the model read them.
  const llm = withTimeRendering(recorder, clock, config.time.relative_max_days);
  const pusher = new RecordingPusher();
  const deps: Deps = {
    db,
    core: createCoreLayer(db, config.life.timezone),
    clock,
    config,
    queue,
    log: silentLogger,
    llm,
    embedder: opts.embedder ?? new FakeEmbedder(config.embedding.dimensions),
    events: new RecordingEventBus(),
    pusher,
    modules: createModuleBus([], () => deps),
    webSources: {},
  };
  await seedCore(coreDepsOf(deps));
  const lifeSnaps = async () => (script.life ? await lifeSnapshot(db) : undefined);
  const coreTraces = async () => (script.life ? await coreTraceDump(db) : undefined);

  const userIds: Record<string, string> = {};
  for (const key of userKeys(script)) {
    userIds[key] = await insertUserRow(db, {
      name: key,
      email: `${key}-${randomUUID()}@eval.local`,
      now: first,
    });
  }
  const lifeLoop = script.life
    ? makeLifeLoop(
        deps,
        clock,
        script.life,
        first,
        script.outreach
          ? { queue, script: script.outreach, userIds: () => Object.values(userIds) }
          : undefined,
      )
    : null;
  /** What the `reach_out` assertion reads for one user (sent turns, her blocks, endings, pushes, reach-out prompts). */
  const outreachSnap = (id: string) =>
    outreachSnapshot(
      db,
      id,
      {
        pushTags: pusher.pushes.filter((p) => p.userId === id).map((p) => p.msg.tag),
        composedPrompts: recorder.prompts.filter((p) => p.includes("## Why you're writing")).length,
      },
      config,
    );
  const outreachSnaps = async () =>
    script.outreach
      ? Object.fromEntries(
          await Promise.all(
            Object.entries(userIds).map(async ([k, id]) => [k, await outreachSnap(id)] as const),
          ),
        )
      : undefined;

  const results: Record<string, TurnResult[]> = {};
  const relSnaps: Record<string, (RelSnapshot | null)[]> = {};
  const lines: Record<string, SessionLine[]> = {};
  const prompts: Record<string, string[]> = {};
  const voice: Record<string, VoiceCall[]> = {};
  const sessionStarts: Date[] = [];
  const sessionOf = (d: Date) => sessionOfAt(sessionStarts, d);
  /** Runs `fn` and attributes the reply prompts it produced to `user`. */
  const recording = async (user: string, fn: () => Promise<unknown>) => {
    const before = recorder.prompts.length;
    const repliesBefore = recorder.replies.length;
    await fn();
    (prompts[user] ??= []).push(...recorder.prompts.slice(before));
    (voice[user] ??= []).push(...recorder.replies.slice(repliesBefore));
  };
  let known: string[] = [];
  try {
    if (opts.profiles && script.profile !== "none") {
      const profile = opts.profiles?.[script.profile];
      if (!profile) throw new Error(`profile "${script.profile}" not found in evals/profiles`);
      known = profile.facts.map((f) => f.content);
      for (const id of Object.values(userIds)) await seedProfile(deps, id, profile, first);
    }
    if (script.relationship_seed) {
      for (const id of Object.values(userIds)) {
        await ensureRelationship(db, id, first, config.relationship);
        for (const [name, value] of Object.entries(script.relationship_seed)) {
          await db
            .update(relationship_param)
            .set({ value, baseline: value, updated_at: first })
            .where(and(eq(relationship_param.user_id, id), eq(relationship_param.name, name)));
        }
        if (script.seed_hours_together !== undefined)
          await db
            .update(relationship)
            .set({ hours_together: script.seed_hours_together })
            .where(eq(relationship.user_id, id));
        // Seeded params with no history: let the stage be read from them, as for an old row.
        await db.update(relationship).set({ milestones: null }).where(eq(relationship.user_id, id));
      }
    }
    if (script.seed_core_memory.length) {
      // Her own past, once for everyone: episodes in her core memory, a day before day 0.
      const vectors = await deps.embedder.embed(script.seed_core_memory, "document");
      const before = new Date(first.getTime() - DAY);
      for (const [i, content] of script.seed_core_memory.entries()) {
        await deps.core.memory.insert({
          kind: "episode",
          content,
          embedding: vectors[i]!,
          occurred_at: before,
          created_at: before,
          status: "resolved",
          salience: 0.6,
          valence: 0,
          confidence: 1,
          source: "world",
          source_ref: "eval_seed",
        });
      }
    }
    if (script.seed_user_facts.length) {
      // User facts (and threads) that exist before day 0, as if the user had said them (outreach scripts).
      const before = new Date(first.getTime() - DAY);
      const vectors = await deps.embedder.embed(
        script.seed_user_facts.map((f) => f.content),
        "document",
      );
      for (const id of Object.values(userIds)) {
        for (const [i, f] of script.seed_user_facts.entries()) {
          const th = f.thread
            ? await insertThread(
                db,
                id,
                {
                  title: f.content,
                  subject: "user",
                  stakes: f.thread.stakes,
                  next_checkpoint: parseAt(f.thread.next_checkpoint, null),
                },
                before,
              )
            : null;
          await insertFact(db, id, {
            subject: "user",
            kind: f.kind,
            content: f.content,
            embedding: vectors[i]!,
            occurred_at: parseAt(f.occurred_at, null),
            created_at: before,
            status: "open",
            salience: f.salience,
            valence: 0,
            confidence: 1,
            source: "turn",
            payload: f.sensitive ? { sensitive: true } : null,
            thread_id: th?.id ?? null,
          });
        }
      }
    }
    // Idle users come after the seeds: they have no profile, relationship or facts.
    for (const key of script.idle_users) {
      userIds[key] = await insertUserRow(db, {
        name: key,
        email: `${key}-${randomUUID()}@eval.local`,
        now: first,
      });
    }
    await lifeLoop?.start();
    let prevStart: Date | null = null;
    // session_log.id is a global primary key, so a retry must reuse that same user's own last id, not another
    // user's (they'd collide on a row the retrying user doesn't own).
    const lastIdByUser: Record<string, string> = {};
    // The previous session's own end (its last turn/reply lands at or before this), for the seed-turn overlap guard below.
    let lastSessionEnd: Date | null = null;
    for (const [i, s] of script.sessions.entries()) {
      const start = parseAt(s.at, prevStart);
      if (start.getTime() < clock.now().getTime())
        throw new Error(`session "${s.at}" starts before the previous session ended`);
      // a session whose `at` advances the clock by N days (from the previous session's start) runs N decay passes.
      // Counted as calendar days (UTC; eval users are UTC), matching how the tick loop below anchors to
      // `prevMidnight`: a 24-hour count would under/over-count whenever a session doesn't start on the hour that
      // the previous one did (e.g. day 1 22:00 -> day 3 05:00 is 31 hours, rounding to 1, but crosses two
      // calendar-day boundaries and needs a tick on day 2 *and* day 3).
      const days = prevStart
        ? Math.floor(start.getTime() / DAY) - Math.floor(prevStart.getTime() / DAY)
        : 0;
      // Eval users are always UTC, so the tick's local date is just the UTC calendar date. Tick at
      // that date's `tick_local_hour`, not at the previous session's own clock-of-day: this
      // keeps the same calendar date ticked either way (only the hour-of-day changes), satisfies
      // `tickUser`'s local-hour gate regardless of what hour a script's sessions fall at, and still lands
      // before the next session start (every rel-* script starts at or after `tick_local_hour`).
      const prevMidnight = prevStart ? Math.floor(prevStart.getTime() / DAY) * DAY : 0;
      const tickHourMs = config.relationship.tick_local_hour * HOUR;
      for (let k = 1; k <= days; k++) {
        const at = prevMidnight + k * DAY + tickHourMs;
        // A tick due after this session's own start would either send the clock backwards (silently
        // undoing itself) or, clamped earlier, land below `tick_local_hour` and silently no-op — either
        // way the day's tick is lost. A script whose session starts before the day's tick is a script
        // error, not a runner bug to paper over.
        if (at > start.getTime()) {
          const hh = String(config.relationship.tick_local_hour).padStart(2, "0");
          throw new Error(
            `script error: session ${i + 1} starts at ${s.at}, before the day's tick at ${hh}:00; start sessions at or after tick_local_hour on a new day`,
          );
        }
        await lifeLoop?.advance(new Date(at));
        if (at > clock.now().getTime()) clock.set(new Date(at)); // never move the clock backwards
        await decayPass(deps, clock.now());
        meta.decayPasses += 1;
        const tick = await relationshipDailyTick(deps, clock.now());
        meta.ticks += 1;
        await drainUserMind(deps, queue);
        if (tick.failed > 0)
          throw new Error(`relationship tick failed for ${tick.failed} of ${tick.users} user(s)`);
      }
      await lifeLoop?.advance(start);
      clock.set(start);
      prevStart = start;
      sessionStarts[i] = start;
      const userId = userIds[s.user]!;
      if (s.seed_turns) {
        // Bulk user turns, before the session start so they count for that local day and need no reply.
        // They occupy the `count` minutes right before `at`, so a script must leave that much room since the
        // previous session's own last turn (and a start just after midnight spills seeds into the previous local day).
        const earliest = start.getTime() - s.seed_turns.count * 60_000;
        if (lastSessionEnd && earliest <= lastSessionEnd.getTime()) {
          throw new Error(
            `script error: session ${i + 1}'s seed turns would land at or before the previous session's last turn (leave more room before "${s.at}")`,
          );
        }
        const seedSession = randomUUID();
        for (let k = 0; k < s.seed_turns.count; k++) {
          await insertTurn(db, userId, {
            id: randomUUID(),
            session_id: seedSession,
            role: "user",
            text: s.seed_turns.text,
            created_at: new Date(start.getTime() - (s.seed_turns.count - k) * 60_000),
            extracted: true,
          });
        }
      }
      // Simulated turn scheduling: each message arrives at its scripted time; turn jobs due before
      // it run first (their pacing sleeps advance the clock, so a message due mid-reply arrives after it).
      let at = start.getTime();
      for (const [k, raw] of s.turns.entries()) {
        const text = turnText(raw);
        if (k > 0)
          at +=
            (typeof raw === "string"
              ? script.turn_gap_seconds
              : (raw.after_s ?? script.turn_gap_seconds)) * 1000;
        await recording(s.user, () => runDueJobs(deps, queue, clock, new Date(at)));
        if (clock.now().getTime() < at) clock.set(new Date(at));
        // A client retry (repeat_previous_id) re-POSTs the previous turn's id with the same text.
        const wantsRepeat = typeof raw !== "string" && raw.repeat_previous_id;
        if (wantsRepeat && !lastIdByUser[s.user]) {
          throw new Error(
            `script error: repeat_previous_id used for user "${s.user}" before that user sent any turn`,
          );
        }
        const id = wantsRepeat ? lastIdByUser[s.user]! : randomUUID();
        lastIdByUser[s.user] = id;
        // Replies are read back from session_log after the session.
        await recording(s.user, () => receiveMessage(deps, userId, { clientMessageId: id, text }));
      }
      // End of session: every pending reply lands.
      await recording(s.user, () => runAllJobs(deps, queue, clock));
      lastSessionEnd = clock.now();
      // Snapshot every user's relationship state as of this session, for `relationship` assertions.
      for (const key of Object.keys(userIds)) {
        (relSnaps[key] ??= [])[i] = await relationshipSnapshot(
          db,
          userIds[key]!,
          clock.now(),
          config.relationship,
        );
      }
    }
    if (script.life?.until) await lifeLoop!.advance(parseAt(script.life.until, prevStart));
    meta.lifeHours = lifeLoop?.hours ?? 0;
    meta.ungroundedClaims = await ungroundedClaims(db);
  } catch (e) {
    meta.lifeHours = lifeLoop?.hours ?? 0;
    // Collect as much of the run as possible for the trace.
    await collectResults().catch(() => undefined);
    const extra = await turnsAndDecisions(db, userIds, sessionStarts).catch(() => ({}));
    const trace = {
      transcripts: results,
      memory: await memoryDump(db, userIds).catch(() => ({})),
      ...extra,
      errorChain: errorChain(e),
      relationship: relSnaps,
      life: await lifeSnaps().catch(() => undefined),
      outreach: await outreachSnaps().catch(() => undefined),
      coreTraces: await coreTraces().catch(() => undefined),
      coreCalls: recorder.coreCalls,
      voice,
    };
    return {
      name: script.name,
      status: "error",
      assertions: [],
      annotations: [],
      error: (e as Error).message,
      meta,
      trace,
    };
  }

  /** Per-user results and transcript lines, read back from session_log. */
  async function collectResults(): Promise<void> {
    for (const [key, id] of Object.entries(userIds)) {
      const turns = await listTurns(db, id);
      const byId = new Map(turns.map((t) => [t.id, t]));
      const replies = turns.filter((t) => t.role === "companion" && t.reply_to);
      results[key] = turns
        .filter((t) => t.role === "user")
        .map((u) => {
          const own = replies.find((r) => r.reply_to === u.id) ?? null;
          const covering =
            replies.find((r) => byId.get(r.reply_to!)!.created_at >= u.created_at) ?? null;
          return {
            session: sessionOf(u.created_at),
            text: u.text,
            reply: own?.text ?? null,
            crisisCard: crisisCardFor(covering?.safety_flag, config),
            coveredBy: covering?.id ?? null,
          };
        });
      lines[key] = turns.map((t) => ({
        session: sessionOf(t.created_at),
        role: t.role,
        text: t.text,
      }));
    }
  }
  await collectResults();

  const transcript = (user: string, session?: number): Line[] =>
    (lines[user] ?? [])
      .filter((l) => session === undefined || l.session === session)
      .map(({ role, text }) => ({ role, text }));

  // Each deterministic result stays paired with its script entry, so known_failure applies to the right one.
  const checked: { reason?: string; result: AssertionResult }[] = [];
  const annotations: Annotation[] = [];
  const turnJudgeReal = opts.turnJudgeReal ?? false;
  for (const a of script.assertions) {
    // `fake_known_failure` only masks a failing `turn` assertion while the turn judge is fake — it must not
    // hide a genuine regression once the real judge is exercised (--real turn_judge or --llm=real).
    const reason =
      "known_failure" in a && typeof a.known_failure === "string"
        ? a.known_failure
        : a.type === "turn" && typeof a.fake_known_failure === "string" && !turnJudgeReal
          ? a.fake_known_failure
          : undefined;
    const push = (result: AssertionResult) => checked.push({ reason, result });
    try {
      if (a.type === "state") {
        const check = stateChecks[a.check];
        if (!check) {
          push({
            type: "state",
            check: a.check,
            user: a.user,
            status: "error",
            detail: `unknown check "${a.check}"`,
          });
          continue;
        }
        const actual = await check(
          {
            db,
            script,
            userKey: a.user,
            userId: userIds[a.user]!,
            results: results[a.user] ?? [],
            prompts: prompts[a.user] ?? [],
          },
          a.params,
        );
        const ok = isDeepStrictEqual(actual, a.expect);
        push({
          type: "state",
          check: a.check,
          user: a.user,
          status: ok ? "pass" : "fail",
          detail: ok
            ? undefined
            : `expected ${JSON.stringify(a.expect)}, got ${JSON.stringify(actual)}`,
        });
      } else if (
        a.type === "recall" ||
        a.type === "no_false_recall" ||
        a.type === "consistency" ||
        a.type === "reply_about"
      ) {
        // Judged entries are review annotations: never assertions, run only with annotate.
        if (!opts.annotate) continue;
        const note = (v: { pass: boolean; detail: string }) => {
          const detail = [reason ? `known failure (${reason})` : "", v.detail]
            .filter(Boolean)
            .join(": ");
          annotations.push({
            type: a.type,
            user: a.user,
            verdict: v.pass ? "yes" : "no",
            detail: detail || undefined,
          });
        };
        try {
          if (a.type === "reply_about") {
            // Reply N counts full replies only (reply_to set), not backchannels.
            const full = (await listTurns(db, userIds[a.user]!)).filter(
              (t) => t.role === "companion" && t.reply_to && sessionOf(t.created_at) === a.session,
            );
            const target = full[a.reply - 1];
            if (!target) {
              annotations.push({
                type: a.type,
                user: a.user,
                verdict: "n/a",
                detail: `no reply ${a.reply} in session ${a.session}`,
              });
              continue;
            }
            note(
              await retrying(1, () =>
                judgeReplyAbout(baseLlm, config, {
                  transcript: transcript(a.user, a.session),
                  reply: target.text,
                  about: a.about,
                  not_about: a.not_about,
                }),
              ),
            );
            continue;
          }
          const selfFacts =
            a.type === "consistency"
              ? (
                  await db
                    .select({ content: fact.content })
                    .from(fact)
                    .where(
                      and(
                        eq(fact.user_id, userIds[a.user]!),
                        eq(fact.subject, "self"),
                        notInArray(fact.status, ["superseded", "stale"]),
                      ),
                    )
                ).map((r) => r.content)
              : [];
          // One retry: a judge call can transiently return no parsed output.
          note(
            await retrying(1, () =>
              a.type === "recall"
                ? judgeRecall(baseLlm, config, {
                    fact: a.fact,
                    transcript: transcript(a.user, a.session),
                  })
                : a.type === "no_false_recall"
                  ? judgeFalseRecall(baseLlm, config, {
                      known,
                      sessions: timedSessions(lines[a.user] ?? [], sessionStarts),
                    })
                  : judgeConsistency(baseLlm, config, selfFacts),
            ),
          );
        } catch (e) {
          annotations.push({
            type: a.type,
            user: a.user,
            verdict: "n/a",
            detail: `judge error: ${(e as Error).message}`,
          });
        }
      } else if (a.type === "guard") {
        const counts: Record<string, number> = {};
        for (const o of await guardOutcomes(db, userIds[a.user]!)) counts[o] = (counts[o] ?? 0) + 1;
        const banned = a.outcome_not.filter((o) => (counts[o] ?? 0) > 0);
        const over = Object.entries(a.max).filter(([o, n]) => (counts[o] ?? 0) > (n ?? 0));
        const ok = banned.length === 0 && over.length === 0;
        push({
          type: "guard",
          user: a.user,
          status: ok ? "pass" : "fail",
          detail: ok ? undefined : `outcomes ${JSON.stringify(counts)}`,
        });
      } else if (a.type === "turn") {
        const i = a.session - 1;
        const start = sessionStarts[i];
        if (!start) throw new Error(`no session ${a.session}`);
        const range = { start, end: sessionStarts[i + 1] ?? new Date(8.64e15) };
        const r = checkTurn(await listTurns(db, userIds[a.user]!), range, a);
        push({
          type: "turn",
          user: a.user,
          status: r.ok ? "pass" : "fail",
          detail: r.detail,
          ...(a.gate ? { gate: a.gate } : {}),
        });
      } else if (a.type === "relationship") {
        if (a.after_session && !sessionStarts[a.after_session - 1])
          throw new Error(`no session ${a.after_session}`);
        const snaps = relSnaps[a.user] ?? [];
        const snap = (a.after_session ? snaps[a.after_session - 1] : snaps.at(-1)) ?? null;
        const r = checkRelationship(snap, a);
        push({
          type: "relationship",
          user: a.user,
          status: r.ok ? "pass" : "fail",
          detail: r.detail,
          ...(a.gate ? { gate: a.gate } : {}),
        });
      } else if (a.type === "life") {
        const missing = a.needs_real.filter((p) => !(opts.realPurposes?.has(p) ?? false));
        if (missing.length) {
          push({ type: "life", status: "skipped", detail: `needs real ${missing.join(", ")}` });
          continue;
        }
        const r = checkLife(await lifeSnapshot(db), a);
        push({ type: "life", status: r.ok ? "pass" : "fail", detail: r.detail });
      } else if (a.type === "core") {
        const r = checkCore(await coreHistory(db, config), a, (spec) => parseAt(spec, null));
        push({ type: "core", status: r.ok ? "pass" : "fail", detail: r.detail });
      } else if (a.type === "reach_out") {
        const r = checkReachOut(await outreachSnap(userIds[a.user]!), a, config);
        push({ type: "reach_out", user: a.user, status: r.ok ? "pass" : "fail", detail: r.detail });
      } else {
        // No deferred types remain; kept for later phases' reserved types.
        const type = (a as { type: string }).type;
        push({ type, status: "skipped", detail: `implemented in Phase ${DEFERRED[type]}` });
      }
    } catch (e) {
      push({ type: a.type, status: "error", detail: (e as Error).message });
    }
  }

  // Decided deferrals: a failing assertion marked known_failure is reported, not failed.
  const assertions = checked.map(({ reason, result: r }) =>
    reason && r.status === "fail"
      ? { ...r, status: "pass" as const, detail: `known failure (${reason}): ${r.detail ?? ""}` }
      : r,
  );

  const statuses = assertions.map((x) => x.status);
  const status = statuses.some((s) => s === "fail" || s === "error")
    ? "fail"
    : statuses.includes("pass")
      ? "pass"
      : "skipped";
  const extra = await turnsAndDecisions(db, userIds, sessionStarts);
  return {
    name: script.name,
    status,
    assertions,
    annotations,
    meta,
    trace: {
      transcripts: results,
      memory: await memoryDump(db, userIds),
      ...extra,
      relationship: relSnaps,
      life: await lifeSnaps(),
      outreach: await outreachSnaps(),
      coreTraces: await coreTraces(),
      coreCalls: recorder.coreCalls,
      voice,
    },
  };
}
