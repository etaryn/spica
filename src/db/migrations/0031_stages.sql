CREATE TYPE "public"."relationship_apart_stage" AS ENUM('differentiating', 'circumscribing', 'stagnating', 'avoiding');--> statement-breakpoint
CREATE TYPE "public"."relationship_peak_stage" AS ENUM('initiating', 'experimenting', 'intensifying', 'integrating', 'bonding');--> statement-breakpoint
ALTER TYPE "public"."relationship_cause" ADD VALUE 'stage';--> statement-breakpoint
ALTER TYPE "public"."relationship_cause" ADD VALUE 'commitment';--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "peak_stage" "relationship_peak_stage" DEFAULT 'initiating' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "apart_stage" "relationship_apart_stage";--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "milestones" text[];--> statement-breakpoint
-- Existing relationships get the new param; its time is the closeness param's, not the server's.
INSERT INTO "relationship_param" ("user_id", "name", "value", "baseline", "variance", "updated_at")
SELECT "user_id", 'commitment', 0, 0, 0.01, "updated_at"
FROM "relationship_param" WHERE "name" = 'closeness'
ON CONFLICT DO NOTHING;
