/**
 * The cold path announces the facts it wrote and the params that moved, after its commit and
 * once; a module that throws changes nothing it wrote. The daily tick announces moved params, unless the user ended it.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import {
  ensureRelationship,
  getParams,
  getRelationshipRow,
  saveRelationship,
  toRelationshipState,
} from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import type { Module } from "@/mind/platform/modules";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { movedParams } from "@/mind/state/user/relationship/update";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const BISCUIT = 'dog Biscuit — the user said "my dog is called Biscuit"';

function setup(modules: Module[]) {
  const deps = makeTestDeps({}, modules);
  Object.assign(
    deps.llm.handlers,
    scriptedLabels({
      memories: [
        { said: "dog is called", label: "dog Biscuit", kind: "trait", salience: 0.5, valence: 0.5 },
      ],
    }),
  );
  return deps;
}

async function exchange(userId: string, at: Date) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "my dog is called Biscuit",
    created_at: at,
  });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "Biscuit!",
    created_at: at,
    reply_to: ut.id,
  });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

test("the new fact and the moved params are announced once, after commit", async () => {
  const rec = recordingModule();
  const deps = setup([rec.module]);
  const u = await createTestUser("Sam");
  const job = await exchange(u, deps.clock.now());
  await runColdPath(deps, job);
  const [row] = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, BISCUIT)));
  expect(rec.of("fact.written")).toEqual([
    { type: "fact.written", userId: u, factId: row!.id, kind: "trait" },
  ]);
  const [changed] = rec.of("relationship.changed");
  expect(changed).toMatchObject({ type: "relationship.changed", userId: u });
  expect(changed!.params.length).toBeGreaterThan(0);

  // A retried job finds the turns extracted and announces nothing new.
  const before = rec.events.length;
  expect((await runColdPath(deps, job)).status).toBe("skipped");
  expect(rec.events).toHaveLength(before);
});

test("a module that throws changes nothing the cold path wrote", async () => {
  const boom: Module = {
    name: "boom",
    scope: "user",
    on: {
      "fact.written": async () => {
        throw new Error("boom");
      },
      "relationship.changed": async () => {
        throw new Error("boom");
      },
    },
  };
  const deps = setup([boom]);
  const u = await createTestUser("Sam");
  expect((await runColdPath(deps, await exchange(u, deps.clock.now()))).status).toBe("done");
  const rows = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, BISCUIT)));
  expect(rows).toHaveLength(1);
});

test("movedParams names exactly the params whose value changed", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser("Sam");
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  const params = await getParams(deps.db, u);
  expect(movedParams(params, params)).toEqual([]);
  const after = { ...params, trust: { ...params.trust, value: params.trust.value + 0.1 } };
  expect(movedParams(params, after)).toEqual(["trust"]);
});

test("the daily tick announces what moved, once per day", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser("Sam");
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  const later = new Date("2026-01-08T12:00:00Z");
  const before = await getParams(deps.db, u);
  await tickUser(deps, u, later);
  const moved = movedParams(before, await getParams(deps.db, u));
  expect(moved.length).toBeGreaterThan(0);
  const expected = moved.length ? [{ type: "relationship.changed", userId: u, params: moved }] : [];
  expect(rec.of("relationship.changed")).toEqual(expected);
  await tickUser(deps, u, later);
  expect(rec.of("relationship.changed")).toEqual(expected);
});

test("the daily tick announces nothing once the user has ended it", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser("Sam");
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  const state = toRelationshipState((await getRelationshipRow(deps.db, u))!);
  await saveRelationship(deps.db, u, {
    state: { ...state, status: "ended_by_user", ended_at: deps.clock.now() },
    params: await getParams(deps.db, u),
  });
  const before = await getParams(deps.db, u);
  await tickUser(deps, u, new Date("2026-01-08T12:00:00Z"));
  expect(movedParams(before, await getParams(deps.db, u)).length).toBeGreaterThan(0);
  expect(rec.of("relationship.changed")).toEqual([]);
});
