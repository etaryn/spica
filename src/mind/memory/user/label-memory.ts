/**
 * From one call's checked labels to what the cold path writes: a memory per proposition and per
 * idiolect label, worded by code (its line, `memoryLine`), dated by its first time, and how the
 * user treated her (the relationship, intimacy and bid blocks) in the shapes the relationship
 * reads. `all` is the conversation's labels so far, this call's included: a memory may rest on
 * an earlier move.
 */
import type { factKind, claimKind } from "@/db/schema";
import type { Config } from "@/mind/platform/config";
import { labelInstant } from "@/mind/platform/time-labels";
import {
  normalizeBid,
  normalizeIntimacy,
  normalizeSignals,
  type BidResponse,
  type Signals,
} from "@/mind/state/user/relationship/signals";
import type { Intimacy } from "@/mind/state/user/relationship/types";
import type { CheckedLabels, CheckedMove } from "./annotations";
import type { IdiolectPayload } from "./idiolect";
import { embedText, memoryLine, moveText, quoted, type LineMove } from "./memory-line";
import type { Piece } from "./pieces";

export type MemoryPlan = {
  /** The proposition's or idiolect label's id in this conversation; null for her hurt. */
  localId: string | null;
  subject: "user" | "self" | "shared";
  kind: (typeof factKind.enumValues)[number];
  content: string;
  embedText: string;
  occurred_at: Date | null;
  salience: number;
  valence: number;
  confidence: number;
  claim_kind: (typeof claimKind.enumValues)[number] | null;
  mentions: string[];
  threadId: string | null;
  newThread: string | null;
  updates: string | null;
  idiolect: IdiolectPayload | null;
};

export function memoryPlans(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  zone: string,
  settings: Config["extraction"],
): MemoryPlan[] {
  const moves = new Map(all.moves.map((m) => [m.id, m]));
  const times = new Map(all.times.map((t) => [t.id, t]));
  const words = (ids: string[]): LineMove[] =>
    ids
      .map((id) => moves.get(id))
      .filter((m): m is CheckedMove => !!m)
      .sort((a, b) => order(pieces, a) - order(pieces, b))
      .map((m) => ({ speaker: m.speaker, act: m.act, text: moveText(m, pieces) }));

  const propositions = labels.propositions.map((p): MemoryPlan => {
    const said = words(p.moves);
    const resolved = p.times.flatMap((id) => times.get(id)?.resolved ?? []);
    return {
      localId: p.id,
      subject: p.subject,
      kind: p.kind,
      content: memoryLine(p, said, resolved, zone, settings.quote_chars),
      embedText: embedText(p.label, said, settings.quote_chars),
      occurred_at: resolved[0] ? labelInstant(resolved[0], zone) : null,
      salience: p.salience,
      valence: p.valence,
      confidence: p.confidence,
      claim_kind: p.claim_kind,
      mentions: p.mentions,
      threadId: p.thread_id,
      newThread: p.new_thread,
      updates: p.updates,
      idiolect: null,
    };
  });
  const idiolect = labels.idiolect.map((i): MemoryPlan => {
    const said = byPiece(i.pieces, pieces);
    return {
      localId: i.id,
      subject: "shared",
      kind: "idiolect",
      content: quoted(said, settings.quote_chars),
      embedText: said.map((m) => m.text).join(" / "),
      occurred_at: null,
      ...settings.idiolect,
      claim_kind: null,
      mentions: [],
      threadId: null,
      newThread: null,
      updates: null,
      idiolect: { type: i.type, started_by: i.startedBy, established_at: null },
    };
  });
  return [...propositions, ...idiolect];
}

/** What hurt her, in their words: the moves named, or all their new moves when none was. */
export function hurtCause(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  quoteChars: number,
): string {
  const named = new Set(labels.relationship?.hurt?.moves ?? []);
  const theirs = all.moves.filter((m) => m.speaker === "user" && !m.context);
  const hurting = named.size
    ? theirs.filter((m) => named.has(m.id))
    : theirs.filter((m) => labels.moves.includes(m));
  return quoted(
    hurting.map((m) => ({ speaker: m.speaker, act: "states" as const, text: moveText(m, pieces) })),
    quoteChars,
  );
}

/** The relationship, intimacy and bid blocks in the shapes the relationship update reads. */
export function signalsOf(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  quoteChars: number,
): { signals: Signals | null; intimacy: Intimacy | null; bid: BidResponse | null } {
  const r = labels.relationship;
  const signals = r
    ? normalizeSignals({
        ...r,
        hurt: r.hurt && {
          amount: r.hurt.amount,
          cause: hurtCause(labels, all, pieces, quoteChars),
        },
      })
    : null;
  return {
    signals,
    intimacy: normalizeIntimacy(labels.intimacy),
    bid: normalizeBid(labels.bid_response?.response ?? null),
  };
}

function order(pieces: Piece[], m: CheckedMove): number {
  return Math.min(...m.pieces.map((id) => pieces.findIndex((p) => p.id === id)));
}

/** The pieces' words, one quote per run of one speaker, its pieces joined as a move's are. */
function byPiece(ids: string[], pieces: Piece[]): LineMove[] {
  const out: LineMove[] = [];
  for (const id of ids) {
    const p = pieces.find((x) => x.id === id);
    if (!p) continue;
    const last = out.at(-1);
    if (last?.speaker === p.message.speaker) last.text = `${last.text} / ${p.text}`;
    else out.push({ speaker: p.message.speaker, act: "states", text: p.text });
  }
  return out;
}
