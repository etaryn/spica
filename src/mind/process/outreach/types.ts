/**
 * The shapes of outreach: the candidate reasons she might write first (a thread, making up, the
 * user's event, her own day, a thought of her own, an idea she had about them, a check-in), what
 * the candidates are built from, and the send gate.
 */

/** Also the tie-break order between equal scores. */
export const KIND_ORDER = [
  "thread",
  "make_up",
  "user_event",
  "her_day",
  "core_thought",
  "user_idea",
  "check_in",
] as const;
export type CandidateKind = (typeof KIND_ORDER)[number];

export type FilterReason =
  "topic_used" | "sensitive" | "too_deep" | "below_threshold" | "last_slot";

/** Something she knows behind a topic and when it happens (ISO); `dated` when the date is real. */
export type Note = { text: string; at: string; dated: boolean };

export type Candidate = {
  kind: CandidateKind;
  /** Identifies the topic, so each topic is used at most once. */
  topic: string;
  text: string;
  strength: number;
  score: number;
  factId: string | null;
  /** Her own memory behind a her_day candidate; core memory, so never a fact. */
  coreMemoryId: string | null;
  threadId: string | null;
  /** Her memory's depth (1–3) for a her_day or core_thought; absent otherwise. */
  depth?: number | null;
  /** What she knows behind the topic, each with when; rendered in her words at compose time. */
  notes: Note[];
  /** Why it can't win; null when it can. */
  filtered: FilterReason | null;
};

export type CandidateInputs = {
  dueThreads: {
    id: string;
    title: string;
    detail: string | null;
    stakes: "low" | "med" | "high";
    next_checkpoint: Date;
    fact_id: string | null;
    sensitive: boolean;
    /** Live facts about them on the thread, newest first; `at` is occurred_at else created_at. */
    facts: { id: string; content: string; at: Date; dated: boolean }[];
  }[];
  makeUp: {
    due: boolean;
    hurt: number;
    causeFactId: string | null;
    causeText: string | null;
    lastHurtAt: Date | null;
  };
  userEvents: {
    id: string;
    content: string;
    salience: number;
    sensitive: boolean;
    occurred_at: Date | null;
  }[];
  /** Her news; `content`/`depth` are already the plain event's when the memory was too deep. */
  herDay: {
    id: string;
    content: string;
    salience: number;
    depth: number;
    sensitive: boolean;
    at: Date;
  }[];
  /** Her own recent thoughts and ideas (core memory, never sensitive). */
  coreThoughts: { id: string; content: string; salience: number; depth: number }[];
  /** Her live ideas about this user, from her user mind; never from sensitive memories. */
  userIdeas: { id: string; content: string; salience: number }[];
  checkIn: { lastContact: Date | null; medianGapHours: number };
  usedTopics: string[];
  /** The deepest of her own tiers she'd bring up unprompted with them: no stretch when writing first. */
  depthLimit: number;
  /** Her estimate of how many messages a day they send; null until she has one. */
  theirRate: number | null;
};

export type GateRule = "status" | "caps" | "her_day" | "unanswered" | "in_progress" | "crisis";
export type GateResult = { rule: GateRule; pass: boolean; detail?: string };

export type GateInputs = {
  status: "active" | "ended_by_user" | "repairing";
  /** Sent reach-outs, covering at least the last 7 days. */
  sentAt: Date[];
  herBlock: { block: "busy" | "offline"; label: string } | null;
  unanswered: number;
  inProgress: boolean;
  crisisQuietUntil: Date | null;
};

export type GateOutcome = { pass: boolean; results: GateResult[] };
