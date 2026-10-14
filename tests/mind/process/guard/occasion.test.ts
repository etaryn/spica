/**
 * Once per occasion: her absence remark counts once per return, her callback once per hurt, and
 * the guard is told what's already used.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship } from "@/db/schema";
import { renderGuardInput } from "@/mind/process/guard/guard";
import { usedOnOccasion } from "@/mind/process/guard/occasion";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const at = (h: number) => new Date(new Date("2026-01-05T09:00:00Z").getTime() + h * H);

async function turn(
  d: ReturnType<typeof makeTestDeps>,
  u: string,
  role: "user" | "companion",
  h: number,
  pointed: "absence_remark" | "callback" | null = null,
  trigger: "reach_out" | null = null,
) {
  await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role,
    text: role === "user" ? "hey" : "hi",
    created_at: at(h),
    pointed,
    trigger,
  });
}

test("a user with one message has no return, so nothing is used", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  expect(await usedOnOccasion(d, u, "reply")).toEqual([]);
});

test("an absence remark is used for the rest of this return, and a new return frees it", async () => {
  const d = makeTestDeps(); // default median gap 24h, grace 2: absent after 48h
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  await turn(d, u, "user", 100); // a return
  await turn(d, u, "companion", 100.1, "absence_remark");
  await turn(d, u, "user", 101);
  expect(await usedOnOccasion(d, u, "reply")).toEqual(["absence_remark"]);

  await turn(d, u, "user", 200); // a second return
  expect(await usedOnOccasion(d, u, "reply")).toEqual([]);
});

test("a reach-out during an absence uses that absence; their return opens a new one", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  await turn(d, u, "companion", 60, "absence_remark", "reach_out"); // "did I do something?"
  expect(await usedOnOccasion(d, u, "reach_out")).toEqual(["absence_remark"]);
  await turn(d, u, "user", 70); // back
  expect(await usedOnOccasion(d, u, "reply")).toEqual([]);
});

test("a callback is used until a new hurt", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  await ensureRelationship(d.db, u, at(0), d.config.relationship);
  await d.db
    .update(relationship)
    .set({ last_hurt_at: at(1) })
    .where(eq(relationship.user_id, u));
  await turn(d, u, "companion", 2, "callback");
  expect(await usedOnOccasion(d, u, "reply")).toEqual(["callback"]);
  await d.db
    .update(relationship)
    .set({ last_hurt_at: at(3) })
    .where(eq(relationship.user_id, u));
  expect(await usedOnOccasion(d, u, "reply")).toEqual([]);
});

test("the guard input carries the line, and crisis replies don't", () => {
  const base = { text: "x", recentTurns: [], recalledFacts: [], onboardingFacts: [] };
  expect(
    renderGuardInput({ ...base, kind: "reply", usedOnOccasion: ["absence_remark"] }),
  ).toContain("ALREADY USED ON THIS OCCASION:\n- absence remark");
  expect(renderGuardInput({ ...base, kind: "reply", usedOnOccasion: [] })).toContain(
    "ALREADY USED ON THIS OCCASION:\n- (nothing)",
  );
  expect(renderGuardInput({ ...base, kind: "crisis_reply" })).not.toContain("ALREADY USED");
});

test("her remark from the last conversation doesn't use up the silence that followed it", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  await turn(d, u, "user", 100); // back
  await turn(d, u, "companion", 100.1, "absence_remark"); // "oh, so you're alive"
  // Then days of silence: a reach-out speaks into a new absence.
  expect(await usedOnOccasion(d, u, "reach_out")).toEqual([]);
});
