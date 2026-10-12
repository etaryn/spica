/**
 * Phase 12 exit, all fake: two modules defined only here hear the mind through the event bus,
 * with no change to it. The user module hears all seven events; the public one, a core module,
 * hears only her life, posts from her public self, and never carries a user's data.
 */
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import type { Module, ModuleEvent, UserModule } from "@/mind/platform/modules";
import { RecordingSocialChannel } from "@/mind/platform/social";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { publicPersona } from "@/mind/process/core/public-persona";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { deliverPart } from "@/mind/process/deliver";
import { receiveTurn } from "@/mind/process/receive/receive-turn";
import { recordBigEvents, runUserMind } from "@/mind/process/user/run";
import { modules as production } from "@/modules";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { recordingModule } from "../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const TOKEN = "CANARY-12b7e4";
const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));
const SURPRISE = "00000000-0000-4000-8000-0000000000a1";
const ALL = [
  "core.snapshot",
  "fact.written",
  "relationship.changed",
  "reply.sent",
  "turn.received",
  "user_mind.triggered",
  "world.event",
];

function setup(first: Module[] = []) {
  const user = recordingModule("sample-user");
  const heard: ModuleEvent[] = [];
  const channel = new RecordingSocialChannel();
  const publicModule: Module = {
    name: "sample-public",
    scope: "core",
    on: {
      "world.event": async (e) => {
        heard.push(e);
      },
      "core.snapshot": async (e, deps) => {
        heard.push(e);
        const self = await publicPersona(deps);
        await channel.post(`v${self.version}: ${self.lines.join(" / ")}`);
      },
    },
  };
  const deps = makeTestDeps(
    { life: { timezone: "UTC" }, core: { world: { events_local_hour: 20 } } },
    [...first, user.module, publicModule],
  );
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "trait",
        content: `The user's code word is ${TOKEN}.`,
        occurred_at: null,
        salience: 0.9,
        valence: 0,
        confidence: 0.9,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  return { deps, user, heard, channel };
}

/** One user's exchange and user-mind run, then a day in her life: an event lands, a new self. */
async function drive(deps: ReturnType<typeof setup>["deps"]) {
  const u = await createTestUser("Alice");
  const { turn } = await receiveTurn(deps, u, {
    clientMessageId: randomUUID(),
    text: `remember ${TOKEN}`,
  });
  const reply = await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: turn.session_id,
    role: "companion",
    text: "got it",
    created_at: deps.clock.now(),
    reply_to: turn.id,
  });
  await deliverPart(deps, u, { turnId: reply.id, part: 0, parts: ["got it"] });
  const cold = await runColdPath(deps, {
    userId: u,
    turnIds: [turn.id, reply.id],
    replyTurnId: reply.id,
    recalled: [],
  });
  const runId =
    cold.userMindRunId ??
    (await recordBigEvents(deps, deps.db, u, "exit:12", [{ kind: "make_up_done" }]))!;
  await runUserMind(deps, { runId });

  const core = coreDepsOf(deps);
  await seedSnapshot(core);
  await deps.db.insert(s.world_event).values({
    id: SURPRISE,
    at: at(10),
    kind: "surprise",
    content: "Spica saw a meteor over the harbour.",
    valence: 0.7,
    stakes: "high",
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: at(9),
  });
  await coreWorldTick(core, at(10));
  await coreRenderSnapshot(core, at(11));
  return { u, turn, reply, runId };
}

test("1: the user module hears all seven events, with the right ids", async () => {
  const x = setup();
  const { u, turn, reply, runId } = await drive(x.deps);
  expect([...new Set(x.user.events.map((e) => e.type))].sort()).toEqual(ALL);
  expect(x.user.of("turn.received")).toEqual([
    { type: "turn.received", userId: u, turnId: turn.id },
  ]);
  expect(x.user.of("reply.sent")).toEqual([
    { type: "reply.sent", userId: u, turnId: reply.id, part: 0 },
  ]);
  const [canary] = await getTestDb()
    .select()
    .from(s.fact)
    .where(
      and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`), eq(s.fact.source, "turn")),
    );
  expect(x.user.of("fact.written")).toContainEqual({
    type: "fact.written",
    userId: u,
    factId: canary!.id,
    kind: "trait",
  });
  expect(x.user.of("relationship.changed")[0]).toMatchObject({ userId: u });
  expect(x.user.of("user_mind.triggered")).toEqual([
    expect.objectContaining({ type: "user_mind.triggered", userId: u, runId }),
  ]);
  expect(x.user.of("world.event")).toEqual([
    { type: "world.event", eventId: SURPRISE, outcome: "happened" },
  ]);
  expect(x.user.of("core.snapshot")).toEqual([{ type: "core.snapshot", version: 1 }]);
});

test("2: the public module hears only her life and posts from her public self", async () => {
  const x = setup();
  await drive(x.deps);
  expect(x.heard.map((e) => e.type)).toEqual(["world.event", "core.snapshot"]);
  expect(x.channel.posts).toHaveLength(1);
  expect(x.channel.posts[0]).toMatch(/^v1: /);
});

test("3: canary: nothing the public module heard, read or posted carries the user's data", async () => {
  const x = setup();
  const { u } = await drive(x.deps);
  const planted = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`)));
  expect(planted.length).toBeGreaterThan(0);
  const self = await publicPersona(coreDepsOf(x.deps));
  const exposed = JSON.stringify({ heard: x.heard, posts: x.channel.posts, self });
  expect(exposed).not.toContain(TOKEN);
  expect(exposed).not.toContain(u);
});

test("4: a module that throws changes no outcome and the others still hear everything", async () => {
  const boom: Module = {
    name: "boom",
    scope: "user",
    on: Object.fromEntries(
      ALL.map((type) => [
        type,
        async () => {
          throw new Error("boom");
        },
      ]),
    ) as UserModule["on"],
  };
  const x = setup([boom]);
  const { u } = await drive(x.deps);
  expect([...new Set(x.user.events.map((e) => e.type))].sort()).toEqual(ALL);
  const planted = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`)));
  expect(planted.length).toBeGreaterThan(0);
  expect(x.channel.posts).toHaveLength(1);
});

test("5: the build ships no modules", () => {
  expect(production).toEqual([]);
});
