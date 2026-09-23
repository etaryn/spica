import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { handleUserMessage } from "@/core/chat/handle-user-message";
import { SimClock } from "@/core/clock";
import { handleColdPath } from "@/core/cold-path";
import type { Config } from "@/core/config";
import type { Deps } from "@/core/deps";
import { FakeEmbedder } from "@/core/embed/fake";
import type { LLMProvider } from "@/core/llm/types";
import { silentLogger } from "@/core/log";
import { RecordingQueue } from "@/core/queue";
import { insertUserRow, truncateAll } from "@/db/admin";
import type { Db } from "@/db/client";
import { stateChecks, type TurnResult } from "./checks";
import { DEFERRED, parseAt, type Script } from "./script";

export type AssertionResult = { type: string; check?: string; user?: string; status: "pass" | "fail" | "skipped" | "error"; detail?: string };
export type ScriptResult = { name: string; status: "pass" | "fail" | "skipped" | "error"; assertions: AssertionResult[]; error?: string };

export interface RunOptions { db: Db; dbUrl: string; config: Config; makeLlm: () => LLMProvider }

function userKeys(script: Script): string[] {
  const keys = new Set<string>(script.sessions.map((s) => s.user));
  for (const a of script.assertions) {
    if (a.type === "state") {
      keys.add(a.user);
      if (typeof a.params.other === "string") keys.add(a.params.other);
    }
  }
  return [...keys];
}

export async function runScript(script: Script, opts: RunOptions): Promise<ScriptResult> {
  const { db, config } = opts;
  await truncateAll(db, opts.dbUrl);

  const first = parseAt(script.sessions[0]!.at, null);
  const clock = new SimClock(first);
  const queue = new RecordingQueue();
  const deps: Deps = {
    db, clock, config, queue, log: silentLogger,
    llm: opts.makeLlm(),
    embedder: new FakeEmbedder(config.embedding.dimensions),
  };

  const userIds: Record<string, string> = {};
  for (const key of userKeys(script)) {
    userIds[key] = await insertUserRow(db, { name: key, email: `${key}-${randomUUID()}@eval.local`, now: first });
  }

  const results: Record<string, TurnResult[]> = {};
  try {
    let prevStart: Date | null = null;
    for (const s of script.sessions) {
      const start = parseAt(s.at, prevStart);
      if (start.getTime() < clock.now().getTime()) throw new Error(`session "${s.at}" starts before the previous session ended`);
      clock.set(start);
      prevStart = start;
      for (const text of s.turns) {
        const r = await handleUserMessage(deps, userIds[s.user]!, { clientMessageId: randomUUID(), text });
        (results[s.user] ??= []).push({ text, reply: r.text, crisisCard: r.crisisCard });
        for (const job of queue.drain()) await handleColdPath(deps, job.data);
        clock.advance(script.turn_gap_seconds * 1000);
      }
    }
  } catch (e) {
    return { name: script.name, status: "error", assertions: [], error: (e as Error).message };
  }

  const assertions: AssertionResult[] = [];
  for (const a of script.assertions) {
    if (a.type !== "state") {
      assertions.push({ type: a.type, status: "skipped", detail: `implemented in Phase ${DEFERRED[a.type]}` });
      continue;
    }
    const check = stateChecks[a.check];
    if (!check) {
      assertions.push({ type: "state", check: a.check, user: a.user, status: "error", detail: `unknown check "${a.check}"` });
      continue;
    }
    try {
      const actual = await check({ db, script, userKey: a.user, userId: userIds[a.user]!, results: results[a.user] ?? [] }, a.params);
      const ok = isDeepStrictEqual(actual, a.expect);
      assertions.push({
        type: "state", check: a.check, user: a.user, status: ok ? "pass" : "fail",
        detail: ok ? undefined : `expected ${JSON.stringify(a.expect)}, got ${JSON.stringify(actual)}`,
      });
    } catch (e) {
      assertions.push({ type: "state", check: a.check, user: a.user, status: "error", detail: (e as Error).message });
    }
  }

  const statuses = assertions.map((x) => x.status);
  const status = statuses.some((s) => s === "fail" || s === "error") ? "fail" : statuses.includes("pass") ? "pass" : "skipped";
  return { name: script.name, status, assertions };
}
