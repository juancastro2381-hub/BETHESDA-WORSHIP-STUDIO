ALTER TABLE "omr_audit_history" DROP CONSTRAINT IF EXISTS "omr_audit_history_proposal_id_omr_proposals_id_fk";--> statement-breakpoint
ALTER TABLE "omr_audit_history" ADD CONSTRAINT "omr_audit_history_proposal_id_omr_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."omr_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omr_proposal_measures" ALTER COLUMN "time_signature" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "omr_proposal_measures" ALTER COLUMN "time_signature" DROP NOT NULL;

