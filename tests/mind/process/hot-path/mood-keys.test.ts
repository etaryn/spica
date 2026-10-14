import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { loadMoodKeys } from "@/mind/process/hot-path/move";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("loadMoodKeys reads core state and the user's params without writing", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(
    { mood_valence: 0.1, mood_arousal: 0.4, energy: 0.1 },
    { autonomy: 0.6, competence: 0.6 },
  );
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  expect(await loadMoodKeys(deps, u, deps.clock.now())).toContain("energy low");
});
