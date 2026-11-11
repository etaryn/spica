ALTER TABLE "post" DROP COLUMN "medium";--> statement-breakpoint
ALTER TABLE "post" DROP COLUMN "overlay_text";--> statement-breakpoint
ALTER TABLE "post" RENAME COLUMN "pose" TO "clips";
