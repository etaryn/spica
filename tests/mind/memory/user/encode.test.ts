import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  emptyLabels,
  type CheckedLabels,
  type CheckedMention,
  type CheckedThread,
} from "@/mind/memory/user/annotations";
import { encodeExtraction, type EncodeInput } from "@/mind/memory/user/encode";
import type { MemoryPlan } from "@/mind/memory/user/label-memory";
import * as facts from "@/db/repos/user/facts";
import { findEntityByName } from "@/db/repos/user/entities";
import { insertTurn } from "@/db/repos/user/session-log";
import { sessionAnnotations, type AnnotationRow } from "@/db/repos/user/annotations";
import * as threads from "@/db/repos/user/threads";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const now = new Date("2026-01-12T09:00:00Z");
const db = () => getTestDb();
const f = (content: string, over: Partial<MemoryPlan> = {}): MemoryPlan => ({
  localId: null,
  subject: "user",
  kind: "event",
  content,
  embedText: content,
  occurred_at: null,
  salience: 0.6,
  valence: 0,
  confidence: 0.9,
  claim_kind: null,
  mentions: [],
  threadId: null,
  newThread: null,
  updates: null,
  idiolect: null,
  ...over,
});
const mention = (over: Partial<CheckedMention>): CheckedMention => ({
  id: "e1",
  piece: "1.1",
  words: "x",
  refers_to: null,
  name: null,
  type: "person",
  subject: "user",
  relation: null,
  coord: { turnId: "t", start: 0, end: 1 },
  ...over,
});
const thread = (over: Partial<CheckedThread>): CheckedThread => ({
  action: "open",
  thread_id: null,
  title: "x",
  subject: "user",
  stakes: "med",
  checkpoint: null,
  propositions: [],
  checkpointAt: null,
  ...over,
});
const labels = (over: Partial<CheckedLabels>): CheckedLabels => ({ ...emptyLabels(), ...over });
const day = (date: string) => ({
  date,
  precision: "day" as const,
  part: null,
  clock: null,
  span: "at" as const,
  rough: false,
});

async function setup() {
  const u = await createTestUser();
  const ut = await insertTurn(db(), u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "x",
    created_at: now,
  });
  const ct = await insertTurn(db(), u, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "y",
    created_at: now,
    reply_to: ut.id,
  });
  const input = (over: Partial<EncodeInput>): EncodeInput => ({
    userId: u,
    now,
    exchangeAt: now,
    labels: emptyLabels(),
    stored: [],
    sessionId: ut.session_id,
    zone: "UTC",
    facts: [],
    sensitive: false,
    sourceRef: ct.id,
    recalled: [],
    replyTurnId: ct.id,
    turnIds: [ut.id, ct.id],
    ...over,
  });
  return { u, ut, ct, input };
}

async function seed(u: string, content: string, over: Partial<facts.NewFact> = {}) {
  return facts.insertFact(db(), u, {
    subject: "user",
    kind: "event",
    content,
    embedding: vec(),
    created_at: new Date("2026-01-01T00:00:00Z"),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.8,
    source: "turn",
    ...over,
  });
}

describe("encodeExtraction", () => {
  test("new memory: its mention names an entity, its thread opens, and every label is stored", async () => {
    const { u, ut, ct, input } = await setup();
    const out = await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({
          mentions: [
            mention({ id: "e1", words: "my sis", name: "Mia", relation: "sister", piece: "1.1" }),
          ],
          threads: [
            thread({
              title: "Mia starting uni",
              propositions: ["p1"],
              checkpointAt: day("2026-10-02"),
            }),
          ],
          propositions: [
            {
              id: "p1",
              moves: [],
              subject: "user",
              kind: "event",
              label: "Mia starting uni",
              status: "planned",
              times: [],
              mentions: ["e1"],
              thread_id: null,
              new_thread: null,
              updates: null,
              salience: 0.6,
              valence: 0,
              confidence: 0.9,
              claim_kind: null,
            },
          ],
        }),
        facts: [
          {
            fact: f('Mia starting uni, planned — the user said "my sis starts uni in october"', {
              localId: "p1",
              mentions: ["e1"],
            }),
            embedding: vec(),
            decision: { relation: "new", targetId: null },
          },
        ],
      }),
    );
    expect(out).toMatchObject({ inserted: 1, entitiesCreated: 1, threadsOpened: 1 });
    const [row] = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    const mia = await findEntityByName(db(), u, "user", "Mia");
    const [t] = await threads.listOpenThreads(db(), u, 5);
    expect(row).toMatchObject({
      entity_refs: [mia!.id],
      thread_id: t!.id,
      source: "turn",
      source_ref: ct.id,
      status: "open",
      payload: null,
    });
    expect(mia!.aliases).toEqual(["my sis"]);
    // A day's checkpoint is its noon on their calendar, as the renderer reads a day token.
    expect(t!.next_checkpoint!.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    const stored = await sessionAnnotations(db(), u, ut.session_id);
    expect(stored.map((r) => [r.layer, r.local_id, r.fact_id])).toEqual([
      ["mention", "e1", null],
      ["proposition", "p1", row!.id],
    ]);
    expect((stored[0]!.data as { entity_id: string }).entity_id).toBe(mia!.id);
    const turns = await db().select().from(s.session_log).where(eq(s.session_log.user_id, u));
    expect(turns.every((x) => x.extracted)).toBe(true);
  });

  test("a labelled line is stored exactly as given: its words are never anchored", async () => {
    const { u, input } = await setup();
    const line = 'friday drinks, planned — the user said "drinks on friday?"';
    await encodeExtraction(
      db(),
      config,
      input({
        facts: [{ fact: f(line), embedding: vec(), decision: { relation: "new", targetId: null } }],
      }),
    );
    const [row] = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    expect(row!.content).toBe(line);
  });

  test("a mention labelled in an earlier exchange still links its entity", async () => {
    const { u, ut, input } = await setup();
    const earlier = { layer: "mention", local_id: "e1", data: { entity_id: null } };
    const out = await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({
          mentions: [mention({ id: "e9", words: "Juniper", name: "Juniper", type: "pet" })],
        }),
        facts: [
          {
            fact: f("cat juniper", { localId: "p1", mentions: ["e9"] }),
            embedding: vec(),
            decision: { relation: "new", targetId: null },
          },
        ],
      }),
    );
    expect(out.entitiesCreated).toBe(1);
    const juniper = await findEntityByName(db(), u, "user", "Juniper");
    const out2 = await encodeExtraction(
      db(),
      config,
      input({
        stored: [
          {
            ...earlier,
            local_id: "e9",
            data: { entity_id: juniper!.id },
            session_id: ut.session_id,
          } as unknown as AnnotationRow,
        ],
        facts: [
          {
            fact: f("juniper knocked the coffee over", { localId: "p2", mentions: ["e9"] }),
            embedding: vec(),
            decision: { relation: "new", targetId: null },
          },
        ],
      }),
    );
    expect(out2.entitiesCreated).toBe(0);
    const rows = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    expect(rows.every((r) => r.entity_refs.includes(juniper!.id))).toBe(true);
  });

  test("duplicate bumps the target (capped), contradicts supersedes, resolves resolves", async () => {
    const { u, input } = await setup();
    const dup = await seed(u, "The user is allergic to cats.", { salience: 0.93 });
    const old = await seed(u, "Mia starts in October.");
    const plan = await seed(u, "The user has a driving test on Thursday.");
    const out = await encodeExtraction(
      db(),
      config,
      input({
        facts: [
          {
            fact: f("The user is allergic to cats.", { confidence: 0.99 }),
            embedding: vec(),
            decision: { relation: "duplicate", targetId: dup.id },
          },
          {
            fact: f("Mia starts in November."),
            embedding: vec(),
            decision: { relation: "contradicts", targetId: old.id },
          },
          {
            fact: f("The user passed their driving test."),
            embedding: vec(),
            decision: { relation: "resolves", targetId: plan.id },
          },
        ],
      }),
    );
    expect(out).toMatchObject({ duplicates: 1, superseded: 1, resolved: 1, inserted: 2 });
    const d = await facts.getFact(db(), u, dup.id);
    expect(d!.salience).toBeCloseTo(0.95, 5);
    expect(d!.confidence).toBeCloseTo(0.99, 5);
    const o = await facts.getFact(db(), u, old.id);
    expect(o!.status).toBe("superseded");
    const replacement = await facts.getFact(db(), u, o!.superseded_by!);
    expect(replacement!.content).toBe("Mia starts in November.");
    expect((await facts.getFact(db(), u, plan.id))!.status).toBe("resolved");
  });

  test("inserted facts carry the exchange time; a contradiction older than its target is stored superseded by it", async () => {
    const { u, input } = await setup();
    const exchangeAt = new Date("2026-01-10T08:00:00Z");
    const newer = await seed(u, "Mia starts in December.", {
      created_at: new Date("2026-01-11T00:00:00Z"),
    });
    const out = await encodeExtraction(
      db(),
      config,
      input({
        exchangeAt,
        facts: [
          {
            fact: f("Mia starts in November."),
            embedding: vec(),
            decision: { relation: "contradicts", targetId: newer.id },
          },
          {
            fact: f("The user likes tea."),
            embedding: vec(),
            decision: { relation: "new", targetId: null },
          },
        ],
      }),
    );
    expect(out).toMatchObject({ inserted: 2, superseded: 1 });
    // The outdated fact is not news: only the tea fact can fire a salient-fact trigger.
    expect(out.insertedFacts).toHaveLength(1);
    expect((await facts.getFact(db(), u, newer.id))!).toMatchObject({
      status: "open",
      superseded_by: null,
    });
    const rows = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    const late = rows.find((r) => r.content === "Mia starts in November.")!;
    expect(late).toMatchObject({ status: "superseded", superseded_by: newer.id });
    const tea = rows.find((r) => r.content === "The user likes tea.")!;
    expect(late.created_at.toISOString()).toBe(exchangeAt.toISOString());
    expect(tea.created_at.toISOString()).toBe(exchangeAt.toISOString());
  });

  test("recall write-back via apply: low-sim and forced recalls are traced but not reinforced", async () => {
    const { u, input } = await setup();
    const hi = await seed(u, "High.");
    const lo = await seed(u, "Low.");
    const fo = await seed(u, "Forced.");
    const rec = (id: string, sim: number, forced = false) => ({
      factId: id,
      sim,
      fact_salience: 0.5,
      entity_salience: 1,
      recency: 1,
      score: 0.4,
      forced,
    });
    const out = await encodeExtraction(
      db(),
      config,
      input({
        recalled: [
          rec(hi.id, config.retrieval.reinforce_min_sim),
          rec(lo.id, config.retrieval.reinforce_min_sim - 0.01),
          rec(fo.id, 0.95, true),
        ],
      }),
    );
    expect(out.recalledUpdated).toBe(1);
    expect((await facts.getFact(db(), u, hi.id))!.recall_count).toBe(1);
    expect((await facts.getFact(db(), u, lo.id))!.recall_count).toBe(0);
    expect((await facts.getFact(db(), u, fo.id))!.recall_count).toBe(0);
    expect(await db().select().from(s.retrieval_trace)).toHaveLength(3);
  });

  test("foreign target id → inserted as new; foreign thread_id ignored", async () => {
    const { u, input } = await setup();
    const other = await createTestUser("other");
    const foreign = await seed(other, "Someone else's fact.");
    const foreignThread = await threads.insertThread(
      db(),
      other,
      { title: "their thing", subject: "user", stakes: "low", next_checkpoint: null },
      now,
    );
    const out = await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({
          threads: [
            thread({ action: "resolve", title: "their thing", thread_id: foreignThread.id }),
          ],
        }),
        facts: [
          {
            fact: f("A fact."),
            embedding: vec(),
            decision: { relation: "contradicts", targetId: foreign.id },
          },
        ],
      }),
    );
    expect(out).toMatchObject({ inserted: 1, superseded: 0 });
    expect((await facts.getFact(db(), other, foreign.id))!.status).toBe("open");
    expect((await threads.getOwnedThread(db(), other, foreignThread.id))!.status).toBe("open");
    expect(await threads.listOpenThreads(db(), u, 5)).toEqual([]);
  });

  test("case variants link one entity; sensitive flag; recall write-back skips deleted facts", async () => {
    const { u, ct, input } = await setup();
    const kept = await seed(u, "Kept memory.");
    const gone = await seed(u, "Forgotten memory.");
    await db().delete(s.fact).where(eq(s.fact.id, gone.id));
    const rec = (id: string) => ({
      factId: id,
      sim: 0.9,
      fact_salience: 0.5,
      entity_salience: 1,
      recency: 1,
      score: 0.4,
      forced: false,
    });
    const out = await encodeExtraction(
      db(),
      config,
      input({
        sensitive: true,
        labels: labels({
          mentions: [
            mention({ id: "e1", words: "MIA ", name: "MIA " }),
            mention({ id: "e2", words: "mia", name: "Mia" }),
          ],
        }),
        facts: [
          {
            fact: f("Mia struggling", { mentions: ["e1", "e2"] }),
            embedding: vec(),
            decision: { relation: "new", targetId: null },
          },
        ],
        recalled: [rec(kept.id), rec(gone.id)],
      }),
    );
    expect(out.entitiesCreated).toBe(1);
    expect(out.recalledUpdated).toBe(1);
    const inserted = (await db().select().from(s.fact).where(eq(s.fact.source_ref, ct.id)))[0]!;
    expect(inserted.entity_refs).toHaveLength(1);
    expect(inserted.payload).toEqual({ sensitive: true });
  });

  test("touch updates the checkpoint of an owned thread; resolve by title", async () => {
    const { u, input } = await setup();
    const t = await threads.insertThread(
      db(),
      u,
      { title: "thesis deadline", subject: "user", stakes: "high", next_checkpoint: null },
      new Date("2026-01-01T00:00:00Z"),
    );
    await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({
          threads: [
            thread({
              action: "touch",
              title: "thesis deadline",
              thread_id: t.id,
              checkpointAt: day("2026-02-01"),
            }),
          ],
        }),
      }),
    );
    expect((await threads.getOwnedThread(db(), u, t.id))!.next_checkpoint!.toISOString()).toBe(
      "2026-02-01T12:00:00.000Z",
    );
    await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({ threads: [thread({ action: "resolve", title: "Thesis Deadline" })] }),
      }),
    );
    expect((await threads.getOwnedThread(db(), u, t.id))!.status).toBe("resolved");
  });

  test("#8 a late job opening or touching a thread keeps it due (exchange time, GREATEST on touch)", async () => {
    const { u, input } = await setup();
    const exchangeAt = new Date("2026-01-05T09:00:00Z");
    // `now` (job time, 2026-01-12) is after the checkpoint; the exchange was before it.
    await encodeExtraction(
      db(),
      config,
      input({
        exchangeAt,
        labels: labels({
          threads: [thread({ title: "Driving test", checkpointAt: day("2026-01-08") })],
        }),
      }),
    );
    const [opened] = await threads.listOpenThreads(db(), u, 5);
    expect((await threads.getOwnedThread(db(), u, opened!.id))!.opened_at).toEqual(exchangeAt);
    expect((await threads.dueThreads(db(), u, now, 5)).map((t) => t.title)).toEqual([
      "Driving test",
    ]);

    const touch = labels({
      threads: [thread({ action: "touch", title: "Driving test", thread_id: opened!.id })],
    });
    await encodeExtraction(
      db(),
      config,
      input({ exchangeAt: new Date("2026-01-06T09:00:00Z"), labels: touch }),
    );
    expect((await threads.dueThreads(db(), u, now, 5)).map((t) => t.title)).toEqual([
      "Driving test",
    ]);

    // An older exchange never moves last_touched backwards.
    await encodeExtraction(
      db(),
      config,
      input({ exchangeAt: new Date("2026-01-02T09:00:00Z"), labels: touch }),
    );
    expect((await threads.getOwnedThread(db(), u, opened!.id))!.last_touched).toEqual(
      new Date("2026-01-06T09:00:00Z"),
    );
  });

  test("#9 a late resolves leaves a newer target alone", async () => {
    const { u, input } = await setup();
    const target = await seed(u, "The user's driving test is on Friday.", {
      created_at: new Date("2026-01-10T00:00:00Z"),
    });
    const out = await encodeExtraction(
      db(),
      config,
      input({
        exchangeAt: new Date("2026-01-05T09:00:00Z"),
        facts: [
          {
            fact: f("The user passed their driving test."),
            embedding: vec(),
            decision: { relation: "resolves", targetId: target.id },
          },
        ],
      }),
    );
    expect(out.inserted).toBe(1);
    expect((await facts.getFact(db(), u, target.id))!.status).toBe("open");
  });

  test("#10 mentions naming one entity merge their words as aliases; a mention with no name names nothing", async () => {
    const { u, input } = await setup();
    const out = await encodeExtraction(
      db(),
      config,
      input({
        labels: labels({
          mentions: [
            mention({ id: "e1", words: "my sis", name: "Mia", relation: "sister" }),
            mention({ id: "e2", words: "Mimi", name: " mia ", type: "other" }),
            mention({ id: "e3", words: "she", name: null }),
            mention({ id: "e4", words: "it", name: null, refers_to: randomUUID() }),
          ],
        }),
      }),
    );
    expect(out.entitiesCreated).toBe(1);
    const mia = await findEntityByName(db(), u, "user", "Mimi");
    expect(mia?.aliases.sort()).toEqual(["Mimi", "my sis"]);
    expect(mia?.type).toBe("person");
  });
});

test("a memory that supersedes or resolves another keeps its thread", async () => {
  const { u, input } = await setup();
  const t = await threads.insertThread(
    db(),
    u,
    { title: "interview", subject: "user", stakes: "high", next_checkpoint: null },
    now,
  );
  const old = await seed(u, "job interview thursday", { thread_id: t.id });
  const done = await seed(u, "driving test", { thread_id: t.id });
  await encodeExtraction(
    db(),
    config,
    input({
      facts: [
        {
          fact: f("job interview friday"),
          embedding: vec(),
          decision: { relation: "contradicts", targetId: old.id },
        },
        {
          fact: f("passed the driving test"),
          embedding: vec(),
          decision: { relation: "resolves", targetId: done.id },
        },
      ],
    }),
  );
  const rows = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(rows.find((r) => r.content === "job interview friday")!.thread_id).toBe(t.id);
  expect(rows.find((r) => r.content === "passed the driving test")!.thread_id).toBe(t.id);
});
