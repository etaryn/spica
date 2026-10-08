CREATE TYPE "public"."claim_kind" AS ENUM('life', 'opinion', 'reaction');--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "claim_kind" "claim_kind";--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "grounded" boolean;