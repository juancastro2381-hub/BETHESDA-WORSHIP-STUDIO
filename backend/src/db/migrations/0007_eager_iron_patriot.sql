CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('OMR_PROCESSING', 'IMPORT_COMMIT', 'AUDIO_TRANSCRIPTION', 'STEM_SEPARATION');--> statement-breakpoint
CREATE TYPE "public"."omr_action_type" AS ENUM('CREATE_PROPOSAL', 'UPDATE_MEASURE', 'APPROVE_MEASURE', 'FLAG_MEASURE', 'APPROVE_PROPOSAL', 'REJECT_PROPOSAL', 'COMMIT_TO_SONG');--> statement-breakpoint
CREATE TYPE "public"."omr_proposal_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED_FOR_IMPORT', 'REJECTED', 'COMMITTED');--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"user_id" uuid,
	"tenant_id" varchar(64) DEFAULT 'bethesda-default' NOT NULL,
	"input_ref" varchar(512) NOT NULL,
	"output_ref" varchar(512),
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"correlation_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "omr_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"user_id" uuid,
	"source_filename" varchar(255) NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"detected_title" varchar(255),
	"detected_artist" varchar(255),
	"detected_key" varchar(16),
	"detected_bpm" integer,
	"detected_time_signature" varchar(16),
	"overall_confidence" real DEFAULT 0 NOT NULL,
	"is_ai_draft" boolean DEFAULT true NOT NULL,
	"review_status" "omr_proposal_status" DEFAULT 'DRAFT' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "omr_proposal_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"measure_number" integer NOT NULL,
	"time_signature" varchar(16) DEFAULT '4/4' NOT NULL,
	"key_signature" varchar(16),
	"chords_detected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes_detected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lyrics_detected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"measure_confidence" real DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "omr_audit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"user_id" uuid,
	"action_type" "omr_action_type" NOT NULL,
	"target_measure" integer,
	"target_tick" integer,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_proposals" ADD CONSTRAINT "omr_proposals_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_proposals" ADD CONSTRAINT "omr_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_proposals" ADD CONSTRAINT "omr_proposals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_proposal_measures" ADD CONSTRAINT "omr_proposal_measures_proposal_id_omr_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."omr_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_audit_history" ADD CONSTRAINT "omr_audit_history_proposal_id_omr_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."omr_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_audit_history" ADD CONSTRAINT "omr_audit_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_background_jobs_job_type" ON "background_jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "idx_background_jobs_status" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_background_jobs_user_id" ON "background_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_background_jobs_correlation_id" ON "background_jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_background_jobs_created_at" ON "background_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_omr_proposals_job_id" ON "omr_proposals" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_omr_proposals_user_id" ON "omr_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_omr_proposals_source_hash" ON "omr_proposals" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX "idx_omr_proposals_review_status" ON "omr_proposals" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_omr_proposals_created_at" ON "omr_proposals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_omr_proposal_measures_proposal_id" ON "omr_proposal_measures" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_omr_proposal_measures_prop_num" ON "omr_proposal_measures" USING btree ("proposal_id","measure_number");--> statement-breakpoint
CREATE INDEX "idx_omr_audit_history_proposal_id" ON "omr_audit_history" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "idx_omr_audit_history_user_id" ON "omr_audit_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_omr_audit_history_created_at" ON "omr_audit_history" USING btree ("created_at");
