/**
 * Labels: what one call reads in a stretch of conversation, layer by layer, and the checks that
 * hold them to the transcript. The model points at numbered pieces and quotes words; code knows who
 * said each piece and when, works out every date, and drops any label the transcript doesn't
 * support. Moves come first, and every higher layer points at the layers below it.
 */
import { z } from "zod";
import { claimKind, entityType, factKind } from "@/db/schema";
import { clamp } from "@/mind/platform/math";
import {
  countFrom,
  resolveTime,
  TimeMeaningSchema,
  type ResolvedTime,
  type TimeMeaning,
} from "@/mind/platform/time-labels";
import { localDateString } from "@/mind/platform/timezone";
import {
  BID_RESPONSES,
  IntimacySchema,
  RelationshipSignalsSchema,
} from "@/mind/state/user/relationship/signals";
import { IDIOLECT_TYPES } from "./idiolect";
import { coordinate, findPhrase, type Coordinate, type Piece, type Speaker } from "./pieces";

export const ACTS = [
  "states",
  "answers",
  "confirms",
  "denies",
  "corrects",
  "asks",
  "guesses",
  "jokes",
  "imagines",
  "offers",
  "requests",
  "promises",
  "bids",
  "reacts",
] as const;
export type Act = (typeof ACTS)[number];
/** The acts that present something as true: only these can carry a memory. */
const ASSERTING = new Set<Act>(["states", "answers", "confirms", "denies", "corrects"]);

// Her notes (summaries, reads, ideas…) are written later from memories, never read off a
// conversation; idiolect is a layer of its own.
const propositionKind = z
  .enum(factKind.enumValues)
  .exclude(["summary", "reflection", "idea", "episode", "model", "belief", "idiolect"]);
const subject = z.enum(["user", "self", "shared"]);
// Optional ids and names are an empty string when there is none, not null: the API refuses a
// schema with more than 16 nullable fields. Code turns "" back into null on the way in.
const optional = z.string();

const MoveSchema = z.object({
  id: z.string(),
  pieces: z.array(z.string()),
  act: z.enum(ACTS),
  replies_to: optional,
});

const MentionSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  refers_to: optional,
  name: optional,
  type: z.enum(entityType.enumValues).nullable(),
  subject: z.enum(["user", "self"]).nullable(),
  relation: optional,
});

// Where the words are comes before what they mean, so the model quotes them first.
const TimeSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  from: z.string(),
  ...TimeMeaningSchema.shape,
  clock: optional,
});

const PropositionSchema = z.object({
  id: z.string(),
  moves: z.array(z.string()),
  subject,
  kind: propositionKind,
  label: z.string(),
  status: z.enum(["planned", "happened", "ongoing", "cancelled"]).nullable(),
  times: z.array(z.string()),
  mentions: z.array(z.string()),
  thread_id: optional,
  new_thread: optional,
  updates: optional,
  salience: z.number(),
  valence: z.number(),
  confidence: z.number(),
  claim_kind: z.enum(claimKind.enumValues).nullable(),
});

const ThreadActionSchema = z.object({
  action: z.enum(["open", "touch", "resolve"]),
  thread_id: optional,
  title: z.string(),
  subject,
  stakes: z.enum(["low", "med", "high"]),
  checkpoint: optional,
  propositions: z.array(z.string()),
});

const IdiolectSchema = z.object({
  id: z.string(),
  pieces: z.array(z.string()),
  type: z.enum(IDIOLECT_TYPES),
});

const RelationshipSchema = RelationshipSignalsSchema.omit({ hurt: true }).extend({
  hurt: z.object({ amount: z.number(), moves: z.array(z.string()) }).nullable(),
  moves: z.array(z.string()),
});

/** The labelling call's output, its layers in the order the model writes them. */
export const LabelsSchema = z.object({
  moves: z.array(MoveSchema),
  mentions: z.array(MentionSchema),
  times: z.array(TimeSchema),
  propositions: z.array(PropositionSchema),
  threads: z.array(ThreadActionSchema),
  idiolect: z.array(IdiolectSchema),
  relationship: RelationshipSchema.nullable(),
  intimacy: IntimacySchema.extend({ moves: z.array(z.string()) }).nullable(),
  bid_response: z.object({ response: z.enum(BID_RESPONSES), move: z.string() }).nullable(),
});
export type Labels = z.infer<typeof LabelsSchema>;

// The output grammar for every layer at once is over the API's size limit, so a stretch is labelled
// in two calls: first what the text holds (moves, mentions, times), then what it means, which
// points at them.
export const ReadingSchema = LabelsSchema.pick({ moves: true, mentions: true, times: true });
export const MeaningSchema = LabelsSchema.omit({ moves: true, mentions: true, times: true });

export type CheckedMove = {
  id: string;
  pieces: string[];
  coords: Coordinate[];
  speaker: Speaker;
  act: Act;
  repliesTo: string | null;
  /** On an earlier message that had no move yet: there so replies can point at it, never news. */
  context: boolean;
};
type Nulled<T, K extends keyof T> = Omit<T, K> & { [P in K]: string | null };
export type CheckedMention = Nulled<
  Labels["mentions"][number],
  "refers_to" | "name" | "relation"
> & {
  coord: Coordinate;
};
export type CheckedTime = {
  id: string;
  piece: string;
  words: string;
  coord: Coordinate;
  from: string;
  meaning: TimeMeaning;
  /** Null only while it counts from a thread, which holds no date of its own yet. */
  resolved: ResolvedTime | null;
  relativeTo: string | null;
};
export type CheckedProposition = Nulled<
  Labels["propositions"][number],
  "thread_id" | "new_thread" | "updates"
>;
export type CheckedThread = Nulled<Labels["threads"][number], "thread_id" | "checkpoint"> & {
  checkpointAt: ResolvedTime | null;
};
export type CheckedIdiolect = Labels["idiolect"][number] & { startedBy: Speaker };

export type DropReason =
  | "bad_ref"
  | "nothing_new"
  | "bad_move"
  | "words_missing"
  | "wrong_speaker"
  | "bad_time"
  // The label stays; only the link named in `ref` is removed.
  | "bad_link";
export type Drop = { layer: string; id: string; reason: DropReason; ref?: string };

export type CheckedLabels = {
  moves: CheckedMove[];
  mentions: CheckedMention[];
  times: CheckedTime[];
  propositions: CheckedProposition[];
  threads: CheckedThread[];
  idiolect: CheckedIdiolect[];
  relationship: Labels["relationship"];
  intimacy: Labels["intimacy"];
  bid_response: Labels["bid_response"];
  drops: Drop[];
};

export type CheckContext = {
  /** Every piece shown, old and new, in conversation order. */
  pieces: Piece[];
  zone: string;
  /** The ids of the open threads shown. */
  threadIds: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

export function emptyLabels(): CheckedLabels {
  return {
    moves: [],
    mentions: [],
    times: [],
    propositions: [],
    threads: [],
    idiolect: [],
    relationship: null,
    intimacy: null,
    bid_response: null,
    drops: [],
  };
}

/** What a conversation has labelled so far, plus one more call's labels. */
export function mergeLabels(a: CheckedLabels, b: CheckedLabels): CheckedLabels {
  return {
    moves: [...a.moves, ...b.moves],
    mentions: [...a.mentions, ...b.mentions],
    times: [...a.times, ...b.times],
    propositions: [...a.propositions, ...b.propositions],
    threads: [...a.threads, ...b.threads],
    idiolect: [...a.idiolect, ...b.idiolect],
    relationship: b.relationship,
    intimacy: b.intimacy,
    bid_response: b.bid_response,
    drops: [...a.drops, ...b.drops],
  };
}

/**
 * Holds one call's labels to the transcript. A label that fails a check is dropped with its
 * reason, and so is a memory resting on a dropped move. A broken link (a reply, a time, a thread)
 * loses only the link: the label it hung from stays. Nothing is asked again.
 */
export function checkLabels(raw: Labels, ctx: CheckContext): CheckedLabels {
  const check = new Checker(ctx, raw);
  const moves = check.moves(raw.moves);
  const mentions = check.mentions(raw.mentions);
  const times = check.times(raw.times);
  const propositions = check.propositions(raw.propositions);
  const threads = check.threads(raw.threads);
  const idiolect = check.idiolect(raw.idiolect);
  const relationship = check.relationship(raw.relationship);
  const intimacy = check.intimacy(raw.intimacy);
  const bid_response = check.bid(raw.bid_response);
  return {
    moves,
    mentions,
    times,
    propositions,
    threads,
    idiolect,
    relationship,
    intimacy,
    bid_response,
    drops: check.drops,
  };
}

class Checker {
  readonly drops: Drop[] = [];
  private readonly pieces: Map<string, Piece>;
  private readonly order: Map<string, number>;
  private readonly openThreads: Set<string>;
  private readonly rawMoves: Set<string>;
  private readonly taken: Set<string>;
  private readonly allMoves: Map<string, CheckedMove>;
  private readonly allMentions: Set<string>;
  private readonly allTimes: Map<string, CheckedTime>;
  private readonly allPropositions: Set<string>;
  private readonly labelledPieces: Set<string>;

  constructor(
    private readonly ctx: CheckContext,
    raw: Labels,
  ) {
    const e = ctx.earlier;
    this.pieces = new Map(ctx.pieces.map((p) => [p.id, p]));
    this.order = new Map(ctx.pieces.map((p, i) => [p.id, i]));
    this.openThreads = new Set(ctx.threadIds);
    this.rawMoves = new Set(raw.moves.map((m) => m.id));
    this.allMoves = new Map(e.moves.map((m) => [m.id, m]));
    this.allMentions = new Set(e.mentions.map((m) => m.id));
    this.allTimes = new Map(e.times.map((t) => [t.id, t]));
    this.allPropositions = new Set(e.propositions.map((p) => p.id));
    this.labelledPieces = new Set(e.moves.flatMap((m) => m.pieces));
    this.taken = new Set([
      ...this.allMoves.keys(),
      ...this.allMentions,
      ...this.allTimes.keys(),
      ...this.allPropositions,
      ...e.idiolect.map((i) => i.id),
    ]);
  }

  moves(raw: Labels["moves"]): CheckedMove[] {
    const kept: CheckedMove[] = [];
    // In conversation order, so a reply's target is checked before the reply.
    for (const m of [...raw].sort((a, b) => this.first(a.pieces) - this.first(b.pieces))) {
      if (!this.claim("move", m.id)) continue;
      const cited = this.cite(m.pieces);
      if (!cited) {
        this.drop("move", m.id, "bad_ref", `pieces ${m.pieces.join(" ")}`);
        continue;
      }
      // An earlier message with no move yet may be labelled, so a reply can point at it; one that
      // already has its move is not labelled twice.
      const context = !cited.some((p) => p.isNew);
      if (context && cited.some((p) => this.labelledPieces.has(p.id))) {
        this.drop("move", m.id, "nothing_new");
        continue;
      }
      const speaker = cited[0]!.message.speaker;
      if (cited.some((p) => p.message.speaker !== speaker)) {
        this.drop("move", m.id, "bad_move");
        continue;
      }
      let repliesTo = none(m.replies_to);
      if (repliesTo !== null) {
        const target = this.allMoves.get(repliesTo);
        // A reply points back: at a move already checked, which starts before this one.
        if (!target || this.first(target.pieces) >= this.first(m.pieces)) {
          this.drop("move", m.id, "bad_link", `replies_to ${repliesTo}`);
          repliesTo = null;
        }
      }
      const move: CheckedMove = {
        id: m.id,
        pieces: m.pieces,
        coords: cited.map(coordinate),
        speaker,
        act: m.act,
        repliesTo,
        context,
      };
      this.allMoves.set(m.id, move);
      kept.push(move);
    }
    return kept;
  }

  mentions(raw: Labels["mentions"]): CheckedMention[] {
    const kept: CheckedMention[] = [];
    for (const m of raw) {
      if (!this.claim("mention", m.id)) continue;
      const piece = this.pieces.get(m.piece);
      if (!piece) {
        this.drop("mention", m.id, "bad_ref", `piece ${m.piece}`);
        continue;
      }
      let refersTo = none(m.refers_to);
      if (refersTo !== null && !this.openThreads.has(refersTo)) {
        this.drop("mention", m.id, "bad_link", `refers_to ${refersTo}`);
        refersTo = null;
      }
      if (!piece.isNew) {
        this.drop("mention", m.id, "nothing_new");
        continue;
      }
      const coord = findPhrase(piece, m.words);
      if (!coord) {
        this.drop("mention", m.id, "words_missing");
        continue;
      }
      this.allMentions.add(m.id);
      kept.push({
        ...m,
        refers_to: refersTo,
        name: none(m.name),
        relation: none(m.relation),
        coord,
      });
    }
    return kept;
  }

  times(raw: Labels["times"]): CheckedTime[] {
    const kept: CheckedTime[] = [];
    for (const t of raw) {
      const { id, piece: pieceId, words, from, clock, ...rest } = t;
      const meaning: TimeMeaning = { ...rest, clock: none(clock) };
      if (!this.claim("time", id)) continue;
      const piece = this.pieces.get(pieceId);
      if (!piece) {
        this.drop("time", id, "bad_ref");
        continue;
      }
      if (!piece.isNew) {
        this.drop("time", id, "nothing_new");
        continue;
      }
      const coord = findPhrase(piece, words);
      if (!coord) {
        this.drop("time", id, "words_missing");
        continue;
      }
      const base = this.base(from, piece, meaning.unit);
      if (!base) {
        this.drop("time", id, "bad_ref");
        continue;
      }
      // A meaning that can't resolve from any day is malformed, whatever it counts from.
      const said = localDateString(piece.message.at, this.ctx.zone);
      const resolved = resolveTime(meaning, base.date ?? said);
      if (!resolved) {
        this.drop("time", id, "bad_time");
        continue;
      }
      const time: CheckedTime = {
        id,
        piece: pieceId,
        words,
        coord,
        from,
        meaning,
        resolved: base.date === null ? null : resolved,
        relativeTo: base.relativeTo,
      };
      this.allTimes.set(id, time);
      kept.push(time);
    }
    return kept;
  }

  propositions(raw: Labels["propositions"]): CheckedProposition[] {
    const kept: CheckedProposition[] = [];
    for (const p of raw) {
      if (!this.claim("proposition", p.id)) continue;
      // A memory stands on its moves: without them it falls. Its other links are only links.
      const missing = p.moves.filter((id) => !this.allMoves.has(id));
      if (p.moves.length === 0 || missing.length) {
        this.drop("proposition", p.id, "bad_ref", `moves ${missing.join(" ") || "none"}`);
        continue;
      }
      const moves = p.moves.map((id) => this.allMoves.get(id)!);
      const times = this.keep("proposition", p.id, "times", p.times, (id) => this.allTimes.has(id));
      const mentions = this.keep("proposition", p.id, "mentions", p.mentions, (id) =>
        this.allMentions.has(id),
      );
      const threadId = this.known("proposition", p.id, "thread_id", none(p.thread_id), (id) =>
        this.openThreads.has(id),
      );
      const updates = this.known("proposition", p.id, "updates", none(p.updates), (id) =>
        this.allPropositions.has(id),
      );
      const fresh = moves.filter((m) => this.isNew(m.pieces));
      if (fresh.length === 0) {
        this.drop("proposition", p.id, "nothing_new");
        continue;
      }
      // Only something said now, by the one it's about, makes it theirs: an old statement can't
      // come back in on a new "lol", and her guess about them is never their fact.
      if (!fresh.some((m) => ASSERTING.has(m.act) && speaks(m.speaker, p.subject))) {
        this.drop("proposition", p.id, "wrong_speaker");
        continue;
      }
      this.allPropositions.add(p.id);
      kept.push({
        ...p,
        times,
        mentions,
        thread_id: threadId,
        new_thread: none(p.new_thread),
        updates,
        salience: clamp(p.salience, 0, 1),
        valence: clamp(p.valence, -1, 1),
        confidence: clamp(p.confidence, 0, 1),
        // Only her own statements are claims.
        claim_kind: p.subject === "self" ? p.claim_kind : null,
      });
    }
    return kept;
  }

  threads(raw: Labels["threads"]): CheckedThread[] {
    const kept: CheckedThread[] = [];
    for (const t of raw) {
      const threadId = none(t.thread_id);
      // Touching or resolving a thread nobody showed has nothing to act on.
      if (threadId !== null && !this.openThreads.has(threadId)) {
        this.drop("thread", threadId, "bad_ref", `thread_id ${threadId}`);
        continue;
      }
      const label = threadId ?? t.title;
      const checkpointId = this.known("thread", label, "checkpoint", none(t.checkpoint), (id) =>
        this.allTimes.has(id),
      );
      const propositions = this.keep("thread", label, "propositions", t.propositions, (id) =>
        this.allPropositions.has(id),
      );
      kept.push({
        ...t,
        thread_id: threadId,
        checkpoint: checkpointId,
        propositions,
        checkpointAt: checkpointId === null ? null : this.allTimes.get(checkpointId)!.resolved,
      });
    }
    return kept;
  }

  idiolect(raw: Labels["idiolect"]): CheckedIdiolect[] {
    const kept: CheckedIdiolect[] = [];
    for (const i of raw) {
      if (!this.claim("idiolect", i.id)) continue;
      const cited = this.cite(i.pieces);
      if (!cited) {
        this.drop("idiolect", i.id, "bad_ref");
        continue;
      }
      if (!cited.some((p) => p.isNew)) {
        this.drop("idiolect", i.id, "nothing_new");
        continue;
      }
      const earliest = [...cited].sort((a, b) => this.first([a.id]) - this.first([b.id]))[0]!;
      kept.push({ ...i, startedBy: earliest.message.speaker });
    }
    return kept;
  }

  // The scores stand on their own; the moves they cite are only where they were read from.
  relationship(raw: Labels["relationship"]): Labels["relationship"] {
    if (!raw) return null;
    const known = (id: string) => this.allMoves.has(id);
    const moves = this.keep("relationship", "relationship", "moves", raw.moves, known);
    const hurt = raw.hurt && {
      ...raw.hurt,
      moves: this.keep("relationship", "relationship", "hurt.moves", raw.hurt.moves, known),
    };
    return { ...raw, moves, hurt };
  }

  intimacy(raw: Labels["intimacy"]): Labels["intimacy"] {
    if (!raw) return null;
    const moves = this.keep("intimacy", "intimacy", "moves", raw.moves, (id) =>
      this.allMoves.has(id),
    );
    return { ...raw, moves };
  }

  bid(raw: Labels["bid_response"]): Labels["bid_response"] {
    if (!raw) return null;
    const move = this.allMoves.get(raw.move);
    if (!move) {
      this.drop("bid_response", raw.move, "bad_ref", `move ${raw.move}`);
      return null;
    }
    // A bid response is how the user met her bid, so it is always one of their moves.
    if (move.speaker !== "user") {
      this.drop("bid_response", raw.move, "wrong_speaker");
      return null;
    }
    return raw;
  }

  /** The day a time counts from: the day it was said, another time's day, or a thread's. */
  private base(
    from: string,
    piece: Piece,
    unit: TimeMeaning["unit"],
  ): { date: string | null; relativeTo: string | null } | null {
    if (from === "said") {
      return { date: localDateString(piece.message.at, this.ctx.zone), relativeTo: null };
    }
    const other = this.allTimes.get(from);
    if (other) {
      const date = other.resolved ? countFrom(other.resolved, unit) : null;
      return { date, relativeTo: other.relativeTo };
    }
    if (this.openThreads.has(from)) return { date: null, relativeTo: from };
    return null;
  }

  private drop(layer: string, id: string, reason: DropReason, ref?: string): void {
    this.drops.push(ref === undefined ? { layer, id, reason } : { layer, id, reason, ref });
  }

  /** The ids that point somewhere real; the rest are recorded as broken links and left out. */
  private keep(
    layer: string,
    id: string,
    field: string,
    ids: string[],
    exists: (id: string) => boolean,
  ): string[] {
    const broken = ids.filter((x) => !exists(x));
    if (broken.length) this.drop(layer, id, "bad_link", `${field} ${broken.join(" ")}`);
    return ids.filter(exists);
  }

  /** One optional link: kept when it points somewhere real, otherwise recorded and cleared. */
  private known(
    layer: string,
    id: string,
    field: string,
    value: string | null,
    exists: (id: string) => boolean,
  ): string | null {
    if (value === null || exists(value)) return value;
    this.drop(layer, id, "bad_link", `${field} ${value}`);
    return null;
  }

  /** Claims an id for this conversation; one already used is a broken reference. */
  private claim(layer: string, id: string): boolean {
    if (this.taken.has(id)) {
      this.drop(layer, id, "bad_ref", "id already used");
      return false;
    }
    this.taken.add(id);
    return true;
  }

  /** The cited pieces, or null when there are none or any is missing. */
  private cite(ids: string[]): Piece[] | null {
    const found = ids.map((id) => this.pieces.get(id));
    if (found.length === 0 || found.some((p) => !p)) return null;
    return found as Piece[];
  }

  private first(ids: string[]): number {
    return Math.min(...ids.map((id) => this.order.get(id) ?? Infinity));
  }

  private isNew(ids: string[]): boolean {
    return ids.some((id) => this.pieces.get(id)?.isNew === true);
  }
}

/** An empty string is how the model says there is none. */
function none(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function speaks(speaker: Speaker, about: Labels["propositions"][number]["subject"]): boolean {
  return about === "shared" || (about === "user") === (speaker === "user");
}
