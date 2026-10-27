import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveBeliefs, liveModel } from "@/db/repos/user/user-mind";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userModel } from "@/mind/process/user/model";
import {
  closeTestDb,
  createTestUser,
  getTestDb,
  openCrisisWindow,
  resetDb,
  vec,
} from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";
import { sql } from "drizzle-orm";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  await insertFact(base.db, userId, {
    subject: "user",
    kind: "event",
    content: "They turned down the promotion.",
    embedding: vec(),
    created_at: base.clock.now(),
    status: "open",
    salience: 0.9,
    valence: -0.1,
    confidence: 0.9,
    source: "turn",
  });
  const run = (await insertRun(base.db, userId, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: base.clock.now(),
    cap: 9,
  }))!;
  return { deps, userId, run };
}

const read = (beliefs: { text: string; replaces: string | null }[] = []) => ({
  how_they_are: "Tired but steady.",
  what_they_want: "Room to decide.",
  what_lands: "Dry jokes.",
  beliefs,
  times: [],
});

test("writes one live model with three parts and up to max_beliefs beliefs", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = sequence(
    read([
      { text: "They put others first.", replaces: null },
      { text: "They distrust praise.", replaces: null },
      { text: "A third is dropped.", replaces: null },
    ]),
  );
  expect(await userModel(deps, run, await loadRunInputs(deps, userId))).toBe("done");
  const model = (await liveModel(deps.db, userId))!;
  expect(model).toMatchObject({ kind: "model", subject: "user", source: "generated" });
  expect(model.payload).toEqual({
    how_they_are: "Tired but steady.",
    what_they_want: "Room to decide.",
    what_lands: "Dry jokes.",
  });
  expect(model.content).toContain("Room to decide.");
  const beliefs = await liveBeliefs(deps.db, userId, 10);
  expect(beliefs.map((b) => b.content).sort()).toEqual([
    "They distrust praise.",
    "They put others first.",
  ]);
  expect(beliefs[0]!.source_ref).toMatch(/^user_model:/);
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.new_memories[0].content).toBe("They turned down the promotion.");
  expect(input.who_you_are).toBe("She loves old films.");
});

test("a new model supersedes the old; a belief replaces only one it was shown and still holds", async () => {
  const { deps, userId, run } = await setup();
  const otherUser = await createTestUser();
  const theirs = await insertFact(deps.db, otherUser, {
    subject: "user",
    kind: "belief",
    content: "Someone else's belief.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.llm.handlers.user_model = sequence(
    read([{ text: "They avoid conflict.", replaces: null }]),
    read([]),
  );
  const inputs = await loadRunInputs(deps, userId);
  await userModel(deps, run, inputs);
  const first = (await liveModel(deps.db, userId))!;
  const [old] = await liveBeliefs(deps.db, userId, 10);

  deps.llm.handlers.user_model = sequence(
    read([
      { text: "They pick their battles.", replaces: old!.id },
      { text: "They light up about trains.", replaces: theirs.id },
      { text: "They are funnier than they let on.", replaces: "garbage" },
    ]),
  );
  deps.config.user_mind.model.max_beliefs = 3;
  await userModel(deps, run, inputs);
  const second = (await liveModel(deps.db, userId))!;
  expect(second.id).not.toBe(first.id);
  const rows = await getTestDb().execute(
    sql`SELECT id, status, superseded_by FROM fact WHERE kind IN ('model', 'belief') ORDER BY created_at, id`,
  );
  const byId = new Map(rows.rows.map((r) => [String(r.id), r]));
  expect(byId.get(first.id)).toMatchObject({ status: "superseded", superseded_by: second.id });
  expect(byId.get(old!.id)).toMatchObject({ status: "superseded" });
  expect(byId.get(theirs.id)).toMatchObject({ status: "open", superseded_by: null });
  expect((await liveBeliefs(deps.db, userId, 10)).map((b) => b.content).sort()).toEqual([
    "They are funnier than they let on.",
    "They light up about trains.",
    "They pick their battles.",
  ]);
  const shown = JSON.parse(deps.llm.structuredCalls.at(-1)!.input).beliefs;
  expect(shown).toEqual([{ id: old!.id, text: "They avoid conflict." }]);
});

test("a belief that repeats a live one is dropped, unless it names the belief it corrects", async () => {
  const { deps, userId, run } = await setup();
  const inputs = await loadRunInputs(deps, userId);
  deps.llm.handlers.user_model = sequence(read([{ text: "They avoid conflict.", replaces: null }]));
  await userModel(deps, run, inputs);
  const [old] = await liveBeliefs(deps.db, userId, 10);

  // A correction can embed close to what it corrects ("They don't avoid conflict."); the same
  // text stands in for that here. Naming the old belief makes it a revision, not a repeat.
  deps.llm.handlers.user_model = sequence(
    read([{ text: "They avoid conflict.", replaces: old!.id }]),
  );
  await userModel(deps, run, inputs);
  const [revised] = await liveBeliefs(deps.db, userId, 10);
  expect(revised!.id).not.toBe(old!.id);
  expect((await liveBeliefs(deps.db, userId, 10)).map((b) => b.id)).toEqual([revised!.id]);

  deps.llm.handlers.user_model = sequence(read([{ text: "They avoid conflict.", replaces: null }]));
  await userModel(deps, run, inputs);
  expect((await liveBeliefs(deps.db, userId, 10)).map((b) => b.id)).toEqual([revised!.id]);
  const trace = await getTestDb().execute(
    sql`SELECT outputs FROM user_loop_trace WHERE loop = 'user_model' ORDER BY created_at DESC, id`,
  );
  expect(
    trace.rows.map((r) => r.outputs as { dropped: string[] }).some((o) => o.dropped.length === 1),
  ).toBe(true);
});

test("a model or belief that read anything sensitive is marked; an ordinary one is not", async () => {
  const { deps, userId, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  deps.llm.handlers.user_model = sequence(read([{ text: "They keep going.", replaces: null }]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  expect((await liveModel(deps.db, userId))!.payload).not.toHaveProperty("sensitive");

  deps.clock.advance(60_000);
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "feeling",
    content: "They said they'd been thinking of ending it.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.95,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_model = sequence(read([{ text: "They carry a lot.", replaces: null }]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  expect((await liveModel(deps.db, userId))!.payload).toMatchObject({ sensitive: true });
  const marked = (await liveBeliefs(deps.db, userId, 10)).find(
    (b) => b.content === "They carry a lot.",
  );
  expect(marked!.payload).toMatchObject({ sensitive: true });

  // The mark carries through the previous model even when the new memories are ordinary.
  deps.clock.advance(60_000);
  deps.llm.handlers.user_model = sequence(read([]));
  await userModel(deps, run, { previous: null, facts: [], clean: false, timezone: null });
  expect((await liveModel(deps.db, userId))!.payload).toMatchObject({ sensitive: true });
});

test("empty output fails and keeps the old model", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = sequence(read([]), { ...read([]), what_lands: "" });
  const inputs = await loadRunInputs(deps, userId);
  await userModel(deps, run, inputs);
  const before = (await liveModel(deps.db, userId))!;
  expect(await userModel(deps, run, inputs)).toBe("failed");
  expect((await liveModel(deps.db, userId))!.id).toBe(before.id);
});

test("outside a crisis window a sensitive belief isn't shown to the model, and nothing is marked", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "belief",
    content: "They were in a very dark place.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.llm.handlers.user_model = sequence(read([]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_model")!;
  expect(call.input).not.toContain("dark place");
  expect((await liveModel(deps.db, userId))!.payload).not.toHaveProperty("sensitive");
});

test("the read and each belief cite by id; a belief resting only on her life isn't kept", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "self",
    kind: "event",
    content: "telescope booking, planned",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.01,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  const inputs = await loadRunInputs(deps, userId);
  const theirs = inputs.facts.findIndex((f) => f.subject === "user");
  const hers = inputs.facts.findIndex((f) => f.subject === "self");
  deps.llm.handlers.user_model = () => ({
    how_they_are: `Busy with [m${theirs + 1}].`,
    what_they_want: "Rest.",
    what_lands: "Plain warmth.",
    beliefs: [
      { text: `They care about [m${theirs + 1}].`, replaces: null },
      { text: `They love [m${hers + 1}].`, replaces: null },
    ],
    times: [],
  });
  await userModel(deps, run, inputs);
  const model = (await liveModel(deps.db, userId))!;
  expect(model.payload).toMatchObject({ cites: [inputs.facts[theirs]!.id] });
  expect((model.payload as { how_they_are: string }).how_they_are).toContain(", theirs)");
  const beliefs = await liveBeliefs(deps.db, userId, 10);
  expect(beliefs.map((b) => b.content)).toEqual([expect.stringContaining("They care about")]);
  expect(beliefs[0]!.payload).toEqual({ cites: [inputs.facts[theirs]!.id] });
});

test("what the read and its beliefs dropped is traced", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = () => ({
    ...read([{ text: "They like plans.", replaces: null }]),
    how_they_are: "Tired, ask about [m9].",
    times: [
      {
        field: "belief_1",
        words: "tomorrow",
        from: "",
        unit: "day",
        shift: 1,
        weekday: null,
        month: null,
        day_of_month: null,
        part: null,
        clock: "",
        span: "at",
        rough: false,
      },
    ],
  });
  await userModel(deps, run, await loadRunInputs(deps, userId));
  const res = await getTestDb().execute(
    sql`SELECT outputs FROM user_loop_trace WHERE loop = 'user_model' ORDER BY created_at DESC LIMIT 1`,
  );
  expect((res.rows[0]!.outputs as { dropped_labels: unknown }).dropped_labels).toEqual([
    { what: "[m9]", reason: "bad_cite" },
    { what: "tomorrow", reason: "words_missing" },
  ]);
});
