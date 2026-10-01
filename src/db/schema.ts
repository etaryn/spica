import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid, vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../core/config";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const emptyUuidArray = sql`'{}'::uuid[]`;
const emptyTextArray = sql`'{}'::text[]`;

// ---------- Better Auth (camelCase property names are required by Better Auth) ----------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  dateOfBirth: text("date_of_birth").notNull(), // YYYY-MM-DD, validated at signup
  timezone: text("timezone"), // IANA name from the browser; null = UTC
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

// ---------- Enums ----------

export const factSubject = pgEnum("fact_subject", ["user", "self", "shared"]);
export const entitySubject = pgEnum("entity_subject", ["user", "self"]);
export const factKind = pgEnum("fact_kind", ["event", "trait", "preference", "state", "opinion", "feeling", "promise"]);
export const factStatus = pgEnum("fact_status", ["open", "resolved", "recurring", "stale", "superseded"]);
export const factSource = pgEnum("fact_source", ["turn", "generated", "onboarding", "inferred"]);
export const factScope = pgEnum("fact_scope", ["private", "group"]);
export const entityType = pgEnum("entity_type", ["person", "pet", "place", "project", "org", "other"]);
export const threadStatus = pgEnum("thread_status", ["open", "resolved", "dormant"]);
export const threadStakes = pgEnum("thread_stakes", ["low", "med", "high"]);
// Declaration order matters: `user` sorts before `companion` (transcript tie-break).
export const sessionRole = pgEnum("session_role", ["user", "companion"]);
export const sessionTrigger = pgEnum("session_trigger", ["reach_out", "backchannel", "availability"]);
export const judgeKind = pgEnum("judge_kind", ["guard", "turn"]);
export const guardOutcome = pgEnum("guard_outcome", ["passed", "regenerated", "sent_with_violation", "fallback", "guard_unavailable", "guard_disabled"]);
export const relationshipStatus = pgEnum("relationship_status", ["active", "ended_by_user", "repairing"]);
export const reachOutStatus = pgEnum("reach_out_status", ["none", "blocked", "scheduled", "sent", "dropped"]);
export const makeUpState = pgEnum("make_up_state", ["none", "due", "offered"]);
export const relationshipCause = pgEnum("relationship_cause", ["signal", "frequency", "absence", "fade", "make_up", "apology", "ending", "repair", "crisis", "scar", "baseline"]);

const userRef = () => uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" });

// ---------- Domain tables ----------

export const thread = pgTable("thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  title: text("title").notNull(),
  subject: factSubject("subject").notNull(),
  status: threadStatus("status").notNull(),
  entity_refs: uuid("entity_refs").array().notNull().default(emptyUuidArray),
  opened_at: ts("opened_at").notNull(),
  last_touched: ts("last_touched").notNull(),
  next_checkpoint: ts("next_checkpoint"),
  stakes: threadStakes("stakes").notNull(),
}, (t) => [
  index("thread_user_status_checkpoint_idx").on(t.user_id, t.status, t.next_checkpoint),
]);

export const entity = pgTable("entity", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default(emptyTextArray),
  type: entityType("type").notNull(),
  subject: entitySubject("subject").notNull(),
  relation: text("relation"),
  salience: real("salience").notNull(),
  first_seen: ts("first_seen").notNull(),
  last_mentioned: ts("last_mentioned").notNull(),
}, (t) => [
  index("entity_user_subject_idx").on(t.user_id, t.subject),
  index("entity_aliases_gin").using("gin", t.aliases),
  check("entity_salience_range", sql`${t.salience} BETWEEN 0 AND 1`),
]);

export const fact = pgTable("fact", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  subject: factSubject("subject").notNull(),
  kind: factKind("kind").notNull(),
  content: text("content").notNull(),
  payload: jsonb("payload"),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  entity_refs: uuid("entity_refs").array().notNull().default(emptyUuidArray),
  thread_id: uuid("thread_id").references(() => thread.id, { onDelete: "set null" }),
  occurred_at: ts("occurred_at"),
  created_at: ts("created_at").notNull(),
  last_recalled_at: ts("last_recalled_at"),
  status: factStatus("status").notNull(),
  superseded_by: uuid("superseded_by").references((): AnyPgColumn => fact.id, { onDelete: "set null" }),
  salience: real("salience").notNull(),
  valence: real("valence").notNull(),
  confidence: real("confidence").notNull(),
  source: factSource("source").notNull(),
  source_ref: text("source_ref"),
  recall_count: integer("recall_count").notNull().default(0),
  scope: factScope("scope").notNull().default("private"), // post-MVP group hook; MVP reads only 'private'
  space_id: uuid("space_id"),                               // post-MVP group hook; never read in MVP
}, (t) => [
  index("fact_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("fact_entity_refs_gin").using("gin", t.entity_refs),
  index("fact_user_status_idx").on(t.user_id, t.status),
  index("fact_user_active_idx").on(t.user_id).where(sql`${t.status} NOT IN ('superseded', 'stale')`),
  check("fact_salience_range", sql`${t.salience} BETWEEN 0 AND 1`),
  check("fact_valence_range", sql`${t.valence} BETWEEN -1 AND 1`),
  check("fact_confidence_range", sql`${t.confidence} BETWEEN 0 AND 1`),
]);

export const identity = pgTable("identity", {
  user_id: userRef().primaryKey(),
  // values (rarely changes)
  traits: jsonb("traits"),
  stances: jsonb("stances"),
  boundaries: text("boundaries").array(),
  humor_style: text("humor_style"),
  verbal_tics: text("verbal_tics").array(),
  speech_rules: text("speech_rules").array(),
  // ego (changes hourly)
  mood_valence: real("mood_valence").notNull(),
  mood_arousal: real("mood_arousal").notNull(),
  energy: real("energy").notNull(),
  preoccupation: uuid("preoccupation").references(() => fact.id, { onDelete: "set null" }),
  baseline: jsonb("baseline").notNull(),
  last_tick: ts("last_tick"),
  preoccupation_since: ts("preoccupation_since"),
  life_last_date: date("life_last_date", { mode: "string" }),
}, (t) => [
  check("identity_mood_valence_range", sql`${t.mood_valence} BETWEEN -1 AND 1`),
  check("identity_mood_arousal_range", sql`${t.mood_arousal} BETWEEN 0 AND 1`),
  check("identity_energy_range", sql`${t.energy} BETWEEN 0 AND 1`),
]);

/** One row per user. Params live in relationship_param. */
export const relationship = pgTable("relationship", {
  user_id: userRef().primaryKey(),
  status: relationshipStatus("status").notNull().default("active"),
  cadence: jsonb("cadence").notNull(),
  last_contact: ts("last_contact"),
  unanswered_reach_outs: integer("unanswered_reach_outs").notNull().default(0),
  end_pending_since: ts("end_pending_since"),
  ended_at: ts("ended_at"),
  repair_started_at: ts("repair_started_at"),
  make_up_state: makeUpState("make_up_state").notNull().default("none"),
  make_up_replies: integer("make_up_replies").notNull().default(0),
  hurt_cause_fact: uuid("hurt_cause_fact").references(() => fact.id, { onDelete: "set null" }),
  crisis_quiet_until: ts("crisis_quiet_until"),
  last_tick: date("last_tick", { mode: "string" }),
  last_hurt_at: ts("last_hurt_at"),
});

export type SafetyFlag = {
  flagged: boolean;
  category: "self_harm" | "harm_to_others" | "none";
  source: "classifier" | "keyword_fallback";
};

export const session_log = pgTable("session_log", {
  id: uuid("id").primaryKey(),
  user_id: userRef(),
  session_id: uuid("session_id").notNull(),
  role: sessionRole("role").notNull(),
  text: text("text").notNull(),
  created_at: ts("created_at").notNull(),
  trigger: sessionTrigger("trigger"),
  extracted: boolean("extracted").notNull().default(false),
  safety_flag: jsonb("safety_flag").$type<SafetyFlag>(),
  reply_to: uuid("reply_to").references((): AnyPgColumn => session_log.id, { onDelete: "cascade" }),
  extract_attempts: integer("extract_attempts").notNull().default(0),
}, (t) => [
  index("session_log_user_created_idx").on(t.user_id, t.created_at),
  index("session_log_user_session_idx").on(t.user_id, t.session_id),
  index("session_log_unextracted_idx").on(t.user_id).where(sql`${t.extracted} = false`),
  uniqueIndex("session_log_reply_to_uq").on(t.reply_to),
]);

/** Extensible homeostatic params: a new param needs no migration. */
export const relationship_param = pgTable("relationship_param", {
  user_id: userRef(),
  name: text("name").notNull(),
  value: real("value").notNull(),
  baseline: real("baseline").notNull(),
  variance: real("variance").notNull(),
  updated_at: ts("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.name] }),
  check("relationship_param_variance_nonneg", sql`${t.variance} >= 0`),
]);

/** Every relationship change. Diagnostic only: never read by the chat loop. */
export const relationship_event = pgTable("relationship_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  param: text("param"),
  before: real("before"),
  after: real("after"),
  cause: relationshipCause("cause").notNull(),
  deviation: real("deviation"),
  turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "set null" }),
  detail: jsonb("detail").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("relationship_event_user_created_idx").on(t.user_id, t.created_at)]);

export type OpenQuestion = { turn_id: string; text: string };

export type LifeBlockKind = "busy" | "downtime" | "quiet";
/** One block of her shared day plan; times are "HH:MM" in her zone, "24:00" = midnight. */
export type LifeBlock = { start: string; end: string; kind: LifeBlockKind; busy: number; label: string };
export type LifePlan = { blocks: LifeBlock[] };

// ---------- Turn-taking ----------

export const conversation_state = pgTable("conversation_state", {
  user_id: uuid("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  buffer_turn_ids: uuid("buffer_turn_ids").array().notNull().default(emptyUuidArray),
  open_questions: jsonb("open_questions").$type<OpenQuestion[]>().notNull().default(sql`'[]'::jsonb`),
  wait_until: ts("wait_until"),
  last_backchannel_at: ts("last_backchannel_at"),
  buffer_version: integer("buffer_version").notNull().default(0),
  buffer_started_at: ts("buffer_started_at"),
  backchannel_sent: boolean("backchannel_sent").notNull().default(false),
  inflight_turn_ids: uuid("inflight_turn_ids").array().notNull().default(emptyUuidArray),
  inflight_since: ts("inflight_since"),
  sending_since: ts("sending_since"),
  reply_epoch: integer("reply_epoch").notNull().default(0),
  deferred_until: ts("deferred_until"),
  deferred_fact: uuid("deferred_fact").references(() => fact.id, { onDelete: "set null" }),
  updated_at: ts("updated_at").notNull(),
}, (t) => [index("conversation_state_wait_idx").on(t.wait_until)]);

// ---------- Inspector trace tables — diagnostic only, never read by the chat loop ----------

export const retrieval_trace = pgTable("retrieval_trace", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  turn_id: uuid("turn_id").notNull().references(() => session_log.id, { onDelete: "cascade" }),
  fact_id: uuid("fact_id").notNull().references(() => fact.id, { onDelete: "cascade" }),
  sim: real("sim").notNull(),
  fact_salience: real("fact_salience").notNull(),
  entity_salience: real("entity_salience").notNull(),
  recency: real("recency").notNull(),
  score: real("score").notNull(),
  forced: boolean("forced").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("retrieval_trace_user_turn_idx").on(t.user_id, t.turn_id)]);

export const ego_tick = pgTable("ego_tick", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  mood_valence: real("mood_valence").notNull(),
  mood_arousal: real("mood_arousal").notNull(),
  energy: real("energy").notNull(),
  preoccupation: uuid("preoccupation").references(() => fact.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("ego_tick_user_created_idx").on(t.user_id, t.created_at)]);

/** Her shared day plan: canon for that day, like the persona file. No user data, so no user_id. */
export const life_day = pgTable("life_day", {
  date: date("date", { mode: "string" }).primaryKey(),
  plan: jsonb("plan").$type<LifePlan>().notNull(),
  source: text("source").notNull(), // model | fallback | scripted
  model: text("model").notNull(),
  prompt_version: text("prompt_version").notNull(),
  generated_at: ts("generated_at").notNull(),
});

/** Every personal-event attempt. Diagnostic only, never read by the chat loop. */
export const life_event_log = pgTable("life_event_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  life_day: date("life_day", { mode: "string" }).notNull(),
  attempt: integer("attempt").notNull(),
  candidate: jsonb("candidate").notNull(),
  decision: text("decision").notNull(),
  target_fact_id: uuid("target_fact_id").references(() => fact.id, { onDelete: "set null" }),
  fact_id: uuid("fact_id").references(() => fact.id, { onDelete: "set null" }),
  model: text("model"),
  prompt_version: text("prompt_version"),
  created_at: ts("created_at").notNull(),
}, (t) => [index("life_event_log_user_created_idx").on(t.user_id, t.created_at)]);

/** One row per outreach evaluation that got past the pre-check. `send_at` is the actual send time once `sent`. */
export const reach_out_log = pgTable("reach_out_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  candidates: jsonb("candidates").notNull(),
  winner: jsonb("winner"),
  gate_results: jsonb("gate_results").notNull(),
  sent: boolean("sent").notNull(),
  turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "set null" }),
  topic: text("topic"),
  status: reachOutStatus("status").notNull().default("none"),
  send_at: ts("send_at"),
  answered_at: ts("answered_at"),
  created_at: ts("created_at").notNull(),
}, (t) => [
  index("reach_out_log_user_created_idx").on(t.user_id, t.created_at),
  index("reach_out_log_user_sent_idx").on(t.user_id, t.send_at).where(sql`${t.status} = 'sent'`),
]);

/** Web Push subscriptions. One row per browser endpoint; the endpoint moves to whoever subscribed last. */
export const push_subscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("push_subscription_user_idx").on(t.user_id)]);

/** Every guard decision and turn-taking judge decision. Never read by the chat loop. */
export const judge_log = pgTable("judge_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  kind: judgeKind("kind").notNull(),
  turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output").notNull(),
  outcome: guardOutcome("outcome"),
  source: text("source").notNull(),
  latency_ms: integer("latency_ms").notNull(),
  model: text("model").notNull(),
  prompt_version: text("prompt_version").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("judge_log_user_created_idx").on(t.user_id, t.created_at)]);
