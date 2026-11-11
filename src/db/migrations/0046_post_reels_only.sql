ALTER TABLE "post" DROP COLUMN "medium";--> statement-breakpoint
ALTER TABLE "post" DROP COLUMN "overlay_text";--> statement-breakpoint
ALTER TABLE "post" RENAME COLUMN "pose" TO "clips";--> statement-breakpoint
-- Getting better is a direction (posts.skill), no longer her posts' goal.
UPDATE "core_goal" SET "status" = 'dropped', "updated_at" = now() WHERE "title" = 'Get better at making posts' AND "status" = 'active';
