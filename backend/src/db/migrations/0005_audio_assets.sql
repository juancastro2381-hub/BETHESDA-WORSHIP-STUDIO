CREATE TABLE IF NOT EXISTS "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"storage_path" varchar(512) NOT NULL,
	"mime_type" varchar(64) NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"duration_seconds" integer,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audio_assets_song_id" ON "audio_assets" USING btree ("song_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audio_assets_uploaded_by" ON "audio_assets" USING btree ("uploaded_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audio_assets_created_at" ON "audio_assets" USING btree ("created_at");
