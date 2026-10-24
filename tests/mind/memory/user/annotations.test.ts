/** Labels: one call's layers held to the transcript, and dropped with a reason when they aren't. */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { expect, test } from "vitest";
import {
  checkLabels,
  emptyLabels,
  LabelsSchema,
  type CheckContext,
  type CheckedLabels,
  type CheckedMove,
  type Labels,
} from "@/mind/memory/user/annotations";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 7, 20, minute)); // Wed 7 January 2026
const messages: Message[] = [
  { id: "a", speaker: "spica", text: "is the interview still thursday?", at: at(30) },
  { id: "b", speaker: "spica", text: "also did you ever book the train", at: at(30) },
  { id: "c", speaker: "user", text: "so\nthey moved it\nfriday now lol", at: at(41) },
  { id: "d", speaker: "user", text: "and yes booked", at: at(42) },
  { id: "e", speaker: "spica", text: "friday's close enough now", at: at(43) },
  { id: "f", speaker: "user", text: "and the night before i'm prepping", at: at(44) },
];
// Messages 1 and 2 were labelled by an earlier call; 3 to 6 are new.
const pieces = numberPieces(messages, 2);
const move = (
  id: string,
  ids: string[],
  speaker: CheckedMove["speaker"],
  act: CheckedMove["act"],
): CheckedMove => ({ id, pieces: ids, coords: [], speaker, act, repliesTo: null });
const earlier: CheckedLabels = {
  ...emptyLabels(),
  moves: [move("m1", ["1.1"], "spica", "asks"), move("m2", ["2.1"], "spica", "asks")],
};
const ctx: CheckContext = { pieces, zone: "UTC", threadIds: ["th1"], earlier };

type Proposition = Labels["propositions"][number];
const prop = (p: Partial<Proposition>): Proposition => ({
  id: "p",
  moves: [],
  subject: "user",
  kind: "event",
  label: "x",
  status: "planned",
  times: [],
  mentions: [],
  thread_id: "",
  new_thread: "",
  updates: "",
  salience: 0.7,
  valence: 0,
  confidence: 0.9,
  claim_kind: null,
  ...p,
});
const time = (t: Partial<Labels["times"][number]>): Labels["times"][number] => ({
  id: "t",
  piece: "3.3",
  words: "friday",
  from: "said",
  unit: "weekday",
  shift: 1,
  weekday: "friday",
  month: null,
  day_of_month: null,
  part: null,
  clock: "",
  span: "at",
  rough: false,
  ...t,
});
/** A reply over three bubbles correcting her first question, and a late yes to her second. */
function base(): Labels {
  return {
    moves: [
      { id: "m3", pieces: ["3.1", "3.2", "3.3"], act: "corrects", replies_to: "m1" },
      { id: "m4", pieces: ["4.1"], act: "confirms", replies_to: "m2" },
    ],
    mentions: [
      {
        id: "e1",
        piece: "3.2",
        words: "it",
        refers_to: "th1",
        name: "",
        type: null,
        subject: null,
        relation: "",
      },
    ],
    times: [time({ id: "t1", words: "Friday" })],
    propositions: [
      prop({
        id: "p1",
        moves: ["m3"],
        label: "job interview",
        times: ["t1"],
        mentions: ["e1"],
        thread_id: "th1",
      }),
      prop({ id: "p2", moves: ["m4", "m2"], label: "train ticket", status: "happened" }),
    ],
    threads: [
      {
        action: "touch",
        thread_id: "th1",
        title: "job interview",
        subject: "user",
        stakes: "high",
        checkpoint: "t1",
        propositions: ["p1"],
      },
    ],
    idiolect: [],
    relationship: null,
    intimacy: { user_disclosure: 0.1, user_responsiveness: null, moves: ["m3"] },
    bid_response: { response: "toward", move: "m4" },
  };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("a reply spread over three bubbles and a late answer to an earlier question both hold", () => {
  const out = checkLabels(base(), ctx);
  expect(out.drops).toEqual([]);
  expect(out.moves.map((m) => [m.id, m.speaker, m.repliesTo])).toEqual([
    ["m3", "user", "m1"],
    ["m4", "user", "m2"],
  ]);
  expect(out.moves[0]!.coords).toEqual([
    { turnId: "c", start: 0, end: 2 },
    { turnId: "c", start: 3, end: 16 },
    { turnId: "c", start: 17, end: 31 },
  ]);
  expect(out.times[0]!.resolved?.date).toBe("2026-01-09");
  expect(out.times[0]!.coord).toEqual({ turnId: "c", start: 17, end: 23 });
  expect(ids(out.propositions)).toEqual(["p1", "p2"]);
  expect(out.threads[0]!.checkpointAt?.date).toBe("2026-01-09");
  expect(out.bid_response).toEqual({ response: "toward", move: "m4" });
  // The model writes "" for none; what comes out says null.
  expect(out.mentions[0]).toMatchObject({ refers_to: "th1", name: null, relation: null });
  expect(out.propositions[1]).toMatchObject({ thread_id: null, new_thread: null, updates: null });
  expect(out.times[0]!.meaning.clock).toBeNull();
});

test("her guess never becomes their fact, and neither does an old fact on a new reaction", () => {
  const guess = base();
  guess.moves.push({ id: "m5", pieces: ["5.1"], act: "guesses", replies_to: "" });
  guess.propositions.push(prop({ id: "p3", moves: ["m5"], label: "studio deadline" }));
  expect(checkLabels(guess, ctx).drops).toEqual([
    { layer: "proposition", id: "p3", reason: "wrong_speaker" },
  ]);

  const reaction = base();
  reaction.moves[1] = { id: "m4", pieces: ["4.1"], act: "reacts", replies_to: "m2" };
  expect(checkLabels(reaction, ctx).drops).toEqual([
    { layer: "proposition", id: "p2", reason: "wrong_speaker" },
  ]);
});

test("labels resting only on earlier messages are not new", () => {
  const raw = base();
  raw.propositions.push(prop({ id: "p3", moves: ["m1", "m2"] }));
  raw.times.push(time({ id: "t2", piece: "1.1", words: "thursday" }));
  expect(checkLabels(raw, ctx).drops).toEqual([
    { layer: "time", id: "t2", reason: "nothing_new" },
    { layer: "proposition", id: "p3", reason: "nothing_new" },
  ]);
});

test("a move mixing speakers, or replying to something said after it, falls with what rests on it", () => {
  const fallen = [
    { layer: "proposition", id: "p1", reason: "bad_ref" },
    { layer: "thread", id: "th1", reason: "bad_ref" },
    { layer: "intimacy", id: "intimacy", reason: "bad_ref" },
  ];
  const mixed = base();
  mixed.moves[0] = { id: "m3", pieces: ["3.1", "5.1"], act: "corrects", replies_to: "m1" };
  expect(checkLabels(mixed, ctx).drops).toEqual([
    { layer: "move", id: "m3", reason: "bad_move" },
    ...fallen,
  ]);

  const backwards = base();
  backwards.moves[0] = {
    id: "m3",
    pieces: ["3.1", "3.2", "3.3"],
    act: "corrects",
    replies_to: "m4",
  };
  expect(checkLabels(backwards, ctx).drops).toEqual([
    { layer: "move", id: "m3", reason: "bad_move" },
    ...fallen,
  ]);
});

test("time words must be in their piece, and every reference must exist", () => {
  const missing = base();
  missing.times[0] = time({ id: "t1", words: "saturday" });
  expect(checkLabels(missing, ctx).drops).toEqual([
    { layer: "time", id: "t1", reason: "words_missing" },
    { layer: "proposition", id: "p1", reason: "bad_ref" },
    { layer: "thread", id: "th1", reason: "bad_ref" },
  ]);

  const broken = base();
  broken.mentions[0] = { ...broken.mentions[0]!, piece: "3-2" };
  broken.moves.push({ id: "m6", pieces: ["m3.1"], act: "states", replies_to: "" });
  broken.propositions[1] = { ...broken.propositions[1]!, thread_id: "th9" };
  const drops = checkLabels(broken, ctx).drops;
  expect(drops).toContainEqual({ layer: "move", id: "m6", reason: "bad_ref" });
  expect(drops).toContainEqual({ layer: "mention", id: "e1", reason: "bad_ref" });
  expect(drops).toContainEqual({ layer: "proposition", id: "p2", reason: "bad_ref" });
});

test("an id already used in this conversation is rejected, and the earlier label stays", () => {
  const raw = base();
  raw.moves.push({ id: "m1", pieces: ["4.1"], act: "states", replies_to: "" });
  const out = checkLabels(raw, ctx);
  expect(out.drops).toEqual([{ layer: "move", id: "m1", reason: "bad_ref" }]);
  expect(ids(out.moves)).toEqual(["m3", "m4"]);
  expect(earlier.moves[0]).toEqual(move("m1", ["1.1"], "spica", "asks"));
});

test("a time can count from another time, or from a thread that has no date yet", () => {
  const raw = base();
  raw.times.push(
    time({
      id: "t2",
      piece: "6.1",
      words: "the night before",
      from: "t1",
      unit: "day",
      shift: -1,
      weekday: null,
      part: "night",
    }),
    time({ id: "t3", from: "th1" }),
  );
  const out = checkLabels(raw, ctx);
  expect(out.times.find((t) => t.id === "t2")!.resolved).toMatchObject({
    date: "2026-01-08",
    part: "night",
  });
  expect(out.times.find((t) => t.id === "t3")).toMatchObject({ resolved: null, relativeTo: "th1" });
});

test("numbers are clamped and only her own statements carry a claim kind", () => {
  const raw = base();
  raw.propositions[0] = {
    ...raw.propositions[0]!,
    salience: 1.4,
    valence: -2,
    claim_kind: "life",
  };
  const p1 = checkLabels(raw, ctx).propositions[0]!;
  expect([p1.salience, p1.valence, p1.claim_kind]).toEqual([1, -1, null]);
});

test("idiolect is started by whoever said it first, and a bid response is the user's move", () => {
  const raw = base();
  raw.moves.push({ id: "m5", pieces: ["5.1"], act: "jokes", replies_to: "" });
  raw.idiolect = [
    { id: "i1", pieces: ["5.1", "4.1"], type: "joke" },
    { id: "i2", pieces: ["5.1"], type: "reference" },
  ];
  raw.bid_response = { response: "toward", move: "m5" };
  const out = checkLabels(raw, ctx);
  expect(out.idiolect.map((i) => [i.id, i.startedBy])).toEqual([
    ["i1", "user"],
    ["i2", "spica"],
  ]);
  expect(out.bid_response).toBeNull();
  expect(out.drops).toEqual([{ layer: "bid_response", id: "m5", reason: "wrong_speaker" }]);
});

test("the output schema converts for structured output", () => {
  expect(() => zodOutputFormat(LabelsSchema)).not.toThrow();
});

test("the output schema stays within the API's limit of 16 nullable or union-typed fields", () => {
  const unions = (node: unknown): number => {
    if (!node || typeof node !== "object") return 0;
    const own = "anyOf" in node || Array.isArray((node as { type?: unknown }).type) ? 1 : 0;
    return own + Object.values(node).reduce((n: number, child) => n + unions(child), 0);
  };
  expect(unions(zodOutputFormat(LabelsSchema).schema)).toBeLessThanOrEqual(16);
});
