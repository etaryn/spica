ALTER TABLE "world_event" ADD COLUMN "fallthrough" boolean;--> statement-breakpoint
ALTER TABLE "world_event" ADD COLUMN "resolves_memory_id" uuid;--> statement-breakpoint
ALTER TABLE "world_event" ADD CONSTRAINT "world_event_resolves_memory_id_core_memory_id_fk" FOREIGN KEY ("resolves_memory_id") REFERENCES "public"."core_memory"("id") ON DELETE set null ON UPDATE no action;