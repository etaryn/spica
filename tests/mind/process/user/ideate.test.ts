import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveIdeas, retireIdeas } from "@/db/repos/user/user-mind";
import { userReflect } from "@/mind/process/user/reflect";
import { userSummarise } from "@/mind/process/user/summarise";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { ideaStaleAfter, userIdeate } from "@/mind/process/user/ideate";
import { closeTestDb, createTestUser, openCrisisWindow, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  await insertFact(base.db, userId, {
    subject: "user",
    kind: "event",
    content: "They have an audition on Friday.",
    embedding: vec(),
    created_at: base.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.2,
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

test("writes one open idea; null writes nothing; live ideas are passed back", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_ideate = sequence(
    { idea: "Ask how the audition went; they were nervous.", about: "them", times: [] },
    { idea: null, about: "them", times: [] },
  );
  const inputs = await loadRunInputs(deps, userId);
  expect(await userIdeate(deps, run, inputs)).toBe("done");
  expect(await userIdeate(deps, run, inputs)).toBe("done");
  const ideas = await liveIdeas(deps.db, userId, deps.clock.now(), 5);
  expect(ideas).toHaveLength(1);
  expect(ideas[0]).toMatchObject({ kind: "idea", subject: "user", status: "open" });
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate")[1]!;
  expect(JSON.parse(second.input).already_planned).toEqual([
    "Ask how the audition went; they were nervous.",
  ]);
});

const D = 86_400_000;

test("an idea about an upcoming event goes stale at the end of that event's day", () => {
  const written = new Date("2026-01-06T09:00:00Z"); // Tue
  const event = new Date("2026-01-08T19:00:00Z"); // Thu evening
  expect(ideaStaleAfter(written, [event], 3, "UTC").toISOString()).toBe("2026-01-09T00:00:00.000Z");
});

test("an idea for tonight east of UTC ends at their midnight, not UTC's", () => {
  // 10:00 in Singapore on Tue 6th; "tonight" is 22:00 there (14:00 UTC).
  const written = new Date("2026-01-06T02:00:00Z");
  const tonight = new Date("2026-01-06T14:00:00Z");
  expect(ideaStaleAfter(written, [tonight], 3, "Asia/Singapore").toISOString()).toBe(
    "2026-01-06T16:00:00.000Z",
  );
});

test("an idea about a past event keeps its few days' chance; so does an undated one", () => {
  const written = new Date("2026-01-12T09:00:00Z"); // Mon
  const race = new Date("2026-01-11T08:00:00Z"); // Sun, already run
  const chance = new Date(written.getTime() + 3 * D);
  expect(ideaStaleAfter(written, [race], 3, "UTC")).toEqual(chance);
  expect(ideaStaleAfter(written, [], 3, "UTC")).toEqual(chance);
});

test("a far-off event never stretches an idea past its chance", () => {
  const written = new Date("2026-01-06T09:00:00Z");
  const later = new Date("2026-02-20T09:00:00Z");
  expect(ideaStaleAfter(written, [later], 3, "UTC")).toEqual(new Date(written.getTime() + 3 * D));
});

test("only a reflection from this run counts as noticed", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_ideate = () => ({ idea: null, about: "them", times: [] });
  const reflect = (content: string, createdAt: Date) =>
    insertFact(deps.db, userId, {
      subject: "user",
      kind: "reflection",
      content,
      embedding: vec(),
      created_at: createdAt,
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const inputs = await loadRunInputs(deps, userId);
  const noticed = () =>
    JSON.parse(deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate").at(-1)!.input)
      .noticed;
  await reflect("An old thought.", new Date(run.created_at.getTime() - 3_600_000));
  await userIdeate(deps, run, inputs);
  expect(noticed()).toBeNull();
  await reflect("A fresh thought.", run.created_at);
  await userIdeate(deps, run, inputs);
  expect(noticed()).toBe("A fresh thought.");
});

async function sensitiveFact(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  content: string,
) {
  return insertFact(deps.db, userId, {
    subject: "user",
    kind: "feeling",
    content,
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.95,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
  });
}

test("ideate never sees a sensitive memory, summary or reflection, even inside a crisis window", async () => {
  const { deps, userId, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  deps.llm.handlers.user_reflect = sequence({ reflection: "SECRET-REFLECTION", subject: "user" });
  await sensitiveFact(deps, userId, "SECRET-FACT thinking of ending it");
  const inputs = await loadRunInputs(deps, userId);
  await userSummarise(deps, run, inputs);
  await userReflect(deps, run, inputs);
  await userIdeate(deps, run, inputs);
  const call = deps.llm.structuredCalls.filter((c) => c.purpose === "user_ideate").at(-1)!;
  expect(call.input).not.toContain("SECRET");
  expect(call.input).toContain("audition");
  // The only summary read the sensitive memory, so ideate gets none.
  expect(JSON.parse(call.input).summary).toBeNull();
  expect(JSON.parse(call.input).noticed).toBeNull();
});

test("ideate reads her latest read on them only when nothing sensitive went into it", async () => {
  const { deps, userId, run } = await setup();
  const model = (how: string, sensitive: boolean, at: Date) =>
    insertFact(deps.db, userId, {
      subject: "user",
      kind: "model",
      content: how,
      payload: {
        how_they_are: how,
        what_they_want: "W.",
        what_lands: "L.",
        ...(sensitive ? { sensitive: true } : {}),
      },
      embedding: vec(),
      created_at: at,
      status: sensitive ? "open" : "superseded",
      salience: 0.6,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  await model("Plain read.", false, new Date(deps.clock.now().getTime() - 60_000));
  await model("Crisis read.", true, deps.clock.now());
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.your_read_on_them.how_they_are).toBe("Plain read.");
  expect(JSON.stringify(input)).not.toContain("Crisis read.");
});

test("an idea she already brought up recently is in already_planned", async () => {
  const { deps, userId, run } = await setup();
  const raised = await insertFact(deps.db, userId, {
    subject: "shared",
    kind: "idea",
    content: "Ask how the pottery class went.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  await retireIdeas(deps.db, userId, [raised.id]);
  deps.llm.handlers.user_ideate = sequence({ idea: null, about: "them", times: [] });
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_ideate")!;
  expect(JSON.parse(call.input).already_planned).toContain("Ask how the pottery class went.");
});

const tonight = {
  field: "idea",
  words: "tonight",
  from: "",
  unit: "day",
  shift: 0,
  weekday: null,
  month: null,
  day_of_month: null,
  part: "night",
  clock: "",
  span: "at",
  rough: false,
};

test("an idea cites the memory it's about, keeps it, and goes stale with its day", async () => {
  const { deps, userId, run } = await setup();
  const interview = await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "design interview, planned",
    embedding: vec(),
    created_at: deps.clock.now(),
    occurred_at: new Date("2026-01-07T14:00:00Z"),
    status: "open",
    salience: 0.95,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_ideate = () => ({ idea: "Ask how [m1] goes.", about: "them", times: [] });
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const [idea] = await liveIdeas(deps.db, userId, deps.clock.now(), 5);
  expect(idea).toMatchObject({ subject: "user", payload: { cites: [interview.id] } });
  expect(idea!.content).toBe(
    "Ask how design interview, planned ⟦2026-01-07|day|UTC⟧ (theirs) goes.",
  );
  expect(idea!.stale_after).toEqual(new Date("2026-01-08T00:00:00Z"));
});

test("an idea about them resting only on her own life isn't written; an uncited one is", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "self",
    kind: "event",
    content: "telescope booking, planned",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.99,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_ideate = sequence(
    { idea: "Ask whether [m1] turned up Orion's belt.", about: "them", times: [] },
    { idea: "Ask what they're reading lately.", about: "them", times: [] },
    { idea: "Tell them [m1] came through.", about: "you", times: [] },
  );
  const inputs = await loadRunInputs(deps, userId);
  for (let i = 0; i < 3; i++) await userIdeate(deps, run, inputs);
  const ideas = await liveIdeas(deps.db, userId, deps.clock.now(), 5);
  expect(ideas.map((i) => [i.subject, i.content.slice(0, 20)]).sort()).toEqual([
    ["self", "Tell them telescope "],
    ["user", "Ask what they're rea"],
  ]);
  const uncited = ideas.find((i) => i.subject === "user")!;
  expect(uncited.stale_after).toEqual(new Date(deps.clock.now().getTime() + 3 * D));
});

test("an idea's own 'tonight' is a token, and it retires at the end of today", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_ideate = () => ({
    idea: "Ask how tonight's gig goes.",
    about: "them",
    times: [tonight],
  });
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const [idea] = await liveIdeas(deps.db, userId, deps.clock.now(), 5);
  expect(idea!.content).toBe("Ask how ⟦2026-01-05|night|UTC|tonight⟧'s gig goes.");
  expect(idea!.stale_after).toEqual(new Date("2026-01-06T00:00:00Z"));
});
