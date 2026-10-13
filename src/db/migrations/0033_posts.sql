CREATE TYPE "public"."post_check" AS ENUM('ok', 'flagged', 'unchecked');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."world_event_kind" ADD VALUE 'action';--> statement-breakpoint
CREATE TABLE "post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"find_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"format" text NOT NULL,
	"pose" text NOT NULL,
	"caption" text NOT NULL,
	"overlay_text" text,
	"media_path" text NOT NULL,
	"skill" real NOT NULL,
	"check" "post_check" NOT NULL,
	"check_reason" text,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"decided_at" timestamp with time zone,
	"action_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_find_id_unique" UNIQUE("find_id"),
	CONSTRAINT "post_skill_range" CHECK ("post"."skill" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "web_find" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"credit" text NOT NULL,
	"licence" text NOT NULL,
	"media_path" text NOT NULL,
	"world_event_id" uuid NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	CONSTRAINT "web_find_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_find_id_web_find_id_fk" FOREIGN KEY ("find_id") REFERENCES "public"."web_find"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_action_event_id_world_event_id_fk" FOREIGN KEY ("action_event_id") REFERENCES "public"."world_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_find" ADD CONSTRAINT "web_find_world_event_id_world_event_id_fk" FOREIGN KEY ("world_event_id") REFERENCES "public"."world_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_status_created_idx" ON "post" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "web_find_found_idx" ON "web_find" USING btree ("found_at");