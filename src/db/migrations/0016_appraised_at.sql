ALTER TABLE "world_event" ADD COLUMN "appraised_at" timestamp with time zone;--> statement-breakpoint
-- Events recorded before this change were appraised when they were recorded.
UPDATE "world_event" SET "appraised_at" = "created_at";
