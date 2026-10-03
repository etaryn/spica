CREATE TABLE "core_self_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer,
	"text" text NOT NULL,
	"embedding" vector(1024) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"check" text NOT NULL,
	"value" text,
	"excerpt" text,
	"verdict" text,
	"score" real,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "drift_log_check_valid" CHECK ("drift_log"."check" IN ('values', 'diff', 'trend')),
	CONSTRAINT "drift_log_verdict_valid" CHECK ("drift_log"."verdict" IN ('ok', 'contradicts', 'strains'))
);
--> statement-breakpoint
ALTER TABLE "core_snapshot" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "core_state" ADD COLUMN "last_nightly_day" date;--> statement-breakpoint
ALTER TABLE "core_self_line" ADD CONSTRAINT "core_self_line_version_core_snapshot_version_fk" FOREIGN KEY ("version") REFERENCES "public"."core_snapshot"("version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_log" ADD CONSTRAINT "drift_log_version_core_snapshot_version_fk" FOREIGN KEY ("version") REFERENCES "public"."core_snapshot"("version") ON DELETE cascade ON UPDATE no action;