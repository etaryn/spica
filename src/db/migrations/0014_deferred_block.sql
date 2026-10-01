ALTER TABLE "conversation_state" DROP CONSTRAINT "conversation_state_deferred_fact_fact_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_state" DROP COLUMN "deferred_fact";
--> statement-breakpoint
ALTER TABLE "conversation_state" ADD COLUMN "deferred_block" text;
