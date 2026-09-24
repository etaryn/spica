CREATE TYPE "public"."fact_scope" AS ENUM('private', 'group');--> statement-breakpoint
ALTER TYPE "public"."fact_kind" ADD VALUE 'feeling';--> statement-breakpoint
ALTER TYPE "public"."fact_kind" ADD VALUE 'promise';--> statement-breakpoint
ALTER TYPE "public"."fact_source" ADD VALUE 'inferred';--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "traits" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "stances" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "boundaries" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "humor_style" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "verbal_tics" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity" ALTER COLUMN "speech_rules" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "recall_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "scope" "fact_scope" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "session_log" ADD COLUMN "extract_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text;--> statement-breakpoint
CREATE INDEX "fact_user_active_idx" ON "fact" USING btree ("user_id") WHERE "fact"."status" NOT IN ('superseded', 'stale');