ALTER TYPE "public"."session_trigger" ADD VALUE 'backchannel';--> statement-breakpoint
ALTER TYPE "public"."session_trigger" ADD VALUE 'availability';--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"buffer_turn_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wait_until" timestamp with time zone,
	"last_backchannel_at" timestamp with time zone,
	"buffer_version" integer DEFAULT 0 NOT NULL,
	"buffer_started_at" timestamp with time zone,
	"backchannel_sent" boolean DEFAULT false NOT NULL,
	"inflight_turn_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"inflight_since" timestamp with time zone,
	"reply_epoch" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_state_wait_idx" ON "conversation_state" USING btree ("wait_until");