CREATE TABLE "onboarding" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"quiz_version" text NOT NULL,
	"answers" jsonb NOT NULL,
	"topics" jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;