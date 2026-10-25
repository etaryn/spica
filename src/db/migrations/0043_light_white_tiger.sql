CREATE TYPE "public"."annotation_layer" AS ENUM('move', 'mention', 'time', 'proposition', 'idiolect');--> statement-breakpoint
CREATE TABLE "annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"exchange_ref" uuid NOT NULL,
	"layer" "annotation_layer" NOT NULL,
	"local_id" text NOT NULL,
	"coords" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"fact_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_exchange_ref_session_log_id_fk" FOREIGN KEY ("exchange_ref") REFERENCES "public"."session_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_session_local_uq" ON "annotation" USING btree ("user_id","session_id","local_id");--> statement-breakpoint
CREATE INDEX "annotation_user_session_idx" ON "annotation" USING btree ("user_id","session_id");