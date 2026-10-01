import { afterAll, beforeEach, expect, test } from "vitest";
import { egoTick, egoTickUser } from "@/mind/state/legacy-ego/tick";
import { insertFact } from "@/db/repos/facts";
import { getIdentityRow, updateIdentity, ensureIdentity } from "@/db/repos/identity";
import { ensureRelationship } from "@/db/repos/relationship";
import { ego_tick } from "@/db/schema";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const H = 3_600_000;
const at = new Date("2026-01-05T11:00:00Z"); // 19:00 in Singapore

test("one step per hour, writing an ego_tick row", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  expect(await egoTickUser(deps, u, at)).toBe("done");
  expect(await egoTickUser(deps, u, new Date(at.getTime() + 20 * 60_000))).toBe("not_due");
  expect(await egoTickUser(deps, u, new Date(at.getTime() + H))).toBe("done");
  const rows = await deps.db.select().from(ego_tick).where(eq(ego_tick.user_id, u));
  expect(rows.map((r) => r.reason)).toEqual(["tick", "tick"]);
});

test("a busy day pulls energy lower than a free one", async () => {
  const deps = makeTestDeps({ ego: { noise: 0 } });
  const [busy, free] = [await createTestUser(), await createTestUser()];
  const payload = {
    start: "2026-01-05T01:00:00.000Z",
    end: "2026-01-05T09:00:00.000Z",
    block: "busy",
    busy: 1,
    label: "reading",
    life_day: "2026-01-05",
    shared: true,
  };
  await insertFact(deps.db, busy, {
    subject: "self",
    kind: "event",
    content: "Spica's morning: reading.",
    payload,
    embedding: vec(),
    created_at: at,
    status: "open",
    salience: 0.2,
    valence: 0,
    confidence: 1,
    source: "generated",
  });
  for (let k = 0; k < 5; k++)
    for (const u of [busy, free]) await egoTickUser(deps, u, new Date(at.getTime() + k * H));
  const [b, f] = [await getIdentityRow(deps.db, busy), await getIdentityRow(deps.db, free)];
  expect(b!.energy).toBeLessThan(f!.energy - 0.1);
});

test("clears an expired preoccupation", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const f = await insertFact(deps.db, u, {
    subject: "self",
    kind: "event",
    content: "x",
    embedding: vec(),
    created_at: at,
    status: "open",
    salience: 0.4,
    valence: 0.8,
    confidence: 1,
    source: "generated",
  });
  await ensureIdentity(deps.db, u, deps.config.ego.baseline);
  await updateIdentity(deps.db, u, {
    preoccupation: f.id,
    preoccupation_since: new Date(at.getTime() - deps.config.ego.preoccupation_hours * H),
  });
  await egoTickUser(deps, u, at);
  expect((await getIdentityRow(deps.db, u))?.preoccupation).toBeNull();
});

test("egoTick runs over life users only", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await createTestUser();
  await ensureRelationship(deps.db, u, at, deps.config.relationship);
  expect(await egoTick(deps, at)).toEqual({ users: 1, failed: 0 });
});
