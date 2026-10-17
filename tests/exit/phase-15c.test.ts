/**
 * Phase 15c exit, all fake: a repaired hurt is a big event and turns past; her notes read nothing
 * sensitive outside a crisis window; a new user has no "usual" rate yet; dates come from the words
 * said; gender is a full-weight card fact; a distant memory can only be contradicted; the judge
 * keeps only her words; milestones skip the cap; and one user's words never reach another's notes.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun } from "@/db/repos/user/user-mind";
import { reconcileAgainstNeighbours } from "@/mind/memory/shared/reconcile";
import { settleHurtFacts } from "@/mind/memory/user/hurt";
import { resolveWhen } from "@/mind/memory/user/when";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { genderFact } from "@/mind/process/onboarding/gender";
import { detectBigEvents } from "@/mind/process/user/big-events";
import { loadRunInputs, triggerText } from "@/mind/process/user/inputs";
import { runUserMind } from "@/mind/process/user/run";
import { relationshipAfterDailyTick } from "@/mind/state/user/relationship/transitions";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";
import { keepQuoted } from "../../evals/lib/judged";
import {
  closeTestDb,
  createTestUser,
  getTestDb,
  openCrisisWindow,
  resetDb,
  vec,
} from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const cfg = config.relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const params = (hurt: number): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: n === "hurt" ? hurt : cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: t0,
      },
    ]),
  ) as Params;

test("1: an apology that takes hurt below the line is a repair, and the hurt memory turns past", async () => {
  const triggers = detectBigEvents({
    before: { params: params(0.27), makeUp: "none" },
    after: { params: params(0.07), makeUp: "none" },
    newFacts: [],
    apology: true,
    settings: config.user_mind.triggers,
    source: "exchange",
  });
  expect(triggers).toContainEqual({ kind: "repaired", via: "apology" });
  expect(triggerText({ kind: "repaired", via: "apology" })).toBe(
    "they apologised, and the hurt has passed",
  );
  const db = getTestDb();
  const u = await createTestUser();
  await insertFact(db, u, {
    subject: "self",
    kind: "feeling",
    content: "Spica felt hurt because the user said her star talk gets a bit much.",
    embedding: vec(),
    created_at: t0,
    status: "open",
    salience: 0.6,
    valence: -0.25,
    confidence: 0.8,
    source: "inferred",
  });
  expect(await settleHurtFacts(db, u, "apology", t0)).toBe(1);
});

test("2: a new user has no usual rate: no absence hurt from a quiet day", () => {
  const r = relationshipAfterDailyTick(
    {
      status: "active",
      end_pending_since: null,
      ended_at: null,
      repair_started_at: null,
      make_up_state: "none",
      make_up_replies: 0,
      hurt_cause_fact: null,
      crisis_quiet_until: null,
      last_tick: null,
      last_hurt_at: null,
      hours_together: 0,
      session: null,
      peak_stage: "initiating",
      apart_stage: null,
      milestones: [],
    },
    params(0),
    {
      now: new Date(t0.getTime() + 25 * 3_600_000),
      localDate: "2026-01-06",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: t0,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.events.some((e) => e.cause === "absence" && e.param === "hurt")).toBe(false);
});

test("3: outside a crisis window her run reads nothing sensitive; inside, it does", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "Private crisis detail.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: -0.5,
    confidence: 0.9,
    source: "turn",
  });
  expect((await loadRunInputs(deps, u)).facts).toEqual([]);
  await openCrisisWindow(u, new Date(deps.clock.now().getTime() + 3_600_000));
  expect((await loadRunInputs(deps, u)).facts.map((f) => f.content)).toEqual([
    "Private crisis detail.",
  ]);
});

test("4: 'next monday' said on a Monday is the next week's Monday", () => {
  expect(resolveWhen("next monday", new Date("2026-01-05T09:00:00Z"), "UTC")?.label).toBe(
    "Monday 12 January 2026",
  );
});

test("5: gender is a card line with its pronouns", () => {
  expect(genderFact("unspecified")).toBe("They didn't say their gender; use they/them for them.");
});

test("6: a distant memory can only be contradicted", async () => {
  const llm = new FakeLLMProvider();
  const id = "44444444-4444-4444-8444-444444444444";
  llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: id });
  const d = await reconcileAgainstNeighbours(
    { llm, config },
    { label: "user, event", content: "The user had steak." },
    [{ id, content: "The user is vegetarian.", status: "open", sim: 0.78 }],
  );
  expect(d.relation).toBe("new");
});

test("7: the judge keeps only her words", () => {
  const kept = keepQuoted(
    [{ message: "", claim: "everyone's being weird" }],
    [{ label: "S1", lines: [{ role: "user", text: "everyone's being weird" }] }],
  );
  expect(kept).toEqual([]);
});

test("8: a milestone run is recorded past the cap", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const add = (ref: string, name: string) =>
    insertRun(db, u, {
      sourceRef: ref,
      triggers: [{ kind: "milestone", name }],
      localDate: "2026-01-05",
      now: t0,
      cap: 0,
    });
  expect((await add("a", "first_inside_joke"))?.status).toBe("pending");
});

test("9: leak canary: A's memories never reach B's user-mind prompts", async () => {
  const llm = new CapturingLLM();
  const deps = { ...makeTestDeps(), llm };
  const [a, b] = [await createTestUser(), await createTestUser()];
  const fact = (u: string, content: string) =>
    insertFact(deps.db, u, {
      subject: "user",
      kind: "event",
      content,
      embedding: vec(),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.9,
      valence: 0.2,
      confidence: 0.9,
      source: "turn",
    });
  await fact(a, "The user's code word is CANARY-memory15c.");
  await fact(b, "The user got a new job.");
  const run = (await insertRun(deps.db, b, {
    sourceRef: "exchange:b",
    triggers: [{ kind: "salient_fact", salience: 0.9, content: "The user got a new job." }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 9,
  }))!;
  await runUserMind(deps, { runId: run.id });
  expect(llm.seen.some((s) => s.purpose === "user_summarise")).toBe(true);
  for (const s of llm.seen) expect(s.text).not.toMatch(CANARY);
});
