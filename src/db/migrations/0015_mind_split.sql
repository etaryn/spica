DELETE FROM "life_event_log";--> statement-breakpoint
ALTER TABLE "ego_tick" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identity" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ego_tick" CASCADE;--> statement-breakpoint
DROP TABLE "identity" CASCADE;--> statement-breakpoint
ALTER TABLE "life_event_log" DROP CONSTRAINT "life_event_log_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "life_event_log" DROP CONSTRAINT "life_event_log_target_fact_id_fact_id_fk";
--> statement-breakpoint
ALTER TABLE "life_event_log" DROP CONSTRAINT "life_event_log_fact_id_fact_id_fk";
--> statement-breakpoint
DROP INDEX "life_event_log_user_created_idx";--> statement-breakpoint
CREATE INDEX "life_event_log_created_idx" ON "life_event_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "life_event_log" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "life_event_log" DROP COLUMN "target_fact_id";--> statement-breakpoint
ALTER TABLE "life_event_log" DROP COLUMN "fact_id";--> statement-breakpoint
ALTER TABLE "life_event_log" ADD COLUMN "target_memory_id" uuid;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD COLUMN "world_event_id" uuid;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD CONSTRAINT "life_event_log_target_memory_id_core_memory_id_fk" FOREIGN KEY ("target_memory_id") REFERENCES "public"."core_memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_event_log" ADD CONSTRAINT "life_event_log_world_event_id_world_event_id_fk" FOREIGN KEY ("world_event_id") REFERENCES "public"."world_event"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DELETE FROM "thread" t WHERE t.subject = 'self' AND EXISTS (
  SELECT 1 FROM "fact" f WHERE f.thread_id = t.id AND f.source = 'generated');
--> statement-breakpoint
DELETE FROM "fact" WHERE subject = 'self' AND source = 'generated';
