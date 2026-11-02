/** A user's receive, reply, guard and cold path all book their model calls to that user. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";
import type { LLMProvider } from "@/mind/platform/llm/types";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { composeReply } from "@/mind/process/hot-path/compose";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("every model call on a user's reply and cold path names that user; none leaks to the other", async () => {
  const d = makeTestDeps();
  Object.assign(d.llm.handlers, scriptedLabels({}));
  const seen: { purpose: string; userId?: string }[] = [];
  const spy: LLMProvider = {
    generateReply: (r) => {
      seen.push({ purpose: "reply", userId: r.userId });
      return d.llm.generateReply(r);
    },
    classifyJson: (r) => {
      seen.push({ purpose: r.purpose, userId: r.userId });
      return d.llm.classifyJson(r);
    },
  };
  const deps = { ...d, llm: spy };
  const [a, b] = [await createTestUser("a"), await createTestUser("b")];

  await receiveMessage(deps, a, { clientMessageId: randomUUID(), text: "hey, big week coming" });

  const session = randomUUID();
  const ut = await insertTurn(getTestDb(), a, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "i have a job interview on thursday",
    created_at: d.clock.now(),
  });
  const reply = await composeReply(deps, a, { turns: [ut], openQuestions: [], flag: null });
  const ct = await insertTurn(getTestDb(), a, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: reply.text,
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  await runColdPath(deps, {
    userId: a,
    turnIds: [ut.id, ct.id],
    replyTurnId: ct.id,
    recalled: [],
  });

  const purposes = seen.map((s) => s.purpose);
  expect(purposes).toEqual(
    expect.arrayContaining([
      "crisis",
      "turn_judge",
      "reply",
      "guard",
      "labels_read",
      "labels_meaning",
      "labels_signals",
    ]),
  );
  expect(seen.every((s) => s.userId === a)).toBe(true);
  expect(seen.some((s) => s.userId === b)).toBe(false);
});
