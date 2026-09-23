CREATE TYPE "public"."entity_subject" AS ENUM('user', 'self');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('person', 'pet', 'place', 'project', 'org', 'other');--> statement-breakpoint
CREATE TYPE "public"."fact_kind" AS ENUM('event', 'trait', 'preference', 'state', 'opinion');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('turn', 'generated', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('open', 'resolved', 'recurring', 'stale', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."fact_subject" AS ENUM('user', 'self', 'shared');--> statement-breakpoint
CREATE TYPE "public"."session_role" AS ENUM('user', 'companion');--> statement-breakpoint
CREATE TYPE "public"."session_trigger" AS ENUM('reach_out');--> statement-breakpoint
CREATE TYPE "public"."thread_stakes" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'resolved', 'dormant');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ego_tick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mood_valence" real NOT NULL,
	"mood_arousal" real NOT NULL,
	"energy" real NOT NULL,
	"preoccupation" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"type" "entity_type" NOT NULL,
	"subject" "entity_subject" NOT NULL,
	"relation" text,
	"salience" real NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_mentioned" timestamp with time zone NOT NULL,
	CONSTRAINT "entity_salience_range" CHECK ("entity"."salience" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" "fact_subject" NOT NULL,
	"kind" "fact_kind" NOT NULL,
	"content" text NOT NULL,
	"payload" jsonb,
	"embedding" vector(1024) NOT NULL,
	"entity_refs" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"thread_id" uuid,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"last_recalled_at" timestamp with time zone,
	"status" "fact_status" NOT NULL,
	"superseded_by" uuid,
	"salience" real NOT NULL,
	"valence" real NOT NULL,
	"confidence" real NOT NULL,
	"source" "fact_source" NOT NULL,
	"source_ref" text,
	CONSTRAINT "fact_salience_range" CHECK ("fact"."salience" BETWEEN 0 AND 1),
	CONSTRAINT "fact_valence_range" CHECK ("fact"."valence" BETWEEN -1 AND 1),
	CONSTRAINT "fact_confidence_range" CHECK ("fact"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "identity" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"traits" jsonb NOT NULL,
	"stances" jsonb NOT NULL,
	"boundaries" text[] NOT NULL,
	"humor_style" text NOT NULL,
	"verbal_tics" text[] NOT NULL,
	"speech_rules" text[] NOT NULL,
	"mood_valence" real NOT NULL,
	"mood_arousal" real NOT NULL,
	"energy" real NOT NULL,
	"preoccupation" uuid,
	"baseline" jsonb NOT NULL,
	"last_tick" timestamp with time zone,
	CONSTRAINT "identity_mood_valence_range" CHECK ("identity"."mood_valence" BETWEEN -1 AND 1),
	CONSTRAINT "identity_mood_arousal_range" CHECK ("identity"."mood_arousal" BETWEEN 0 AND 1),
	CONSTRAINT "identity_energy_range" CHECK ("identity"."energy" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "reach_out_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidates" jsonb NOT NULL,
	"winner" jsonb,
	"gate_results" jsonb NOT NULL,
	"sent" boolean NOT NULL,
	"turn_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"closeness" real NOT NULL,
	"trust" real NOT NULL,
	"tension" real NOT NULL,
	"cadence" jsonb NOT NULL,
	"last_contact" timestamp with time zone,
	"streak_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "relationship_closeness_range" CHECK ("relationship"."closeness" BETWEEN 0 AND 1),
	CONSTRAINT "relationship_trust_range" CHECK ("relationship"."trust" BETWEEN 0 AND 1),
	CONSTRAINT "relationship_tension_range" CHECK ("relationship"."tension" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "retrieval_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"sim" real NOT NULL,
	"fact_salience" real NOT NULL,
	"entity_salience" real NOT NULL,
	"recency" real NOT NULL,
	"score" real NOT NULL,
	"forced" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "session_role" NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"trigger" "session_trigger",
	"extracted" boolean DEFAULT false NOT NULL,
	"safety_flag" jsonb,
	"reply_to" uuid
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" "fact_subject" NOT NULL,
	"status" "thread_status" NOT NULL,
	"entity_refs" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"last_touched" timestamp with time zone NOT NULL,
	"next_checkpoint" timestamp with time zone,
	"stakes" "thread_stakes" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"date_of_birth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ego_tick" ADD CONSTRAINT "ego_tick_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ego_tick" ADD CONSTRAINT "ego_tick_preoccupation_fact_id_fk" FOREIGN KEY ("preoccupation") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_superseded_by_fact_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity" ADD CONSTRAINT "identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity" ADD CONSTRAINT "identity_preoccupation_fact_id_fk" FOREIGN KEY ("preoccupation") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD CONSTRAINT "reach_out_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD CONSTRAINT "reach_out_log_turn_id_session_log_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_trace" ADD CONSTRAINT "retrieval_trace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_trace" ADD CONSTRAINT "retrieval_trace_turn_id_session_log_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_trace" ADD CONSTRAINT "retrieval_trace_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_log" ADD CONSTRAINT "session_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_log" ADD CONSTRAINT "session_log_reply_to_session_log_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."session_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ego_tick_user_created_idx" ON "ego_tick" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "entity_user_subject_idx" ON "entity" USING btree ("user_id","subject");--> statement-breakpoint
CREATE INDEX "entity_aliases_gin" ON "entity" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "fact_embedding_hnsw" ON "fact" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "fact_entity_refs_gin" ON "fact" USING gin ("entity_refs");--> statement-breakpoint
CREATE INDEX "fact_user_status_idx" ON "fact" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "reach_out_log_user_created_idx" ON "reach_out_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "retrieval_trace_user_turn_idx" ON "retrieval_trace" USING btree ("user_id","turn_id");--> statement-breakpoint
CREATE INDEX "session_log_user_created_idx" ON "session_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "session_log_user_session_idx" ON "session_log" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "session_log_unextracted_idx" ON "session_log" USING btree ("user_id") WHERE "session_log"."extracted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "session_log_reply_to_uq" ON "session_log" USING btree ("reply_to");--> statement-breakpoint
CREATE INDEX "thread_user_status_checkpoint_idx" ON "thread" USING btree ("user_id","status","next_checkpoint");