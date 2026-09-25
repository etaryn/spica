CREATE TYPE "public"."guard_outcome" AS ENUM('passed', 'regenerated', 'sent_with_violation', 'fallback', 'guard_unavailable');--> statement-breakpoint
CREATE TYPE "public"."judge_kind" AS ENUM('guard', 'turn');--> statement-breakpoint
CREATE TABLE "judge_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "judge_kind" NOT NULL,
	"turn_id" uuid,
	"attempt" integer NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"outcome" "guard_outcome",
	"source" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "judge_log" ADD CONSTRAINT "judge_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_log" ADD CONSTRAINT "judge_log_turn_id_session_log_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judge_log_user_created_idx" ON "judge_log" USING btree ("user_id","created_at");