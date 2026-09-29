CREATE TABLE "life_day" (
	"date" date PRIMARY KEY NOT NULL,
	"plan" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"life_day" date NOT NULL,
	"attempt" integer NOT NULL,
	"candidate" jsonb NOT NULL,
	"decision" text NOT NULL,
	"target_fact_id" uuid,
	"fact_id" uuid,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_state" ADD COLUMN "deferred_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD COLUMN "deferred_fact" uuid;--> statement-breakpoint
ALTER TABLE "identity" ADD COLUMN "preoccupation_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity" ADD COLUMN "life_last_date" date;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD CONSTRAINT "life_event_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD CONSTRAINT "life_event_log_target_fact_id_fact_id_fk" FOREIGN KEY ("target_fact_id") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD CONSTRAINT "life_event_log_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "life_event_log_user_created_idx" ON "life_event_log" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_deferred_fact_fact_id_fk" FOREIGN KEY ("deferred_fact") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;