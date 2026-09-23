import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, boolean, check, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid, vector,
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

// ---------- Enums (spec §3) ----------

export const factSubject = pgEnum("fact_subject", ["user", "self", "shared"]);
export const entitySubject = pgEnum("entity_subject", ["user", "self"]);
export const factKind = pgEnum("fact_kind", ["event", "trait", "preference", "state", "opinion"]);
export const factStatus = pgEnum("fact_status", ["open", "resolved", "recurring", "stale", "superseded"]);
export const factSource = pgEnum("fact_source", ["turn", "generated", "onboarding"]);
export const entityType = pgEnum("entity_type", ["person", "pet", "place", "project", "org", "other"]);
export const threadStatus = pgEnum("thread_status", ["open", "resolved", "dormant"]);
export const threadStakes = pgEnum("thread_stakes", ["low", "med", "high"]);
// Declaration order matters: `user` sorts before `companion` (transcript tie-break).
export const sessionRole = pgEnum("session_role", ["user", "companion"]);
export const sessionTrigger = pgEnum("session_trigger", ["reach_out"]);

const userRef = () => uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" });

// ---------- Spec §3 tables ----------

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
}, (t) => [
  index("fact_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("fact_entity_refs_gin").using("gin", t.entity_refs),
  index("fact_user_status_idx").on(t.user_id, t.status),
  check("fact_salience_range", sql`${t.salience} BETWEEN 0 AND 1`),
  check("fact_valence_range", sql`${t.valence} BETWEEN -1 AND 1`),
  check("fact_confidence_range", sql`${t.confidence} BETWEEN 0 AND 1`),
]);

export const identity = pgTable("identity", {
  user_id: userRef().primaryKey(),
  // values (rarely changes)
  traits: jsonb("traits").notNull(),
  stances: jsonb("stances").notNull(),
  boundaries: text("boundaries").array().notNull(),
  humor_style: text("humor_style").notNull(),
  verbal_tics: text("verbal_tics").array().notNull(),
  speech_rules: text("speech_rules").array().notNull(),
  // ego (changes hourly)
  mood_valence: real("mood_valence").notNull(),
  mood_arousal: real("mood_arousal").notNull(),
  energy: real("energy").notNull(),
  preoccupation: uuid("preoccupation").references(() => fact.id, { onDelete: "set null" }),
  baseline: jsonb("baseline").notNull(),
  last_tick: ts("last_tick"),
}, (t) => [
  check("identity_mood_valence_range", sql`${t.mood_valence} BETWEEN -1 AND 1`),
  check("identity_mood_arousal_range", sql`${t.mood_arousal} BETWEEN 0 AND 1`),
  check("identity_energy_range", sql`${t.energy} BETWEEN 0 AND 1`),
]);

export const relationship = pgTable("relationship", {
  user_id: userRef().primaryKey(),
  closeness: real("closeness").notNull(),
  trust: real("trust").notNull(),
  tension: real("tension").notNull(),
  cadence: jsonb("cadence").notNull(),
  last_contact: ts("last_contact"),
  streak_days: integer("streak_days").notNull().default(0),
}, (t) => [
  check("relationship_closeness_range", sql`${t.closeness} BETWEEN 0 AND 1`),
  check("relationship_trust_range", sql`${t.trust} BETWEEN 0 AND 1`),
  check("relationship_tension_range", sql`${t.tension} BETWEEN 0 AND 1`),
]);

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
}, (t) => [
  index("session_log_user_created_idx").on(t.user_id, t.created_at),
  index("session_log_user_session_idx").on(t.user_id, t.session_id),
  index("session_log_unextracted_idx").on(t.user_id).where(sql`${t.extracted} = false`),
  uniqueIndex("session_log_reply_to_uq").on(t.reply_to),
]);

// ---------- Inspector trace tables (design §4.3.2) — diagnostic only, never read by the chat loop ----------

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

export const reach_out_log = pgTable("reach_out_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  candidates: jsonb("candidates").notNull(),
  winner: jsonb("winner"),
  gate_results: jsonb("gate_results").notNull(),
  sent: boolean("sent").notNull(),
  turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "set null" }),
  created_at: ts("created_at").notNull(),
}, (t) => [index("reach_out_log_user_created_idx").on(t.user_id, t.created_at)]);
