import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { handleUserMessage } from "@/core/chat/handle-user-message";
import { ConflictError, InputError, ReplyFailedError } from "@/core/errors";
import { listTurns } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
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
    expect(deps.queue.jobs).toEqual([{ name: "cold_path", data: { userId: u, turnIds: [turns[0]!.id, turns[1]!.id] } }]);
  });

  test("prompt carries the persona and the conversation, starting with a user turn", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await handleUserMessage(deps, u, msg("first"));
    deps.clock.advance(60_000);
    await handleUserMessage(deps, u, msg("second"));
    const call = deps.llm.calls[1]!;
    expect(call.system).toMatch(/at most one or two/i);
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
});
