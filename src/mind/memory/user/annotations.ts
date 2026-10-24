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

const MoveSchema = z.object({
  id: z.string(),
  pieces: z.array(z.string()),
  act: z.enum(ACTS),
  replies_to: z.string().nullable(),
});

const MentionSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  refers_to: z.string().nullable(),
  name: z.string().nullable(),
  type: z.enum(entityType.enumValues).nullable(),
  subject: z.enum(["user", "self"]).nullable(),
  relation: z.string().nullable(),
});

// Where the words are comes before what they mean, so the model quotes them first.
const TimeSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  from: z.string(),
  ...TimeMeaningSchema.shape,
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
  thread_id: z.string().nullable(),
  new_thread: z.string().nullable(),
  updates: z.string().nullable(),
  salience: z.number(),
  valence: z.number(),
  confidence: z.number(),
  claim_kind: z.enum(claimKind.enumValues).nullable(),
});

const ThreadActionSchema = z.object({
  action: z.enum(["open", "touch", "resolve"]),
  thread_id: z.string().nullable(),
  title: z.string(),
  subject,
  stakes: z.enum(["low", "med", "high"]),
  checkpoint: z.string().nullable(),
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

export type CheckedMove = {
  id: string;
  pieces: string[];
  coords: Coordinate[];
  speaker: Speaker;
  act: Act;
  repliesTo: string | null;
};
export type CheckedMention = Labels["mentions"][number] & { coord: Coordinate };
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
export type CheckedProposition = Labels["propositions"][number];
export type CheckedThread = Labels["threads"][number] & { checkpointAt: ResolvedTime | null };
export type CheckedIdiolect = Labels["idiolect"][number] & { startedBy: Speaker };

export type DropReason =
  "bad_ref" | "nothing_new" | "bad_move" | "words_missing" | "wrong_speaker" | "bad_time";
export type Drop = { layer: string; id: string; reason: DropReason };

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
 * reason, and so is any label resting on a dropped one; nothing is asked again.
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
        this.drop("move", m.id, "bad_ref");
        continue;
      }
      if (!cited.some((p) => p.isNew)) {
        this.drop("move", m.id, "nothing_new");
        continue;
      }
      const speaker = cited[0]!.message.speaker;
      if (cited.some((p) => p.message.speaker !== speaker)) {
        this.drop("move", m.id, "bad_move");
        continue;
      }
      if (m.replies_to !== null) {
        const target = this.allMoves.get(m.replies_to);
        // A target that exists but hasn't been reached yet starts after this move.
        if (!target) {
          this.drop("move", m.id, this.rawMoves.has(m.replies_to) ? "bad_move" : "bad_ref");
          continue;
        }
        if (this.first(target.pieces) >= this.first(m.pieces)) {
          this.drop("move", m.id, "bad_move");
          continue;
        }
      }
      const move: CheckedMove = {
        id: m.id,
        pieces: m.pieces,
        coords: cited.map(coordinate),
        speaker,
        act: m.act,
        repliesTo: m.replies_to,
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
      if (!piece || (m.refers_to !== null && !this.openThreads.has(m.refers_to))) {
        this.drop("mention", m.id, "bad_ref");
        continue;
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
      kept.push({ ...m, coord });
    }
    return kept;
  }

  times(raw: Labels["times"]): CheckedTime[] {
    const kept: CheckedTime[] = [];
    for (const t of raw) {
      const { id, piece: pieceId, words, from, ...meaning } = t;
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
      const base = this.base(from, piece);
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
      const moves = p.moves.map((id) => this.allMoves.get(id));
      const broken =
        moves.length === 0 ||
        moves.some((m) => !m) ||
        p.times.some((id) => !this.allTimes.has(id)) ||
        p.mentions.some((id) => !this.allMentions.has(id)) ||
        (p.thread_id !== null && !this.openThreads.has(p.thread_id)) ||
        (p.updates !== null && !this.allPropositions.has(p.updates));
      if (broken) {
        this.drop("proposition", p.id, "bad_ref");
        continue;
      }
      const fresh = (moves as CheckedMove[]).filter((m) => this.isNew(m.pieces));
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
      const checkpoint = t.checkpoint === null ? null : this.allTimes.get(t.checkpoint);
      const broken =
        (t.thread_id !== null && !this.openThreads.has(t.thread_id)) ||
        checkpoint === undefined ||
        t.propositions.some((id) => !this.allPropositions.has(id));
      if (broken) {
        this.drop("thread", t.thread_id ?? t.title, "bad_ref");
        continue;
      }
      kept.push({ ...t, checkpointAt: checkpoint?.resolved ?? null });
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

  relationship(raw: Labels["relationship"]): Labels["relationship"] {
    if (!raw) return null;
    const cited = [...raw.moves, ...(raw.hurt?.moves ?? [])];
    if (cited.every((id) => this.allMoves.has(id))) return raw;
    this.drop("relationship", "relationship", "bad_ref");
    return null;
  }

  intimacy(raw: Labels["intimacy"]): Labels["intimacy"] {
    if (!raw) return null;
    if (raw.moves.every((id) => this.allMoves.has(id))) return raw;
    this.drop("intimacy", "intimacy", "bad_ref");
    return null;
  }

  bid(raw: Labels["bid_response"]): Labels["bid_response"] {
    if (!raw) return null;
    const move = this.allMoves.get(raw.move);
    if (!move) {
      this.drop("bid_response", raw.move, "bad_ref");
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
  ): { date: string | null; relativeTo: string | null } | null {
    if (from === "said") {
      return { date: localDateString(piece.message.at, this.ctx.zone), relativeTo: null };
    }
    const other = this.allTimes.get(from);
    if (other) return { date: other.resolved?.date ?? null, relativeTo: other.relativeTo };
    if (this.openThreads.has(from)) return { date: null, relativeTo: from };
    return null;
  }

  private drop(layer: string, id: string, reason: DropReason): void {
    this.drops.push({ layer, id, reason });
  }

  /** Claims an id for this conversation; one already used is a broken reference. */
  private claim(layer: string, id: string): boolean {
    if (this.taken.has(id)) {
      this.drop(layer, id, "bad_ref");
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

function speaks(speaker: Speaker, about: Labels["propositions"][number]["subject"]): boolean {
  return about === "shared" || (about === "user") === (speaker === "user");
}
