/**
 * @file types.ts
 * @description Definiciones de tipos y DTOs de dominio para la persistencia backend (Fase 2A).
 */

import type { CanonicalMusicPayloadJSON } from '../../../frontend/src/core/canonical-model/index.ts';

export type SongReviewStatus = 'DRAFT' | 'APPROVED' | 'ARCHIVED';

export type SongSourceFormat =
  | 'MUSIC_XML'
  | 'CHORD_PRO'
  | 'INTERNAL'
  | 'PDF'
  | 'IMAGE'
  | 'MIDI'
  | 'AUDIO'
  | 'VIDEO_URL'
  | 'TABLATURE';

export interface SongEntity {
  id: string;
  title: string;
  artist: string | null;
  ccliNumber: string | null;
  defaultKey: string | null;
  defaultBpm: number | null;
  timeSignature: string | null;
  status: SongReviewStatus;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SongVersionEntity {
  id: string;
  songId: string;
  versionNumber: number;
  name: string;
  description: string | null;
  sourceFormat: SongSourceFormat;
  canonicalPayload: CanonicalMusicPayloadJSON;
  totalMeasures: number;
  totalNotes: number;
  totalChords: number;
  isCurrent: boolean;
  createdAt: Date;
}

export interface SongSourceEntity {
  id: string;
  songId: string | null;
  versionId: string | null;
  userId: string | null;
  sourceType: SongSourceFormat;
  filename: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksumSha256: string | null;
  jobId: string | null;
  rawContent: string | null;
  importerName: string;
  importerVersion: string;
  importedAt: Date;
}

export interface SongMetadataEntity {
  id: string;
  songId: string;
  tags: string[];
  themes: string[];
  copyright: string | null;
  notes: string | null;
  updatedAt: Date;
}

export interface CreateSongDTO {
  title: string;
  artist?: string | null | undefined;
  ccliNumber?: string | null | undefined;
  defaultKey?: string | null | undefined;
  defaultBpm?: number | null | undefined;
  timeSignature?: string | null | undefined;
  status?: SongReviewStatus | undefined;
  versionName?: string | undefined;
  versionDescription?: string | undefined;
  sourceFormat: SongSourceFormat;
  canonicalPayload: CanonicalMusicPayloadJSON;
  sourceRecord?: {
    userId?: string | undefined;
    sourceType?: SongSourceFormat | undefined;
    filename?: string | undefined;
    storagePath?: string | undefined;
    mimeType?: string | undefined;
    fileSizeBytes?: number | undefined;
    checksumSha256?: string | undefined;
    jobId?: string | undefined;
    rawContent?: string | undefined;
    importerName: string;
    importerVersion: string;
  } | undefined;
  metadata?: {
    tags?: string[] | undefined;
    themes?: string[] | undefined;
    copyright?: string | undefined;
    notes?: string | undefined;
  } | undefined;
}

export interface CreateVersionDTO {
  songId: string;
  name?: string | undefined;
  description?: string | undefined;
  sourceFormat: SongSourceFormat;
  canonicalPayload: CanonicalMusicPayloadJSON;
  setAsCurrent?: boolean | undefined;
  sourceRecord?: {
    filename?: string | undefined;
    rawContent?: string | undefined;
    importerName: string;
    importerVersion: string;
  } | undefined;
}
