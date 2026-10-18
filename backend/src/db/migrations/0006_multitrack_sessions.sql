CREATE TABLE IF NOT EXISTS "multitrack_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"bpm" integer DEFAULT 120 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "multitrack_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"track_type" varchar(64) NOT NULL,
	"audio_asset_id" uuid NOT NULL,
	"volume" real DEFAULT 0.8 NOT NULL,
	"pan" real DEFAULT 0 NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"is_solo" boolean DEFAULT false NOT NULL,
	"offset_ms" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "multitrack_sessions" ADD CONSTRAINT "multitrack_sessions_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "multitrack_sessions" ADD CONSTRAINT "multitrack_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "multitrack_tracks" ADD CONSTRAINT "multitrack_tracks_session_id_multitrack_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."multitrack_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "multitrack_tracks" ADD CONSTRAINT "multitrack_tracks_audio_asset_id_audio_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_multitrack_sessions_song_id" ON "multitrack_sessions" USING btree ("song_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_multitrack_sessions_created_by" ON "multitrack_sessions" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_multitrack_tracks_session_id" ON "multitrack_tracks" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_multitrack_tracks_audio_asset_id" ON "multitrack_tracks" USING btree ("audio_asset_id");
