// Dates from what they said: the phrase is resolved in code, in their time zone.
import { expect, test } from "vitest";
import type { Extraction } from "@/mind/memory/user/extract";
import { applyWhen, resolveWhen } from "@/mind/memory/user/when";

const mon = new Date("2026-01-05T09:00:00Z"); // Monday 5 January 2026
const wed = new Date("2026-01-07T09:00:00Z");
const label = (p: string, ref = mon, zone = "UTC") => resolveWhen(p, ref, zone)?.label ?? null;

test("weekdays land on the right day", () => {
  expect(label("next monday")).toBe("Monday 12 January 2026");
  expect(label("monday")).toBe("Monday 12 January 2026");
  expect(label("friday", wed)).toBe("Friday 9 January 2026");
  expect(label("last friday")).toBe("Friday 2 January 2026");
  expect(label("sunday")).toBe("Sunday 11 January 2026");
});

test("coarser phrases keep their precision", () => {
  expect(label("next month")).toBe("February 2026");
  expect(label("in october")).toBe("October 2026");
  expect(label("next week")).toBe("the week of Monday 12 January 2026");
  expect(label("this weekend")).toBe("the weekend of Saturday 10 January 2026");
});

test("'tomorrow' at 23:30 in Singapore is the next Singapore day", () => {
  expect(label("tomorrow", new Date("2026-01-05T15:30:00Z"), "Asia/Singapore")).toBe(
    "Tuesday 6 January 2026",
  );
});

test("'this week' is the week it was said in, never last Sunday", () => {
  expect(label("this week")).toBe("the week of Monday 5 January 2026");
  expect(label("this week", wed)).toBe("the week of Monday 5 January 2026");
  expect(label("later this week")).toBe("the week of Monday 5 January 2026");
  expect(label("end of the week")).toBe("the end of the week of Monday 5 January 2026");
  expect(resolveWhen("end of this week", mon, "UTC")?.at.toISOString().slice(0, 10)).toBe(
    "2026-01-09",
  );
  expect(resolveWhen("this week", wed, "UTC")?.at).toEqual(wed);
  // Untouched neighbours.
  expect(label("next week")).toBe("the week of Monday 12 January 2026");
  expect(label("this weekend")).toBe("the weekend of Saturday 10 January 2026");
  expect(label("this month")).toBe("January 2026");
});

test("'this week' on a Sunday in Singapore is the week that Sunday ends", () => {
  // Sunday 11 January 10:00 in Singapore.
  expect(label("this week", new Date("2026-01-11T02:00:00Z"), "Asia/Singapore")).toBe(
    "the week of Monday 5 January 2026",
  );
});

test("a phrase chrono can't read is null", () => {
  expect(resolveWhen("on the 18th", mon, "UTC")).toBeNull();
  expect(resolveWhen("   ", mon, "UTC")).toBeNull();
});

const extraction = (facts: Partial<Extraction["facts"][number]>[]): Extraction => ({
  facts: facts.map((f) => ({
    subject: "user",
    kind: "event",
    content: "The user starts a new job {when}.",
    occurred_at: null,
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
    when: null,
    ...f,
  })),
  entities: [],
  threads: [],
  relationship: null,
  intimacy: null,
  bid: null,
});

test("applyWhen fills the date in, sets occurred_at, and never leaves {when} behind", () => {
  const [a] = applyWhen(extraction([{ when: "next monday" }]), mon, "UTC").facts;
  expect(a!.content).toBe("The user starts a new job Monday 12 January 2026.");
  expect(a!.occurred_at?.toISOString().slice(0, 10)).toBe("2026-01-12");

  const fallback = new Date("2026-01-18T12:00:00Z");
  const [b] = applyWhen(
    extraction([{ when: "on the 18th", occurred_at: fallback }]),
    mon,
    "UTC",
  ).facts;
  expect(b!.content).toBe("The user starts a new job Sunday 18 January 2026.");

  const [c] = applyWhen(extraction([{ when: "on the 18th" }]), mon, "UTC").facts;
  expect(c!.content).toBe("The user starts a new job on the 18th.");

  const [d] = applyWhen(extraction([{ when: null }]), mon, "UTC").facts;
  expect(d!.content).toBe("The user starts a new job.");
});

test("a time of day keeps the day it was said on", () => {
  expect(label("at 3pm")).toBe("Monday 5 January 2026");
  expect(label("this evening")).toBe("Monday 5 January 2026");
});

test("present-tense words aren't pushed forward", () => {
  const lateMon = new Date("2026-01-05T23:30:00Z");
  expect(label("this morning", lateMon)).toBe("Monday 5 January 2026");
  expect(label("in october", new Date("2026-10-16T09:00:00Z"))).toBe("October 2026");
  expect(label("this friday", new Date("2026-01-09T09:00:00Z"))).toBe("Friday 9 January 2026");
});
