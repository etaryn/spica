import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship, insertRelationshipEvents } from "@/db/repos/user/relationship";
import { OPENNESS_INPUTS } from "@/mind/platform/config";
import {
  CRISIS_OPENNESS,
  crisisOpennessLine,
  loadOpenness,
  loadOpennessPhrases,
  opennessFor,
  opennessLine,
  type OpennessInputs,
} from "@/mind/state/user/relationship/openness";
import { closeTestDb, createTestUser, resetDb } from "../../../../helpers/db";
import { makeTestDeps } from "../../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const d0 = makeTestDeps();
const cfg = d0.config.relationship;
const centred = (): OpennessInputs => ({ ...cfg.openness.centres });

test("at the centres she sits at her base", () => {
  expect(opennessFor(centred(), cfg)).toEqual({
    disclosure: cfg.openness.disclosure.base,
    responsiveness: cfg.openness.responsiveness.base,
  });
});

test("each input moves each value in its weight's direction, within 0..1", () => {
  for (const key of OPENNESS_INPUTS) {
    const up = { ...centred(), [key]: cfg.openness.centres[key] + 0.3 };
    const o = opennessFor(up, cfg);
    for (const side of ["disclosure", "responsiveness"] as const) {
      const w = cfg.openness[side].weights[key];
      const base = cfg.openness[side].base;
      if (w > 0) expect(o[side], `${side} ${key}`).toBeGreaterThan(base);
      if (w < 0) expect(o[side], `${side} ${key}`).toBeLessThan(base);
      if (w === 0) expect(o[side]).toBeCloseTo(base);
    }
  }
  expect(opennessFor({ ...centred(), hurt: 50 }, cfg).disclosure).toBe(0);
});

test("hurt and tired reads guarded; close, rested and just confided in reads open", () => {
  const phrases = loadOpennessPhrases(d0.config);
  const guarded = opennessFor({ ...centred(), hurt: 0.6, tension: 0.4, energy: 0.1 }, cfg);
  const open = opennessFor(
    { ...centred(), closeness: 0.9, trust: 0.8, energy: 0.9, last_user_disclosure: 0.9 },
    cfg,
  );
  expect(opennessLine(guarded, phrases, cfg)).toBe(
    phrases["disclosure low, responsiveness low"]![0],
  );
  expect(opennessLine(open, phrases, cfg)).toBe(
    phrases["disclosure high, responsiveness high"]![0],
  );
  expect(crisisOpennessLine(phrases)).toBe(phrases.crisis![0]);
  expect(CRISIS_OPENNESS).toEqual({ disclosure: 0, responsiveness: 1 });
});

test("every band pair has a phrase", () => {
  const phrases = loadOpennessPhrases(d0.config);
  for (const d of ["low", "mid", "high"])
    for (const r of ["low", "mid", "high"])
      expect(phrases[`disclosure ${d}, responsiveness ${r}`]?.length).toBeGreaterThan(0);
});

test("no relationship yet → null; the latest disclosure reading feeds reciprocity", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  expect(await loadOpenness(d, u, d.clock.now())).toBeNull();

  await ensureRelationship(d.db, u, d.clock.now(), cfg);
  const quiet = await loadOpenness(d, u, d.clock.now());
  await insertRelationshipEvents(
    d.db,
    u,
    [
      {
        param: "user_disclosure",
        before: 0.2,
        after: 0.44,
        cause: "signal",
        deviation: 0,
        detail: { reading: 1 },
      },
    ],
    { turnId: null, now: d.clock.now() },
  );
  const after = await loadOpenness(d, u, d.clock.now());
  expect(after!.disclosure).toBeGreaterThan(quiet!.disclosure);

  // The nightly baseline sample is newer but carries no reading; the confiding still counts.
  d.clock.advance(60_000);
  await insertRelationshipEvents(
    d.db,
    u,
    [
      {
        param: "user_disclosure",
        before: 0.2,
        after: 0.21,
        cause: "baseline",
        deviation: 0,
        detail: { sample: 0.44 },
      },
    ],
    { turnId: null, now: d.clock.now() },
  );
  expect((await loadOpenness(d, u, d.clock.now()))!.disclosure).toBeCloseTo(after!.disclosure);
});
