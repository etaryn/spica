/**
 * Scripted labels for the fake provider, tests and fake-mode evals. A script names each memory
 * by words said in a new message; the handlers read the numbered pieces from the call's input the
 * way the model does, give every new message one move, and point each scripted memory, time and
 * mention at the message holding its words. Ids carry a hash of the words, so they stay unique
 * as a conversation grows. Never sent to a model.
 */
import type { TimeMeaning } from "@/mind/platform/time-labels";

export type ScriptedMemory = {
  said: string;
  label: string;
  id?: string;
  subject?: "user" | "self" | "shared";
  kind?: string;
  status?: string | null;
  act?: string;
  time?: { words: string } & Partial<TimeMeaning>;
  mention?: {
    words: string;
    name: string;
    type?: string;
    subject?: "user" | "self";
    relation?: string;
  };
  thread_id?: string;
  new_thread?: string;
  updates?: string;
  salience?: number;
  valence?: number;
  confidence?: number;
  claim_kind?: string | null;
};
export type ScriptedSignals = {
  warmth?: number;
  trust?: number;
  tension?: number;
  hurt?: { amount: number; said?: string } | null;
  apology?: boolean;
  make_up?: boolean;
  ends_relationship?: boolean;
  retracts_ending?: boolean;
  wants_repair?: boolean;
};
export type LabelScript = {
  memories?: ScriptedMemory[];
  threads?: {
    action: "open" | "touch" | "resolve";
    title: string;
    thread_id?: string;
    subject?: string;
    stakes?: string;
    checkpoint?: string;
    propositions?: string[];
  }[];
  idiolect?: { said: string; type: string }[];
  relationship?: ScriptedSignals | null;
  intimacy?: { user_disclosure: number; user_responsiveness: number | null } | null;
  bid?: "toward" | "away" | "against" | null;
};
type NewMessage = { message: number; speaker: "user" | "spica"; pieces: string[]; text: string };
type Handlers = Record<
  "labels_read" | "labels_meaning" | "labels_signals",
  (input: string) => unknown
>;

const PIECE = /^\[(\d+)\.(\d+)\] (User|Spica)(?: · .*?\))?: (.*)$/;
const RANGE = /^Label the new messages \((\d+)(?: to (\d+))?\)\.$/m;

export function newMessages(input: string): NewMessage[] {
  const range = RANGE.exec(input);
  if (!range) return [];
  const [first, last] = [Number(range[1]), Number(range[2] ?? range[1])];
  const conversation = input.split("Conversation:\n")[1]?.split("\n\n")[0] ?? "";
  const byNumber = new Map<number, NewMessage>();
  for (const line of conversation.split("\n")) {
    const m = PIECE.exec(line);
    if (!m) continue;
    const message = Number(m[1]);
    if (message < first || message > last) continue;
    const msg = byNumber.get(message) ?? {
      message,
      speaker: m[3] === "User" ? ("user" as const) : ("spica" as const),
      pieces: [],
      text: "",
    };
    msg.pieces.push(`${m[1]}.${m[2]}`);
    msg.text = msg.text ? `${msg.text} ${m[4]}` : m[4]!;
    byNumber.set(message, msg);
  }
  return [...byNumber.values()];
}

export function scriptedLabels(script: LabelScript | ((input: string) => LabelScript)): Handlers {
  const at = (input: string) => {
    const s = typeof script === "function" ? script(input) : script;
    const messages = newMessages(input);
    const holding = (words: string) =>
      messages.find((m) => m.text.toLowerCase().includes(words.toLowerCase()));
    const moveId = (m: NewMessage) => `m${m.message}-${hash(m.text)}`;
    const pieceOf = (m: NewMessage, words: string) => pieceHolding(input, m, words) ?? m.pieces[0]!;
    return { s, messages, holding, moveId, pieceOf };
  };
  return {
    labels_read: (input) => {
      const { s, messages, holding, moveId, pieceOf } = at(input);
      const scripted = (m: NewMessage) =>
        s.memories?.find((x) => holding(x.said) === m && x.act)?.act;
      return {
        moves: messages.map((m) => ({
          id: moveId(m),
          pieces: m.pieces,
          act: scripted(m) ?? "states",
          replies_to: "",
        })),
        mentions: (s.memories ?? []).flatMap((x) => {
          const m = x.mention && holding(x.mention.words);
          if (!x.mention || !m) return [];
          return [
            {
              id: `e-${hash(x.mention.words)}`,
              piece: pieceOf(m, x.mention.words),
              words: x.mention.words,
              refers_to: "",
              name: x.mention.name,
              type: x.mention.type ?? "other",
              subject: x.mention.subject ?? "user",
              relation: x.mention.relation ?? "",
            },
          ];
        }),
        times: (s.memories ?? []).flatMap((x) => {
          const m = x.time && holding(x.time.words);
          if (!x.time || !m) return [];
          const { words, ...meaning } = x.time;
          return [
            {
              id: `t-${hash(words + x.label)}`,
              piece: pieceOf(m, words),
              words,
              from: "said",
              unit: "day",
              shift: 0,
              weekday: null,
              month: null,
              day_of_month: null,
              part: null,
              span: "at",
              rough: false,
              ...meaning,
              clock: meaning.clock ?? "",
            },
          ];
        }),
      };
    },
    labels_meaning: (input) => {
      const { s, holding, moveId } = at(input);
      return {
        propositions: (s.memories ?? []).flatMap((x) => {
          const m = holding(x.said);
          if (!m) return [];
          return [
            {
              id: x.id ?? `p-${hash(x.label + x.said)}`,
              moves: [moveId(m)],
              subject: x.subject ?? (m.speaker === "user" ? "user" : "self"),
              kind: x.kind ?? "event",
              label: x.label,
              status: x.status ?? null,
              times: x.time && holding(x.time.words) ? [`t-${hash(x.time.words + x.label)}`] : [],
              mentions: x.mention && holding(x.mention.words) ? [`e-${hash(x.mention.words)}`] : [],
              thread_id: x.thread_id ?? "",
              new_thread: x.new_thread ?? "",
              updates: x.updates ?? "",
              salience: x.salience ?? 0.7,
              valence: x.valence ?? 0,
              confidence: x.confidence ?? 0.9,
              claim_kind: x.claim_kind ?? null,
            },
          ];
        }),
        threads: (s.threads ?? []).map((t) => ({
          action: t.action,
          thread_id: t.thread_id ?? "",
          title: t.title,
          subject: t.subject ?? "user",
          stakes: t.stakes ?? "med",
          checkpoint: t.checkpoint ?? "",
          propositions: t.propositions ?? [],
        })),
      };
    },
    labels_signals: (input) => {
      const { s, messages, holding, moveId } = at(input);
      const userMoves = messages.filter((m) => m.speaker === "user").map(moveId);
      const r = s.relationship;
      const hurtAt = r?.hurt?.said ? holding(r.hurt.said) : undefined;
      return {
        idiolect: (s.idiolect ?? []).flatMap((i) => {
          const m = holding(i.said);
          return m ? [{ id: `i-${hash(i.said)}`, pieces: m.pieces, type: i.type }] : [];
        }),
        relationship: r
          ? {
              warmth: r.warmth ?? 0,
              trust: r.trust ?? 0,
              tension: r.tension ?? 0,
              hurt: r.hurt
                ? { amount: r.hurt.amount, moves: hurtAt ? [moveId(hurtAt)] : [] }
                : null,
              apology: r.apology ?? false,
              make_up: r.make_up ?? false,
              ends_relationship: r.ends_relationship ?? false,
              retracts_ending: r.retracts_ending ?? false,
              wants_repair: r.wants_repair ?? false,
              moves: userMoves,
            }
          : null,
        intimacy: s.intimacy ? { ...s.intimacy, moves: userMoves } : null,
        bid_response: s.bid && userMoves[0] ? { response: s.bid, move: userMoves[0] } : null,
      };
    },
  };
}

/** The piece of `m` whose own line holds `words`. */
function pieceHolding(input: string, m: NewMessage, words: string): string | undefined {
  return m.pieces.find((id) =>
    input
      .split("\n")
      .find((l) => l.startsWith(`[${id}] `))
      ?.toLowerCase()
      .includes(words.toLowerCase()),
  );
}

function hash(text: string): string {
  let h = 5381;
  for (const c of text) h = (h * 33) ^ c.charCodeAt(0);
  return (h >>> 0).toString(36).slice(0, 5);
}
