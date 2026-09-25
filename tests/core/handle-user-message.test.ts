import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { handleUserMessage } from "@/core/chat/handle-user-message";
import { ConflictError, InputError, ReplyFailedError } from "@/core/errors";
import { fallbackLine } from "@/core/guard/fallback";
import { messageToCheck } from "@/core/guard/guard";
import { insertFact } from "@/db/repos/facts";
import { listJudgeLogs } from "@/db/repos/judge-log";
import { listTurns } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const msg = (text: string, id = randomUUID()) => ({ clientMessageId: id, text });

describe("handleUserMessage", () => {
  test("round trip stores both turns, links reply_to, enqueues cold path", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.replies.push("hey!\n\nhow was your day?");
    const input = msg("hi there");
    const r = await handleUserMessage(deps, u, input);

    expect(r.parts).toEqual(["hey!", "how was your day?"]);
    expect(r.crisisCard).toBeNull();
    const turns = await listTurns(getTestDb(), u);
    expect(turns.map((t) => [t.role, t.text, t.extracted])).toEqual([
      ["user", "hi there", false],
      ["companion", "hey!\n\nhow was your day?", false],
    ]);
    expect(turns[0]!.id).toBe(input.clientMessageId);
    expect(turns[1]!.reply_to).toBe(input.clientMessageId);
    expect(turns[1]!.session_id).toBe(turns[0]!.session_id);
    expect(turns[1]!.safety_flag).toEqual({ flagged: false, category: "none", source: "classifier" });
    expect(deps.queue.jobs).toEqual([{ name: "cold_path", data: {
      userId: u, turnIds: [turns[0]!.id, turns[1]!.id], replyTurnId: turns[1]!.id, recalled: [],
    } }]);
  });

  test("prompt carries the persona and the conversation, starting with a user turn", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await handleUserMessage(deps, u, msg("first"));
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, msg("second"));
    const call = deps.llm.calls[1]!;
    expect(call.system).toMatch(/at most one or two/i);
    expect(call.system).toMatch(/You are Spica/);
    expect(call.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(call.messages.at(-1)!.content).toBe("second");
  });

  test("retry with the same id does not duplicate turns or regenerate", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const input = msg("hello");
    const a = await handleUserMessage(deps, u, input);
    const b = await handleUserMessage(deps, u, input);
    expect(b.turnId).toBe(a.turnId);
    expect(deps.llm.calls).toHaveLength(1);
    expect(await listTurns(getTestDb(), u)).toHaveLength(2);
  });

  test("reply failure keeps the user turn; retry then succeeds", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.failReplies = 1;
    const input = msg("hello");
    await expect(handleUserMessage(deps, u, input)).rejects.toBeInstanceOf(ReplyFailedError);
    expect((await listTurns(getTestDb(), u)).map((t) => t.role)).toEqual(["user"]);
    await handleUserMessage(deps, u, input);
    expect((await listTurns(getTestDb(), u)).map((t) => t.role)).toEqual(["user", "companion"]);
  });

  test("session splits after the idle gap", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await handleUserMessage(deps, u, msg("one"));
    deps.clock.advance(30 * 60_000);
    await handleUserMessage(deps, u, msg("two"));
    deps.clock.advance(30 * 60_000 + 1);
    await handleUserMessage(deps, u, msg("three"));
    const users = (await listTurns(getTestDb(), u)).filter((t) => t.role === "user");
    expect(users[0]!.session_id).toBe(users[1]!.session_id);
    expect(users[2]!.session_id).not.toBe(users[1]!.session_id);
  });

  test("crisis flag attaches the card and is stored", async () => {
    const deps = makeTestDeps();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    const u = await createTestUser();
    const r = await handleUserMessage(deps, u, msg("I don't want to be here anymore"));
    expect(r.crisisCard?.lines.length).toBeGreaterThan(0);
    const [, companion] = await listTurns(getTestDb(), u);
    expect(companion!.safety_flag).toEqual({ flagged: true, category: "self_harm", source: "classifier" });
  });

  test("crisis + reply failure: the error still carries the crisis card", async () => {
    const deps = makeTestDeps();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.failReplies = 1;
    const u = await createTestUser();
    const err = await handleUserMessage(deps, u, msg("I want to end my life")).catch((e) => e);
    expect(err).toBeInstanceOf(ReplyFailedError);
    expect((err as ReplyFailedError).crisisCard?.lines.length).toBeGreaterThan(0);
  });

  test("enqueue failure does not fail the reply", async () => {
    const deps = makeTestDeps();
    deps.queue.failNext = true;
    const u = await createTestUser();
    await expect(handleUserMessage(deps, u, msg("hi"))).resolves.toMatchObject({ parts: expect.any(Array) });
  });

  test("rejects empty and oversized input", async () => {
    const deps = makeTestDeps({ chat: { max_message_chars: 10 } });
    const u = await createTestUser();
    await expect(handleUserMessage(deps, u, msg("   "))).rejects.toBeInstanceOf(InputError);
    await expect(handleUserMessage(deps, u, msg("x".repeat(11)))).rejects.toBeInstanceOf(InputError);
    expect(await listTurns(getTestDb(), u)).toEqual([]);
  });

  test("cross-user id collision: 409, first user's turn untouched and unread", async () => {
    const deps = makeTestDeps();
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    const id = randomUUID();
    await handleUserMessage(deps, a, msg("a's private message", id));
    await expect(handleUserMessage(deps, b, msg("b's message", id))).rejects.toBeInstanceOf(ConflictError);
    expect((await listTurns(getTestDb(), a))[0]!.text).toBe("a's private message");
    expect(await listTurns(getTestDb(), b)).toEqual([]);
  });

  test("review I1: retrying an older failed message ends the prompt at that message", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const a = msg("message A");
    deps.llm.failReplies = 1;
    await expect(handleUserMessage(deps, u, a)).rejects.toBeInstanceOf(ReplyFailedError);
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, msg("message B"));
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, a); // retry A after B was answered
    const call = deps.llm.calls.at(-1)!;
    expect(call.messages.at(-1)).toEqual({ role: "user", content: "message A" });
    expect(call.messages.map((m) => m.content)).not.toContain("message B");
  });

  test("review I4: a hung queue cannot delay the reply past the enqueue timeout", async () => {
    const base = makeTestDeps({ queue: { enqueue_timeout_ms: 50 } });
    const deps = { ...base, queue: { enqueue: () => new Promise<void>(() => {}) } };
    const u = await createTestUser();
    const started = Date.now();
    await expect(handleUserMessage(deps, u, msg("hi"))).resolves.toMatchObject({ parts: expect.any(Array) });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("review I3: the crisis classifier sees recent context, not just the latest message", async () => {
    const deps = makeTestDeps();
    const seen: string[] = [];
    deps.llm.classify = (input: string) => { seen.push(input); return { flag: false, category: "none" }; };
    const u = await createTestUser();
    deps.llm.replies.push("are you thinking about hurting yourself?");
    await handleUserMessage(deps, u, msg("i can't do this anymore"));
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, msg("yes, tonight"));
    const last = seen.at(-1)!;
    expect(last).toContain("are you thinking about hurting yourself?");
    expect(last).toContain("i can't do this anymore");
    expect(last).toMatch(/Message to judge:\s*yes, tonight$/);
  });

  test("concurrent double submit yields exactly one companion reply", async () => {
    const deps = makeTestDeps();
    deps.llm.replyDelayMs = 20;
    const u = await createTestUser();
    const input = msg("hello");
    const [x, y] = await Promise.all([handleUserMessage(deps, u, input), handleUserMessage(deps, u, input)]);
    expect(x.turnId).toBe(y.turnId);
    const turns = await listTurns(getTestDb(), u);
    expect(turns.filter((t) => t.role === "companion")).toHaveLength(1);
    expect(turns.filter((t) => t.role === "user")).toHaveLength(1);
  });

  test("retrieved memories and the gap line reach the prompt; recalled ids ride the cold-path job", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await insertFact(getTestDb(), u, {
      subject: "user", kind: "trait", content: "The user's dog is called Biscuit.", embedding: vec(),
      created_at: new Date("2026-01-01T09:00:00Z"), status: "open", salience: 0.9, valence: 0.5, confidence: 1, source: "turn",
    });
    await handleUserMessage(deps, u, msg("first"));
    deps.clock.advance(8 * 86_400_000);
    await handleUserMessage(deps, u, msg("hey again"));
    const system = deps.llm.calls.at(-1)!.system;
    expect(system).toContain("The user's dog is called Biscuit.");
    expect(system).toContain("You last talked 8 days ago.");
    const job = deps.queue.jobs.at(-1)!.data;
    expect(job.recalled!.length).toBeGreaterThan(0);
  });

  test("user B's prompts never contain user A's facts", async () => {
    const deps = makeTestDeps();
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    await insertFact(getTestDb(), a, {
      subject: "user", kind: "trait", content: "Alice's cat is called Biscuit.", embedding: vec(),
      created_at: new Date("2026-01-01T09:00:00Z"), status: "open", salience: 1, valence: 0, confidence: 1, source: "turn",
    });
    await handleUserMessage(deps, b, msg("what's a good cat name"));
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Biscuit");
  });

  test("an embedder failure still produces a reply", async () => {
    const base = makeTestDeps();
    const deps = { ...base, embedder: { dimensions: 1024, embed: async () => { throw new Error("voyage down"); } } };
    const u = await createTestUser();
    await expect(handleUserMessage(deps, u, msg("hi"))).resolves.toMatchObject({ parts: expect.any(Array) });
  });

  test("valid timezone is stored; invalid one is ignored", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await handleUserMessage(deps, u, { ...msg("hi"), timezone: "Mars/Olympus" });
    expect(await getTimezone(getTestDb(), u)).toBeNull();
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, { ...msg("hi again"), timezone: "Europe/London" });
    expect(await getTimezone(getTestDb(), u)).toBe("Europe/London");
  });

  test("guard sees the user message, memories and onboarding facts; a flagged reply is regenerated and stored", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await insertFact(getTestDb(), u, {
      subject: "user", kind: "preference", content: "The user drinks a lot of coffee.", embedding: vec(),
      created_at: new Date("2026-01-01T00:00:00Z"), status: "open", salience: 0.5, valence: 0, confidence: 0.6, source: "onboarding",
    });
    const inputs: string[] = [];
    deps.llm.handlers.guard = (i) => {
      inputs.push(String(i));
      return messageToCheck(String(i)).includes("again")
        ? { violations: [{ category: "false_familiarity", claim: "presumes the role" }] } : { violations: [] };
    };
    deps.llm.replies.push("what's the role again?", "congrats!! what's the role?");
    const r = await handleUserMessage(deps, u, msg("got the job!!"));

    expect(r.text).toBe("congrats!! what's the role?");
    expect(inputs[0]).toMatch(/User: got the job!!/);
    expect(inputs[0]).toMatch(/drinks a lot of coffee/);
    expect(deps.llm.calls[1]!.system).toMatch(/stopped before it was sent/);
    const turns = await listTurns(getTestDb(), u);
    expect(turns[1]!.text).toBe("congrats!! what's the role?");
    const job = deps.queue.jobs[0]!.data as { replyTurnId: string };
    expect(job.replyTurnId).toBe(turns[1]!.id);
    const logs = (await listJudgeLogs(getTestDb(), u)).reverse();
    expect(logs.map((l) => [l.attempt, l.outcome, l.turn_id])).toEqual([[1, null, turns[0]!.id], [2, "regenerated", turns[0]!.id]]);
  });

  test("crisis turn uses the crisis rubric; a double harm flag sends the crisis fallback with the resources card", async () => {
    const deps = makeTestDeps();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.handlers.guard_crisis = () => ({ violations: [{ category: "harm", claim: "minimises" }] });
    const u = await createTestUser();
    const input = msg("i don't want to be here anymore");
    const r = await handleUserMessage(deps, u, input);
    expect(deps.llm.structuredCalls.some((c) => c.purpose === "guard")).toBe(false);
    expect(r.text).toBe(fallbackLine(deps.config, "crisis_reply", input.clientMessageId));
    expect(r.crisisCard).not.toBeNull();
  });

  test("crisis turn with the guard down still replies with the resources card", async () => {
    const deps = makeTestDeps();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.handlers.guard_crisis = () => { throw new Error("overloaded"); };
    deps.llm.replies.push("I'm here with you. Are you safe right now?");
    const u = await createTestUser();
    const r = await handleUserMessage(deps, u, msg("i want to end it"));
    expect(r.text).toBe("I'm here with you. Are you safe right now?");
    expect(r.crisisCard).not.toBeNull();
    expect((await listJudgeLogs(getTestDb(), u))[0]!.outcome).toBe("guard_unavailable");
  });

  test("retrying an answered message makes no new guard calls", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const input = msg("hello");
    await handleUserMessage(deps, u, input);
    const guardCalls = deps.llm.structuredCalls.filter((c) => c.purpose === "guard").length;
    await handleUserMessage(deps, u, input);
    expect(deps.llm.structuredCalls.filter((c) => c.purpose === "guard").length).toBe(guardCalls);
  });
});
