CREATE TYPE "public"."core_goal_source" AS ENUM('seed', 'reflect');--> statement-breakpoint
CREATE TYPE "public"."core_goal_status" AS ENUM('active', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."core_loop_status" AS ENUM('done', 'fallback', 'skipped_budget', 'failed');--> statement-breakpoint
CREATE TABLE "core_goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"status" "core_goal_status" NOT NULL,
	"progress" real NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"source" "core_goal_source" NOT NULL,
	"source_ref" text,
	"started_at" timestamp with time zone NOT NULL,
	"target_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "core_goal_progress_range" CHECK ("core_goal"."progress" BETWEEN 0 AND 1)
);
--> statement-breakpoint
ALTER TABLE "core_state" ALTER COLUMN "emotion" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core_loop_trace" ADD COLUMN "calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core_loop_trace" ADD COLUMN "status" "core_loop_status" DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_loop_trace" ADD COLUMN "error" text;--> statement-breakpoint
CREATE INDEX "core_goal_status_idx" ON "core_goal" USING btree ("status");--> statement-breakpoint
ALTER TABLE "world_event" ADD CONSTRAINT "world_event_goal_ref_core_goal_id_fk" FOREIGN KEY ("goal_ref") REFERENCES "public"."core_goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "core_loop_trace" SET "calls" = CASE WHEN "model" IS NULL THEN 0 ELSE 1 END;
--> statement-breakpoint
UPDATE "core_state" SET "emotion" = NULL WHERE "emotion"->>'label' = 'neutral';
