CREATE TYPE "public"."core_memory_kind" AS ENUM('episode', 'opinion', 'interest', 'goal', 'intention', 'thought', 'reflection', 'idea', 'hypothetical', 'insight', 'narrative', 'agent_note');--> statement-breakpoint
CREATE TYPE "public"."core_memory_source" AS ENUM('world', 'loop');--> statement-breakpoint
CREATE TYPE "public"."event_stakes" AS ENUM('low', 'high');--> statement-breakpoint
CREATE TYPE "public"."world_event_kind" AS ENUM('planned', 'surprise', 'resolution');--> statement-breakpoint
CREATE TABLE "core_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"salience" real NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	CONSTRAINT "core_entity_name_unique" UNIQUE("name"),
	CONSTRAINT "core_entity_salience_range" CHECK ("core_entity"."salience" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "core_loop_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost" real,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "core_memory_kind" NOT NULL,
	"content" text NOT NULL,
	"payload" jsonb,
	"embedding" vector(1024) NOT NULL,
	"entity_refs" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"last_recalled_at" timestamp with time zone,
	"recall_count" integer DEFAULT 0 NOT NULL,
	"status" "fact_status" NOT NULL,
	"superseded_by" uuid,
	"salience" real NOT NULL,
	"valence" real NOT NULL,
	"confidence" real NOT NULL,
	"source" "core_memory_source" NOT NULL,
	"source_ref" text,
	CONSTRAINT "core_memory_salience_range" CHECK ("core_memory"."salience" BETWEEN 0 AND 1),
	CONSTRAINT "core_memory_valence_range" CHECK ("core_memory"."valence" BETWEEN -1 AND 1),
	CONSTRAINT "core_memory_confidence_range" CHECK ("core_memory"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "core_snapshot" (
	"version" integer PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"sections" jsonb NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rendered_at" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"emotion" jsonb NOT NULL,
	"mood_valence" real NOT NULL,
	"mood_arousal" real NOT NULL,
	"energy" real NOT NULL,
	"needs" jsonb NOT NULL,
	"preoccupation" uuid,
	"preoccupation_since" timestamp with time zone,
	"baseline" jsonb NOT NULL,
	"last_tick" timestamp with time zone,
	"last_event_day" date,
	CONSTRAINT "core_state_single_row" CHECK ("core_state"."id" = 1),
	CONSTRAINT "core_state_mood_valence_range" CHECK ("core_state"."mood_valence" BETWEEN -1 AND 1),
	CONSTRAINT "core_state_mood_arousal_range" CHECK ("core_state"."mood_arousal" BETWEEN 0 AND 1),
	CONSTRAINT "core_state_energy_range" CHECK ("core_state"."energy" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "world_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" "world_event_kind" NOT NULL,
	"content" text NOT NULL,
	"valence" real NOT NULL,
	"stakes" "event_stakes" NOT NULL,
	"agents" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"life_day" date NOT NULL,
	"plan_ref" text,
	"goal_ref" uuid,
	"outcome" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "world_event_valence_range" CHECK ("world_event"."valence" BETWEEN -1 AND 1)
);
--> statement-breakpoint
ALTER TABLE "session_log" ADD COLUMN "snapshot_version" integer;--> statement-breakpoint
ALTER TABLE "core_memory" ADD CONSTRAINT "core_memory_superseded_by_core_memory_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."core_memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_state" ADD CONSTRAINT "core_state_preoccupation_core_memory_id_fk" FOREIGN KEY ("preoccupation") REFERENCES "public"."core_memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_loop_trace_loop_created_idx" ON "core_loop_trace" USING btree ("loop","created_at");--> statement-breakpoint
CREATE INDEX "core_memory_embedding_hnsw" ON "core_memory" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "core_memory_kind_created_idx" ON "core_memory" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "world_event_life_day_idx" ON "world_event" USING btree ("life_day");