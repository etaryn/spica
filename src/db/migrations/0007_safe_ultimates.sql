CREATE TYPE "public"."make_up_state" AS ENUM('none', 'due', 'offered');--> statement-breakpoint
CREATE TYPE "public"."relationship_cause" AS ENUM('signal', 'frequency', 'absence', 'fade', 'make_up', 'apology', 'ending', 'repair', 'crisis', 'scar', 'baseline');--> statement-breakpoint
CREATE TYPE "public"."relationship_status" AS ENUM('active', 'ended_by_user', 'repairing');--> statement-breakpoint
ALTER TYPE "public"."guard_outcome" ADD VALUE 'guard_disabled';--> statement-breakpoint
CREATE TABLE "relationship_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"param" text,
	"before" real,
	"after" real,
	"cause" "relationship_cause" NOT NULL,
	"deviation" real,
	"turn_id" uuid,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_param" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" real NOT NULL,
	"baseline" real NOT NULL,
	"variance" real NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "relationship_param_user_id_name_pk" PRIMARY KEY("user_id","name"),
	CONSTRAINT "relationship_param_variance_nonneg" CHECK ("relationship_param"."variance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "relationship" DROP CONSTRAINT "relationship_closeness_range";--> statement-breakpoint
ALTER TABLE "relationship" DROP CONSTRAINT "relationship_trust_range";--> statement-breakpoint
ALTER TABLE "relationship" DROP CONSTRAINT "relationship_tension_range";--> statement-breakpoint
ALTER TABLE "relationship" ALTER COLUMN "closeness" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ALTER COLUMN "trust" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ALTER COLUMN "tension" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ALTER COLUMN "streak_days" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "relationship" ALTER COLUMN "streak_days" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "status" "relationship_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "unanswered_reach_outs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "end_pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "repair_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "make_up_state" "make_up_state" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "make_up_replies" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "hurt_cause_fact" uuid;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "crisis_quiet_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "last_tick" date;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "last_hurt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship_event" ADD CONSTRAINT "relationship_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_event" ADD CONSTRAINT "relationship_event_turn_id_session_log_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_param" ADD CONSTRAINT "relationship_param_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relationship_event_user_created_idx" ON "relationship_event" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_hurt_cause_fact_fact_id_fk" FOREIGN KEY ("hurt_cause_fact") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;