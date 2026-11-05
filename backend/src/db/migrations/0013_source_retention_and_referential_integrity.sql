-- Migration 0013: Source Retention & Referential Integrity (Eliminate CASCADE from song_sources)
-- Bethesda Worship Studio - Phase 1B-R2

-- 1. Modificar foreign key song_id para usar ON DELETE SET NULL en vez de CASCADE
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_song_id_songs_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_song_id_songs_id_fk"
  FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL;

-- 2. Modificar foreign key user_id para usar ON DELETE SET NULL en vez de CASCADE
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_fkey";
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_users_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;

