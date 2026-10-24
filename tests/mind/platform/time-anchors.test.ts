/** Time anchors: a phrase keeps the date it meant when written, and reads right on any later day. */
import { expect, test } from "vitest";
import {
  anchorFields,
  anchorTimes,
  dateToken,
  isSingleToken,
  nowLine,
  ownDate,
  relativeWords,
  renderAbsolute,
  renderTimes,
  stamped,
  tokenDates,
} from "@/mind/platform/time-anchors";

const MON = new Date("2026-01-12T09:00:00Z"); // Monday 12 January 2026
const at = (iso: string) => new Date(iso);
const utc = { at: MON, zone: "UTC" };
const read = (text: string, now: Date) => renderTimes(text, now, 6);
const days = (text: string) => tokenDates(text).map((d) => d.toISOString().slice(0, 10));

test("relative words become the day they meant, and read right later", () => {
  const stored = anchorTimes("how'd the race go yesterday—legs hold up?", utc);
  expect(stored).not.toContain("yesterday");
  expect(read(stored, MON)).toBe("how'd the race go yesterday, Sunday 11 January—legs hold up?");
  expect(read(stored, at("2026-01-13T09:00:00Z"))).toBe(
    "how'd the race go 2 days ago, Sunday 11 January—legs hold up?",
  );
  const night = anchorTimes("Spica has a telescope booking confirmed for tonight.", utc);
  expect(read(night, MON)).toBe("Spica has a telescope booking confirmed for tonight.");
  expect(read(night, at("2026-01-13T09:00:00Z"))).toBe(
    "Spica has a telescope booking confirmed for last night, Monday 12 January.",
  );
});

test("day counts follow the calendar across midnight and a DST change", () => {
  const late = anchorTimes("today", { at: at("2026-01-11T23:30:00Z"), zone: "UTC" });
  expect(read(late, at("2026-01-12T00:10:00Z"))).toBe("yesterday, Sunday 11 January");
  const london = anchorTimes("today", { at: at("2026-03-28T12:00:00Z"), zone: "Europe/London" });
  expect(read(london, at("2026-03-30T00:30:00Z"))).toBe("2 days ago, Saturday 28 March");
});

test("a bare weekday takes a date the writer was shown, else points by the rule", () => {
  const written = at("2026-01-05T10:00:00Z"); // Monday the 5th
  const race = at("2026-01-11T08:00:00Z"); // Sunday
  const sunday = "Sam's got a half marathon Sunday.";
  expect(days(anchorTimes(sunday, { at: written, zone: "UTC", known: [race] }))).toEqual([
    "2026-01-11",
  ]);
  expect(days(anchorTimes(sunday, { at: written, zone: "UTC" }))).toEqual(["2026-01-11"]);
  const wednesday = { at: at("2026-01-14T23:00:00Z"), zone: "UTC" };
  expect(days(anchorTimes("They're awake late on Wednesday.", wednesday))).toEqual(["2026-01-14"]);
  const past = { ...utc, direction: "past" as const };
  expect(days(anchorTimes("The user finished it on Saturday.", past))).toEqual(["2026-01-10"]);
  const ahead = { ...utc, direction: "upcoming" as const };
  expect(days(anchorTimes("The user has a meeting on Monday.", ahead))).toEqual(["2026-01-19"]);
});

test("weeks, weekends, offsets, explicit dates and durations anchor", () => {
  expect(days(anchorTimes("Both happen this week.", utc))).toEqual(["2026-01-16"]);
  expect(days(anchorTimes("Due by the end of the week.", utc))).toEqual(["2026-01-16"]);
  expect(days(anchorTimes("Sister visits Saturday 17 January.", utc))).toEqual(["2026-01-17"]);
  expect(days(anchorTimes("The results come in 3 days.", utc))).toEqual(["2026-01-15"]);
  expect(days(anchorTimes("She left 2 days ago.", utc))).toEqual(["2026-01-10"]);
  // "over the weekend" with no label takes the nearest weekend: from a Monday, the one just past.
  expect(days(anchorTimes("The user finished the task over the weekend.", utc))).toEqual([
    "2026-01-10",
  ]);
  expect(days(anchorTimes("Starts in october.", utc))).toEqual(["2026-10-01"]);
  const waited = anchorTimes("Still waiting on feedback, five days now.", utc);
  expect(read(waited, at("2026-01-13T09:00:00Z"))).toBe(
    "Still waiting on feedback, since Wednesday 7 January, 6 days ago.",
  );
});

test("a time on a day anchors; a bare clock time, 'now' and weekday nouns don't", () => {
  expect(read(anchorTimes("The call is tomorrow at 3pm.", utc), MON)).toBe(
    "The call is tomorrow, Tuesday 13 January at 15:00.",
  );
  for (const s of [
    "Sam's in the thick of it right now.",
    "She ran mile 10 at 8 pace.",
    "She loves Sunday roast and Black Friday sales.",
    "On your profile card you picked staying in on a free Friday night.",
    "She runs on Sundays and every Saturday.",
    "the trap was waiting for the night that would be different",
    "she's catching the pattern everywhere this year",
  ])
    expect(anchorTimes(s, utc)).toBe(s);
});

test("anchoring twice changes nothing, and dates inside tokens are never re-read", () => {
  const once = anchorTimes("Sister visits Saturday 17 January, then the race tomorrow.", utc);
  expect(anchorTimes(once, utc)).toBe(once);
  expect(anchorTimes(once, { at: at("2027-06-01T09:00:00Z"), zone: "Asia/Singapore" })).toBe(once);
});

test("a date read in another year names its year", () => {
  const stored = anchorTimes("The party is on Wednesday 30 December.", {
    at: at("2026-12-28T09:00:00Z"),
    zone: "UTC",
  });
  // Her stored notes drop the "on" with the phrase; the date reads on its own.
  expect(read(stored, at("2027-01-20T09:00:00Z"))).toBe("The party is Wednesday 30 December 2026.");
});

test("each token reads on its own calendar", () => {
  const her = anchorTimes("Clear skies tonight.", {
    at: at("2026-01-12T15:30:00Z"),
    zone: "Asia/Singapore",
  });
  expect(read(her, at("2026-01-12T17:00:00Z"))).toBe("Clear skies last night, Monday 12 January.");
});

test("said mode keeps the words and glosses them only when their meaning moved", () => {
  const glossed = anchorTimes("my race is tomorrow", { ...utc, said: true });
  expect(read(glossed, at("2026-01-12T20:00:00Z"))).toBe("my race is tomorrow");
  expect(read(glossed, at("2026-01-13T08:00:00Z"))).toBe("my race is tomorrow (that's today)");
  expect(read(glossed, at("2026-01-14T08:00:00Z"))).toBe(
    "my race is tomorrow (that's yesterday, Tuesday 13 January)",
  );
});

test("dates code holds become tokens: a memory's date shows once; written stamps", () => {
  expect(read(dateToken(at("2026-01-11T08:00:00Z"), "UTC"), MON)).toBe(
    "yesterday, Sunday 11 January",
  );
  expect(read(dateToken(at("2026-01-15T19:00:00Z"), "UTC", "time"), MON)).toBe(
    "in 3 days, Thursday 15 January at 19:00",
  );
  const friday = at("2026-01-09T08:00:00Z");
  expect(ownDate("Sam is stressed.", friday, "UTC")).toBe(dateToken(friday, "UTC"));
  expect(ownDate(anchorTimes("The race is tomorrow.", utc), MON, "UTC")).toBeNull();
  expect(ownDate("Sam is stressed.", null, "UTC")).toBeNull();
  expect(read(stamped("Lately: tides.", at("2026-01-10T20:00:00Z"), "UTC"), MON)).toBe(
    "(written 2 days ago, Saturday 10 January)\nLately: tides.",
  );
});

test("now on both calendars", () => {
  const t = at("2026-01-13T21:40:00Z");
  expect(nowLine(t, "UTC", "UTC")).toBe("It's Tuesday 13 January, 21:40.");
  expect(nowLine(t, "Europe/London", "Asia/Singapore")).toBe(
    "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 05:40 for you.",
  );
  expect(nowLine(t, "Europe/London", "Asia/Singapore", "where Spica is")).toContain(
    "05:40 where Spica is",
  );
});

test("absolute rendering, token dates, single tokens, fields, leftover words", () => {
  const s = anchorTimes("the race tomorrow", utc);
  expect(renderAbsolute(s)).toBe("the race Tuesday 13 January 2026");
  expect(tokenDates(s)[0]!.toISOString()).toBe("2026-01-13T12:00:00.000Z");
  expect(isSingleToken(anchorTimes("tomorrow", utc))).toBe(true);
  expect(isSingleToken("tomorrow")).toBe(false);
  expect(anchorFields({ a: "see you tomorrow", n: 3, from: ["x"] }, utc)).toEqual({
    a: anchorTimes("see you tomorrow", utc),
    n: 3,
    from: ["x"],
  });
  expect(anchorFields(null, utc)).toBeNull();
  expect(relativeWords("Sister visits tomorrow, coming Today.")).toEqual(["tomorrow", "today"]);
});

test("phrases land where the old resolver put them", () => {
  const mon = { at: at("2026-01-05T09:00:00Z"), zone: "UTC" }; // Monday 5 January
  const wed = { at: at("2026-01-07T09:00:00Z"), zone: "UTC" };
  const one = (phrase: string, ctx = mon) => days(anchorTimes(phrase, ctx))[0];
  expect(one("next monday")).toBe("2026-01-12");
  expect(one("on friday", wed)).toBe("2026-01-09");
  expect(one("last friday")).toBe("2026-01-02");
  expect(one("sunday")).toBe("2026-01-11");
  // A week is dated by its Friday, so an idea about the span lives until the week is out.
  expect(one("next week")).toBe("2026-01-16");
  expect(one("this weekend")).toBe("2026-01-10");
  expect(one("end of this week")).toBe("2026-01-09");
  expect(one("this week", wed)).toBe("2026-01-09");
  // "tomorrow" at 23:30 in Singapore is the next Singapore day.
  expect(one("tomorrow", { at: at("2026-01-05T15:30:00Z"), zone: "Asia/Singapore" })).toBe(
    "2026-01-06",
  );
  // "this morning" said late at night is that day's morning.
  expect(one("this morning", { at: at("2026-01-05T23:30:00Z"), zone: "UTC" })).toBe("2026-01-05");
  expect(one("in october", { at: at("2026-10-16T09:00:00Z"), zone: "UTC" })).toBe("2026-10-01");
  expect(one("this friday", { at: at("2026-01-09T09:00:00Z"), zone: "UTC" })).toBe("2026-01-09");
});

test("a yearless date or month takes the side of now its label points to", () => {
  const oct = { at: at("2026-10-19T09:00:00Z"), zone: "UTC" }; // Monday 19 October 2026
  const past = { ...oct, direction: "past" as const };
  const ahead = { ...oct, direction: "upcoming" as const };
  expect(days(anchorTimes("Started uni in September.", past))).toEqual(["2026-09-01"]);
  expect(days(anchorTimes("Moved to Leeds in March.", past))).toEqual(["2026-03-01"]);
  expect(days(anchorTimes("Ran a marathon on 15 March.", past))).toEqual(["2026-03-15"]);
  expect(days(anchorTimes("Our wedding is on 20 May.", ahead))).toEqual(["2027-05-20"]);
});

test("quoted words stay as said", () => {
  for (const text of [
    'Their goodnight ritual: "see you tomorrow, same time".',
    "They joke that ‘tomorrow’ means never.",
    "Running joke: 'Taco Tuesday'.",
  ])
    expect(anchorTimes(text, utc)).toBe(text);
  expect(days(anchorTimes('They said "soon" and meant tomorrow.', utc))).toEqual(["2026-01-13"]);
});

test("a bare weekday in an older message, with nothing to date it by, keeps its words unglossed", () => {
  const said = { at: MON, zone: "UTC", said: true };
  expect(anchorTimes("I went running on Sunday", said)).toBe("I went running on Sunday");
});

test("a long phrase around a date keeps every word (the 16b run's summary)", () => {
  const mon = { at: at("2026-01-05T10:21:40Z"), zone: "UTC" };
  const text =
    "Sam has a design job interview at a small studio on the afternoon of Thursday 8 January, in 3 days, and they're feeling nervous about it.";
  const stored = anchorTimes(text, mon);
  expect(read(stored, mon.at)).toBe(text);
  expect(days(stored)).toEqual(["2026-01-08"]);
});

test("a relative day beside its written-out date is one token", () => {
  const fri = { at: at("2026-01-09T20:00:00Z"), zone: "UTC" };
  const stored = anchorTimes(
    "They had a design job interview yesterday, Thursday 8 January, and I don't yet know how it went.",
    fri,
  );
  expect(days(stored)).toEqual(["2026-01-08"]);
  expect(read(stored, fri.at)).toBe(
    "They had a design job interview yesterday, Thursday 8 January, and I don't yet know how it went.",
  );
  // When the two disagree, the written-out date wins.
  expect(days(anchorTimes("The race was yesterday, Sunday 4 January.", fri))).toEqual([
    "2026-01-04",
  ]);
  // In brackets, no stray bracket is left.
  expect(anchorTimes("Due Thursday 8 January (yesterday).", fri)).toMatch(/^Due ⟦[^⟧]+⟧\.$/);
  // Two written-out dates stay two.
  expect(days(anchorTimes("Thursday 8 January, Friday 9 January.", fri))).toEqual([
    "2026-01-08",
    "2026-01-09",
  ]);
  // A comma inside a date is still one date.
  expect(days(anchorTimes("Back on Monday, 12 January.", fri))).toEqual(["2026-01-12"]);
});

test("ISO dates anchor, and merge with the day words beside them", () => {
  const fri = { at: at("2026-01-09T20:00:00Z"), zone: "UTC" };
  expect(anchorTimes("The user had a job interview on Friday 2026-01-09.", fri)).toBe(
    "The user had a job interview on ⟦2026-01-09|day|UTC⟧.",
  );
  expect(
    days(anchorTimes("The user had an interview on Thursday afternoon, 2026-01-08.", fri)),
  ).toEqual(["2026-01-08"]);
  expect(days(anchorTimes("The user can't sleep on the night of 2026-01-14.", fri))).toEqual([
    "2026-01-14",
  ]);
});
