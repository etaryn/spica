import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  buildExtractionInput,
  extract,
  anchorExtraction,
  ExtractionSchema,
  normalizeExtraction,
} from "@/mind/memory/user/extract";
import type { Turn } from "@/db/repos/user/session-log";
import { renderAbsolute, tokenDates } from "@/mind/platform/time-anchors";
import { localDateString } from "@/mind/platform/timezone";
import { silentLogger } from "@/mind/platform/log";

const turn = (role: "user" | "companion", text: string, at: string): Turn => ({
  id: randomUUID(),
  user_id: randomUUID(),
  session_id: randomUUID(),
  role,
  text,
  created_at: new Date(at),
  trigger: null,
  extracted: false,
  safety_flag: null,
  reply_to: null,
  extract_attempts: 0,
  snapshot_version: null,
  openness: null,
  depth: null,
  pointed: null,
});

const rawFact = (over: Record<string, unknown> = {}) => ({
  subject: "user",
  kind: "event",
  content: "The user has a job interview at Acme on Friday.",
  when_direction: "upcoming",
  salience: 0.8,
  valence: 0.1,
  confidence: 0.95,
  entity_names: ["Acme"],
  thread_title: "job interview at Acme",
  ...over,
});

describe("buildExtractionInput", () => {
  test("marks context vs new, renders local weekday times, lists open threads with ids", () => {
    const input = buildExtractionInput({
      contextTurns: [turn("user", "ugh long day", "2026-01-05T08:55:00Z")],
      newTurns: [
        turn("user", "interview friday", "2026-01-05T09:00:00Z"),
        turn("companion", "good luck!", "2026-01-05T09:00:05Z"),
      ],
      openThreads: [{ id: "t-1", title: "moving flat" }],
      timezone: "America/New_York",
    });
    expect(input).toContain("User's timezone: America/New_York");
    expect(input).toContain("- t-1 | moving flat");
    expect(input.indexOf("Earlier conversation (context only")).toBeLessThan(
      input.indexOf("ugh long day"),
    );
    expect(input.indexOf("New exchange")).toBeLessThan(input.indexOf("interview friday"));
    expect(input).toMatch(/Mon.*04:00.*User: interview friday/);
    expect(input).toContain("Spica: good luck!");
  });

  test("her interests come before the exchange so her titles read right", () => {
    const args = {
      contextTurns: [],
      newTurns: [turn("companion", "tried mirror again", "2026-01-05T09:00:00Z")],
      openThreads: [],
      timezone: "UTC",
    };
    const input = buildExtractionInput({
      ...args,
      herInterests: ["old slow films (Stalker, Mirror)"],
    });
    expect(input).toContain(
      "What Spica is into (to read her own words right):\n- old slow films (Stalker, Mirror)",
    );
    expect(input.indexOf("What Spica is into")).toBeLessThan(input.indexOf("New exchange"));
    expect(buildExtractionInput({ ...args, herInterests: [] })).not.toContain("What Spica is into");
  });

  test("invalid timezone falls back to UTC", () => {
    const input = buildExtractionInput({
      contextTurns: [],
      newTurns: [turn("user", "hi", "2026-01-05T09:00:00Z")],
      openThreads: [],
      timezone: "Mars/Olympus",
    });
    expect(input).toContain("User's timezone: UTC");
    expect(input).toContain("Open threads: none");
  });
});

describe("normalizeExtraction", () => {
  test("clamps numbers, drops empty content, caps candidates, trims names; dates come later", () => {
    const out = normalizeExtraction(
      {
        facts: [
          rawFact({ salience: 1.7, valence: -3, confidence: -1 }),
          rawFact({ content: "   " }),
          rawFact({ entity_names: ["  Acme  ", ""] }),
          rawFact({ content: "third" }),
        ],
        entities: [
          {
            name: "  Mia ",
            aliases: [" my sis "],
            type: "person",
            subject: "user",
            relation: "sister",
          },
        ],
        threads: [
          {
            action: "open",
            title: "job interview at Acme",
            subject: "user",
            stakes: "high",
            checkpoint_when: null,
            thread_id: null,
          },
        ],
      },
      2,
    );
    expect(out.facts).toHaveLength(2);
    expect(out.facts[0]).toMatchObject({ salience: 1, valence: -1, confidence: 0 });
    // The model dates nothing: code anchors each fact's time words from its message.
    expect(out.facts[0]!.occurred_at).toBeNull();
    expect(out.facts[0]!.when_direction).toBe("upcoming");
    expect(out.facts[1]!.entity_names).toEqual(["Acme"]);
    expect(out.entities[0]).toMatchObject({ name: "Mia", aliases: ["my sis"] });
    expect(out.threads[0]!.next_checkpoint).toBeNull();
  });
});

test("normalizeExtraction: relationship block is normalised; missing → null", () => {
  expect(normalizeExtraction({ facts: [], entities: [], threads: [] }, 12).relationship).toBeNull();
  const r = normalizeExtraction(
    {
      facts: [],
      entities: [],
      threads: [],
      relationship: {
        warmth: 2,
        trust: 0,
        tension: 0,
        hurt: null,
        apology: false,
        make_up: false,
        ends_relationship: false,
        retracts_ending: false,
        wants_repair: false,
      },
    },
    12,
  );
  expect(r.relationship?.warmth).toBe(1);
});

test("normalizeExtraction: a schema-invalid relationship block never fails the memory write", () => {
  const out = normalizeExtraction(
    { facts: [rawFact()], entities: [], threads: [], relationship: { warmth: "lots" } },
    12,
  );
  expect(out.relationship).toBeNull();
  expect(out.facts).toHaveLength(1);
});

test("extract calls the extract model with the extraction prompt and returns normalized output", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.extract = () => ({
    facts: [rawFact()],
    entities: [],
    threads: [],
    relationship: null,
  });
  const out = await extract(
    { llm, config: loadConfig(), log: silentLogger },
    {
      contextTurns: [],
      newTurns: [turn("user", "interview friday", "2026-01-05T09:00:00Z")],
      openThreads: [],
      timezone: null,
    },
  );
  expect(renderAbsolute(out.facts[0]!.content)).toBe(
    "The user has a job interview at Acme Friday 9 January 2026.",
  );
  expect(llm.structuredCalls).toEqual([
    {
      purpose: "extract",
      system: expect.stringContaining("structured memory"),
      input: expect.stringContaining("interview friday"),
    },
  ]);
});

test("normalizeExtraction: claim_kind is kept only on her own facts", () => {
  const out = normalizeExtraction(
    {
      facts: [
        rawFact({ subject: "self", content: "Spica went stargazing.", claim_kind: "life" }),
        rawFact({ subject: "user", claim_kind: "opinion" }),
        rawFact({ subject: "self", content: "Spica loves Solaris." }),
      ],
      entities: [],
      threads: [],
    },
    12,
  );
  expect(out.facts.map((f) => f.claim_kind)).toEqual(["life", null, null]);
});

test("the model must answer claim_kind on every fact (null when it isn't hers)", () => {
  const { schema } = zodOutputFormat(ExtractionSchema as never) as unknown as {
    schema: { properties: { facts: { items: { required: string[] } } } };
  };
  expect(schema.properties.facts.items.required).toContain("claim_kind");
});

test("extraction can't write a summary: that kind is hers to write after a big event", () => {
  const kinds = ExtractionSchema.shape.facts.element.shape.kind.options as string[];
  expect(kinds).toContain("event");
  expect(kinds).not.toContain("summary");
});

test("a malformed intimacy block becomes null without failing the extraction", () => {
  const out = normalizeExtraction(
    { facts: [], entities: [], threads: [], relationship: null, intimacy: { nope: 1 } },
    10,
  );
  expect(out.intimacy).toBeNull();
  const missing = normalizeExtraction(
    { facts: [], entities: [], threads: [], relationship: null },
    10,
  );
  expect(missing.intimacy).toBeNull();
  const read = normalizeExtraction(
    {
      facts: [],
      entities: [],
      threads: [],
      relationship: null,
      intimacy: { user_disclosure: 0.7, user_responsiveness: null },
    },
    10,
  );
  expect(read.intimacy).toEqual({ user_disclosure: 0.7, user_responsiveness: null });
});

test("extract dates a fact's time words from their last message, in their zone", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.extract = () => ({
    facts: [
      rawFact({
        content: "The user starts a new job tomorrow.",
      }),
    ],
    entities: [],
    threads: [
      {
        action: "open",
        title: "new job",
        subject: "user",
        stakes: "med",
        checkpoint_when: "tomorrow evening",
        thread_id: null,
      },
    ],
    relationship: null,
  });
  const out = await extract(
    { llm, config: loadConfig(), log: silentLogger },
    {
      contextTurns: [],
      newTurns: [
        turn("user", "new job tomorrow!", "2026-01-05T15:30:00Z"), // 23:30 Monday in Singapore
        turn("companion", "oh nice", "2026-01-05T15:31:00Z"),
      ],
      openThreads: [],
      timezone: "Asia/Singapore",
    },
  );
  expect(renderAbsolute(out.facts[0]!.content)).toBe(
    "The user starts a new job Tuesday 6 January 2026.",
  );
  expect(localDateString(out.facts[0]!.occurred_at!, "Asia/Singapore")).toBe("2026-01-06");
  expect(out.threads[0]!.next_checkpoint).not.toBeNull();
});

const sent = new Date("2026-01-12T09:00:00Z"); // Monday
const user = (text: string) => ({ role: "user", text, created_at: sent });
const plainFact = (content: string, when_direction: "past" | "upcoming" | null) => ({
  subject: "user" as const,
  kind: "event" as const,
  content,
  occurred_at: null,
  when_direction,
  salience: 0.7,
  valence: 0,
  confidence: 0.9,
  entity_names: [],
  thread_title: null,
});
const extraction = (facts: unknown[], threads: unknown[] = []) =>
  ({ facts, entities: [], threads, relationship: null, intimacy: null, bid: null }) as never;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

test("a fact's time words are anchored at the message's send time, in the labelled direction", () => {
  const out = anchorExtraction(
    extraction([
      plainFact("The user finished the task over the weekend.", "past"),
      plainFact("The user runs a half marathon on Sunday morning.", "upcoming"),
    ]),
    [user("finished it over the weekend! race on sunday morning")],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-10");
  expect(day(out.facts[1]!.occurred_at)).toBe("2026-01-18");
  expect(tokenDates(out.facts[1]!.content)).toHaveLength(1);
});

test("a weekday the message never named takes the one it did, in the fact's own direction", () => {
  const out = anchorExtraction(
    extraction([plainFact("The user has an interview on Friday.", "upcoming")]),
    [user("interview is on thursday, nervous")],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-15");
});

test("the cross-check leaves a fact alone when the message names two weekdays, and never moves a right past date", () => {
  const two = anchorExtraction(
    extraction([plainFact("The user has an interview on Friday.", "upcoming")]),
    [user("thursday is the interview, saturday the party")],
    "UTC",
  );
  expect(day(two.facts[0]!.occurred_at)).toBe("2026-01-16");
  const past = anchorExtraction(
    extraction([plainFact("The user finished the task on Saturday.", "past")]),
    [user("I finished it on saturday")],
    "UTC",
  );
  expect(day(past.facts[0]!.occurred_at)).toBe("2026-01-10");
});

test("a thread's check-in words are always ahead", () => {
  const out = anchorExtraction(
    extraction(
      [],
      [
        {
          action: "open",
          title: "race",
          subject: "user",
          stakes: "med",
          checkpoint_when: "sunday evening",
          thread_id: null,
        },
      ],
    ),
    [user("race sunday")],
    "UTC",
  );
  expect(out.threads[0]!.next_checkpoint!.toISOString()).toBe("2026-01-18T19:00:00.000Z");
});

test("the weekday cross-check leaves her own facts, and a weekday from her turn, alone", () => {
  const her = { role: "companion", text: "np, I'm streaming saturday anyway", created_at: sent };
  const out = anchorExtraction(
    extraction([
      { ...plainFact("Spica is streaming on Saturday.", "upcoming"), subject: "self" },
      plainFact("The user will watch Spica's stream on Saturday.", "upcoming"),
    ]),
    [user("can't do thursday, work"), her],
    "UTC",
  );
  expect(out.facts.map((f) => day(f.occurred_at))).toEqual(["2026-01-17", "2026-01-17"]);
});
