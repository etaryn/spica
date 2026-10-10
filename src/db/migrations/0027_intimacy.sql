ALTER TYPE "public"."relationship_cause" ADD VALUE 'deep_session';--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "hours_together" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "session" jsonb;--> statement-breakpoint
ALTER TABLE "session_log" ADD COLUMN "openness" jsonb;--> statement-breakpoint
INSERT INTO relationship_param (user_id, name, value, baseline, variance, updated_at)
SELECT r.user_id, p.name, p.value, p.value, 0.01, now()
FROM relationship r
CROSS JOIN (VALUES ('user_disclosure', 0.2::real), ('user_responsiveness', 0.5::real)) AS p(name, value)
ON CONFLICT DO NOTHING;
