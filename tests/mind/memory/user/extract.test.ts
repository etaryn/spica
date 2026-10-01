import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { buildExtractionInput, extract, normalizeExtraction } from "@/mind/memory/user/extract";
import type { Turn } from "@/db/repos/user/session-log";

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
});

const rawFact = (over: Record<string, unknown> = {}) => ({
  subject: "user",
  kind: "event",
  content: "The user has a job interview at Acme on Friday.",
  occurred_at: "2026-01-09T10:00:00Z",
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
  test("clamps numbers, parses dates, drops empty content, caps candidates, trims names", () => {
    const out = normalizeExtraction(
      {
        facts: [
          rawFact({ salience: 1.7, valence: -3, confidence: -1 }),
          rawFact({ content: "   ", occurred_at: null }),
          rawFact({ occurred_at: "next week-ish", entity_names: ["  Acme  ", ""] }),
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
            next_checkpoint: "bogus",
            thread_id: null,
          },
        ],
      },
      2,
    );
    expect(out.facts).toHaveLength(2);
    expect(out.facts[0]).toMatchObject({ salience: 1, valence: -1, confidence: 0 });
    expect(out.facts[0]!.occurred_at!.toISOString()).toBe("2026-01-09T10:00:00.000Z");
    expect(out.facts[1]!.occurred_at).toBeNull();
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
    { llm, config: loadConfig() },
    {
      contextTurns: [],
      newTurns: [turn("user", "interview friday", "2026-01-05T09:00:00Z")],
      openThreads: [],
      timezone: null,
    },
  );
  expect(out.facts[0]!.content).toBe("The user has a job interview at Acme on Friday.");
  expect(llm.structuredCalls).toEqual([
    {
      purpose: "extract",
      system: expect.stringContaining("structured memory"),
      input: expect.stringContaining("interview friday"),
    },
  ]);
});
