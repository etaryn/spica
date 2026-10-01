import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { runBackchannel } from "@/core/turn/reply";
import { mutateState } from "@/core/turn/state";
import { insertTurn, listTurns } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T10:30:20Z");
const blockStart = "2026-01-05T10:00:00.000Z";

async function setup(deferredUntil: Date | null) {
  const deps = makeTestDeps();
  deps.clock.set(now);
  const u = await createTestUser();
  const t = await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "you around?",
    created_at: new Date("2026-01-05T10:30:00Z"),
  });
  await mutateState(deps.db, u, now, (_s) => ({
    patch: {
      buffer_turn_ids: [t.id],
      buffer_version: 1,
      deferred_until: deferredUntil,
      updated_at: now,
    },
    result: null,
  }));
  const job = {
    userId: u,
    version: 1,
    text: "",
    turnId: t.id,
    trigger: "availability" as const,
    blockKind: "busy" as const,
    blockStart,
  };
  return { deps, u, job };
}

test("sends one note while the deferral is pending, stored as availability, never a memory", async () => {
  const { deps, u, job } = await setup(new Date("2026-01-05T10:50:00Z"));
  expect(await runBackchannel(deps, job)).toBe("sent");
  const note = (await listTurns(deps.db, u)).find((t) => t.trigger === "availability")!;
  expect(note).toMatchObject({ role: "companion", reply_to: null, extracted: true });
  expect(deps.pusher.pushes.filter((p) => p.msg.tag === note.id)).toHaveLength(1);
  expect(await runBackchannel(deps, job)).toBe("skipped"); // once per block
});

test("skipped when the deferral already ended or was cleared (e.g. by a crisis)", async () => {
  const { deps, job } = await setup(null);
  expect(await runBackchannel(deps, job)).toBe("skipped");
});

test("a newer message in the same deferred buffer doesn't cancel the note", async () => {
  const { deps, job } = await setup(new Date("2026-01-05T10:50:00Z"));
  expect(await runBackchannel(deps, { ...job, version: 0 })).toBe("sent");
});
