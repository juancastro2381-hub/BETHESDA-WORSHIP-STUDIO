CREATE TABLE IF NOT EXISTS "user_view_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" varchar(64) NOT NULL,
	"primary_representation" varchar(64) NOT NULL,
	"secondary_representations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chord_notation_system" varchar(32) DEFAULT 'STANDARD' NOT NULL,
	"transposition_semitones" integer DEFAULT 0 NOT NULL,
	"capo_fret" integer DEFAULT 0 NOT NULL,
	"clef_override" varchar(32),
	"prefer_flats" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_view_preferences" ADD CONSTRAINT "user_view_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_view_preferences_user_id" ON "user_view_preferences" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_view_preferences_instrument_id" ON "user_view_preferences" USING btree ("instrument_id");
