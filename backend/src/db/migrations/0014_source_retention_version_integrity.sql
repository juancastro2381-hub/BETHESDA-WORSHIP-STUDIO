-- Migration 0014: Source Retention & Version Integrity (Re-assert ON DELETE SET NULL for version_id)
-- Bethesda Worship Studio - Phase 1B-R3

-- Explicitly re-assert foreign key version_id to use ON DELETE SET NULL
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_version_id_song_versions_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_version_id_song_versions_id_fk"
  FOREIGN KEY ("version_id") REFERENCES "song_versions"("id") ON DELETE SET NULL;

