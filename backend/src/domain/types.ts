/**
 * @file types.ts
 * @description Definiciones de tipos y DTOs de dominio para la persistencia backend (Fase 2A).
 */

import type { CanonicalMusicPayloadJSON } from '../../../frontend/src/core/canonical-model/index.ts';

export type SongReviewStatus = 'DRAFT' | 'APPROVED' | 'ARCHIVED';

export type SongSourceFormat = 'MUSIC_XML' | 'CHORD_PRO' | 'INTERNAL' | 'PDF' | 'IMAGE';

export interface SongEntity {
  id: string;
  title: string;
  artist: string | null;
  ccliNumber: string | null;
  defaultKey: string;
  defaultBpm: number;
  timeSignature: string;
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
  songId: string;
  versionId: string | null;
  sourceType: 'MUSIC_XML' | 'CHORD_PRO' | 'PDF' | 'IMAGE';
  filename: string | null;
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
  defaultKey: string;
  defaultBpm?: number | undefined;
  timeSignature?: string | undefined;
  status?: SongReviewStatus | undefined;
  versionName?: string | undefined;
  versionDescription?: string | undefined;
  sourceFormat: SongSourceFormat;
  canonicalPayload: CanonicalMusicPayloadJSON;
  sourceRecord?: {
    filename?: string | undefined;
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
