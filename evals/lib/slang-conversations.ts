/**
 * Invented chat conversations for the labelling replay: the time words and texting shapes the
 * simulated user never writes (tmrw, tues, "monday week", a reply spread over messages, a late
 * answer). Written by us for this test, not taken from anyone; each says what a right reading gives.
 */
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ReplayConversation } from "./replay-source";

type Line = [who: "user" | "spica" | "reach_out", text: string, minutes: number];

function invented(n: number, startIso: string, note: string, lines: Line[]): ReplayConversation {
  const start = new Date(startIso).getTime();
  let lastUser: string | null = null;
  const turns: LayerTurn[] = lines.map(([who, text, minutes], i) => {
    const id = `invented-${n}-${i + 1}`;
    const turn: LayerTurn = {
      id,
      role: who === "user" ? "user" : "companion",
      text,
      created_at: new Date(start + minutes * 60_000),
      session_id: `invented-${n}`,
      reply_to: who === "spica" ? lastUser : null,
      trigger: who === "reach_out" ? "reach_out" : null,
    };
    if (who === "user") lastUser = id;
    return turn;
  });
  const [conversation] = conversations(turns);
  return {
    run: "invented",
    id: `invented-${n}`,
    zone: "UTC",
    note,
    before: [],
    turns: conversation!.turns,
    exchanges: conversation!.exchanges.map((e) => ({
      ...e,
      threads: [],
      interests: [],
      v11: null,
    })),
  };
}

export const SLANG_CONVERSATIONS: ReplayConversation[] = [
  invented(1, "2026-01-05T18:00:00Z", "tmrw at 10 → Tuesday 6 January 2026, 10:00", [
    ["user", "interview's tmrw at 10 and i'm freaking out", 0],
    ["spica", "you've prepped so much though. are you going in person?", 1],
  ]),
  invented(2, "2026-01-05T19:00:00Z", "tues → Tuesday 6 January; wed → Wednesday 7 January", [
    ["user", "tues works for the call", 0],
    ["user", "or wed if that's easier for you", 1],
    ["spica", "tues is perfect", 2],
  ]),
  invented(3, "2026-01-06T09:00:00Z", "yday → Monday 5 January; monday week → Monday 19 January", [
    ["user", "yday was rough tbh", 0],
    ["user", "my sis is moving out monday week", 1],
    ["spica", "rough how? and wait, moving where", 2],
  ]),
  invented(
    4,
    "2026-01-07T20:00:00Z",
    "a few days ago → around Sunday 4 January (rough); the other day → a rough day shortly before Wednesday 7 January",
    [
      ["user", "saw the dentist a few days ago, all fine", 0],
      ["user", "and the other day my landlord finally fixed the heating", 1],
      ["spica", "finally!! how long was it broken for", 2],
    ],
  ),
  invented(5, "2026-01-08T12:00:00Z", "since the 3rd → since Saturday 3 January", [
    ["user", "been waiting on my test results since the 3rd", 0],
    ["spica", "that's ages, did they say when", 1],
  ]),
  invented(
    6,
    "2026-01-09T17:00:00Z",
    "tonite at 8 → Friday 9 January, night, 20:00; the weekend after next → the weekend of Saturday 24 January",
    [
      ["user", "tonite at 8 we're doing the pub quiz", 0],
      ["user", "and the weekend after next is my brother's birthday", 1],
      ["spica", "what's your team name this time", 2],
    ],
  ),
  invented(
    7,
    "2026-01-10T11:00:00Z",
    "end of the month → the end of January 2026; two sundays ago → Sunday 28 December 2025",
    [
      ["user", "rent's due end of the month and i'm skint", 0],
      ["user", "also two sundays ago i lost my keys again lol", 1],
      ["spica", "again?? where did they turn up", 2],
    ],
  ),
  invented(
    8,
    "2026-01-11T21:00:00Z",
    "no dates: a habit and a hypothetical; no memory from the hypothetical",
    [
      ["user", "fridays are the worst at work", 0],
      ["user", "if it were friday tomorrow i'd just leave early", 1],
      ["spica", "what makes fridays so bad there", 2],
    ],
  ),
  invented(
    9,
    "2026-01-12T08:00:00Z",
    "one move over three messages correcting her question; friday → Friday 16 January",
    [
      ["reach_out", "is the interview still thursday?", 0],
      ["user", "so", 20],
      ["user", "they moved it", 20],
      ["user", "friday now lol", 21],
      ["spica", "noo why, did they say", 22],
    ],
  ),
  invented(
    10,
    "2026-01-13T19:00:00Z",
    "a late reply: 'fine' answers the dentist question, 'and yes booked' the train one; the train booking rests on her question and their yes",
    [
      ["reach_out", "how was the dentist?", 0],
      ["reach_out", "and did you book the train", 1],
      ["user", "fine", 30],
      ["user", "and yes booked", 31],
      ["spica", "nice, which day are you going", 32],
    ],
  ),
];
