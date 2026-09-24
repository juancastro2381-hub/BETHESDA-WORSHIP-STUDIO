CREATE TYPE "public"."setlist_item_type" AS ENUM('SONG', 'SERVICE_MOMENT');--> statement-breakpoint
CREATE TYPE "public"."setlist_status" AS ENUM('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."transition_type" AS ENUM('SEGUE', 'CROSSFADE', 'STOP', 'MEDLEY');--> statement-breakpoint
CREATE TABLE "setlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setlist_id" uuid NOT NULL,
	"sequence_order" integer NOT NULL,
	"item_type" "setlist_item_type" NOT NULL,
	"song_id" uuid,
	"target_key" varchar(16),
	"target_bpm" integer,
	"transition_type" "transition_type" DEFAULT 'STOP',
	"moment_title" varchar(255),
	"duration_minutes" integer,
	"musical_key" varchar(16),
	"notes_for_team" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"scheduled_date_time" timestamp with time zone,
	"status" "setlist_status" DEFAULT 'PLANNING' NOT NULL,
	"director_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setlist_items" ADD CONSTRAINT "setlist_items_setlist_id_setlists_id_fk" FOREIGN KEY ("setlist_id") REFERENCES "public"."setlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlist_items" ADD CONSTRAINT "setlist_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlists" ADD CONSTRAINT "setlists_director_user_id_users_id_fk" FOREIGN KEY ("director_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_setlist_items_setlist_id" ON "setlist_items" USING btree ("setlist_id");--> statement-breakpoint
CREATE INDEX "idx_setlist_items_sequence" ON "setlist_items" USING btree ("setlist_id","sequence_order");--> statement-breakpoint
CREATE INDEX "idx_setlist_items_song_id" ON "setlist_items" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "idx_setlists_status" ON "setlists" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_setlists_scheduled" ON "setlists" USING btree ("scheduled_date_time");--> statement-breakpoint
CREATE INDEX "idx_setlists_director" ON "setlists" USING btree ("director_user_id");