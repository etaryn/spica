CREATE TYPE "public"."reach_out_status" AS ENUM('none', 'blocked', 'scheduled', 'sent', 'dropped');--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD COLUMN "status" "reach_out_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reach_out_log" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reach_out_log_user_sent_idx" ON "reach_out_log" USING btree ("user_id","send_at") WHERE "reach_out_log"."status" = 'sent';