CREATE TYPE "public"."disclosure_level" AS ENUM('open', 'peek');--> statement-breakpoint
CREATE TYPE "public"."disclosure_ref_kind" AS ENUM('memory', 'self_line');--> statement-breakpoint
CREATE TABLE "disclosure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ref_kind" "disclosure_ref_kind" NOT NULL,
	"ref_id" uuid NOT NULL,
	"depth" smallint NOT NULL,
	"level" "disclosure_level" NOT NULL,
	"fact_id" uuid,
	"turn_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core_memory" ADD COLUMN "depth" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "core_self_line" ADD COLUMN "depth" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_log" ADD COLUMN "depth" jsonb;--> statement-breakpoint
ALTER TABLE "disclosure" ADD CONSTRAINT "disclosure_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure" ADD CONSTRAINT "disclosure_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure" ADD CONSTRAINT "disclosure_turn_id_session_log_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disclosure_user_created_idx" ON "disclosure" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "disclosure_user_ref_idx" ON "disclosure" USING btree ("user_id","ref_id");--> statement-breakpoint
ALTER TABLE "core_memory" ADD CONSTRAINT "core_memory_depth_range" CHECK ("core_memory"."depth" BETWEEN 1 AND 3);--> statement-breakpoint
UPDATE core_memory SET depth = CASE
  WHEN kind IN ('interest', 'opinion') THEN 1
  WHEN kind IN ('reflection', 'insight', 'narrative', 'agent_note') THEN 3
  ELSE 2 END;
