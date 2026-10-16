ALTER TABLE "relationship_param" ADD COLUMN "samples" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "relationship_param" p SET "samples" = 30
FROM "relationship" r
WHERE p."user_id" = r."user_id" AND r."last_tick" IS NOT NULL;
