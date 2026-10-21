ALTER TABLE "fact" ADD COLUMN "stale_after" timestamp with time zone;--> statement-breakpoint
-- Open ideas written before expiry existed get the few days' chance they had: 3 days.
UPDATE "fact" SET "stale_after" = "created_at" + interval '3 days' WHERE "kind" = 'idea' AND "status" = 'open';