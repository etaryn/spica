export const KIND_ORDER = ["thread", "make_up", "user_event", "her_day", "check_in"] as const;
export type CandidateKind = (typeof KIND_ORDER)[number];
export type FilterReason = "topic_used" | "sensitive" | "below_threshold";
export type Candidate = {
  kind: CandidateKind; topic: string; text: string; strength: number; score: number;
  factId: string | null; threadId: string | null; filtered: FilterReason | null;
};
export type CandidateInputs = {
  dueThreads: { id: string; title: string; detail: string | null; stakes: "low" | "med" | "high"; next_checkpoint: Date; fact_id: string | null; sensitive: boolean }[];
  makeUp: { due: boolean; hurt: number; causeFactId: string | null; causeText: string | null; lastHurtAt: Date | null };
  userEvents: { id: string; content: string; salience: number; sensitive: boolean }[];
  herDay: { id: string; content: string; salience: number; sensitive: boolean }[];
  checkIn: { lastContact: Date | null; medianGapHours: number };
  usedTopics: string[];
};

export const GATE_RULES = ["status", "caps", "her_day", "unanswered", "in_progress", "crisis"] as const;
export type GateRule = (typeof GATE_RULES)[number];
export type GateResult = { rule: GateRule; pass: boolean; detail?: string };
export type GateInputs = {
  status: "active" | "ended_by_user" | "repairing";
  sentAt: Date[];                                   // sent reach-outs, at least the last 7 days
  herBlock: { block: "busy" | "quiet"; label: string } | null;
  unanswered: number;
  inProgress: boolean;
  crisisQuietUntil: Date | null;
};
export type GateOutcome = { pass: boolean; results: GateResult[] };
