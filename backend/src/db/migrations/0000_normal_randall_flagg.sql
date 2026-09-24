CREATE TABLE "song_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"copyright" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"version_id" uuid,
	"source_type" varchar(32) NOT NULL,
	"filename" varchar(255),
	"raw_content" text,
	"importer_name" varchar(64) NOT NULL,
	"importer_version" varchar(32) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" varchar(255) DEFAULT 'Principal' NOT NULL,
	"description" text,
	"source_format" varchar(32) NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"total_measures" integer DEFAULT 0 NOT NULL,
	"total_notes" integer DEFAULT 0 NOT NULL,
	"total_chords" integer DEFAULT 0 NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"artist" varchar(255),
	"ccli_number" varchar(64),
	"default_key" varchar(16) NOT NULL,
	"default_bpm" integer DEFAULT 120 NOT NULL,
	"time_signature" varchar(16) DEFAULT '4/4' NOT NULL,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "song_metadata" ADD CONSTRAINT "song_metadata_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_version_id_song_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."song_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_versions" ADD CONSTRAINT "song_versions_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_song_metadata_song_id" ON "song_metadata" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "idx_song_sources_song_id" ON "song_sources" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "idx_song_sources_version_id" ON "song_sources" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_song_versions_song_id" ON "song_versions" USING btree ("song_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_song_versions_song_version" ON "song_versions" USING btree ("song_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_songs_title" ON "songs" USING btree ("title");--> statement-breakpoint
CREATE INDEX "idx_songs_artist" ON "songs" USING btree ("artist");--> statement-breakpoint
CREATE INDEX "idx_songs_status" ON "songs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_songs_default_key" ON "songs" USING btree ("default_key");