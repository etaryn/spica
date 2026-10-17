ALTER TABLE "web_find" ADD COLUMN "image_sha256" text;--> statement-breakpoint
-- Existing finds' media is on disk only: a unique placeholder keeps them, and new finds hash.
UPDATE "web_find" SET "image_sha256" = md5("id"::text) WHERE "image_sha256" IS NULL;--> statement-breakpoint
ALTER TABLE "web_find" ALTER COLUMN "image_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "web_find" ADD CONSTRAINT "web_find_image_sha256_unique" UNIQUE("image_sha256");
