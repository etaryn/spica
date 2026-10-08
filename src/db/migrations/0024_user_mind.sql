CREATE TYPE "public"."user_mind_run_status" AS ENUM('pending', 'running', 'done', 'failed', 'capped');--> statement-breakpoint
ALTER TYPE "public"."fact_kind" ADD VALUE 'summary';--> statement-breakpoint
CREATE TABLE "user_loop_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"loop" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost" real,
	"calls" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mind_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"triggers" jsonb NOT NULL,
	"status" "user_mind_run_status" NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_loop_trace" ADD CONSTRAINT "user_loop_trace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_loop_trace" ADD CONSTRAINT "user_loop_trace_run_id_user_mind_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."user_mind_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mind_run" ADD CONSTRAINT "user_mind_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_loop_trace_user_created_idx" ON "user_loop_trace" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_mind_run_source_idx" ON "user_mind_run" USING btree ("user_id","source_ref");--> statement-breakpoint
CREATE INDEX "user_mind_run_status_idx" ON "user_mind_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "user_mind_run_user_date_idx" ON "user_mind_run" USING btree ("user_id","local_date");