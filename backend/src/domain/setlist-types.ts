/**
 * @file setlist-types.ts
 * @description Tipos e interfaces de dominio para Setlists y Momentos de Servicio (Fase 2C).
 */

export const SetlistStatusEnum = [
  'PLANNING',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
] as const;

export type SetlistStatus = (typeof SetlistStatusEnum)[number];

export const SetlistItemTypeEnum = [
  'SONG',
  'SERVICE_MOMENT',
] as const;

export type SetlistItemType = (typeof SetlistItemTypeEnum)[number];

export const TransitionTypeEnum = [
  'SEGUE',
  'CROSSFADE',
  'STOP',
  'MEDLEY',
] as const;

export type TransitionType = (typeof TransitionTypeEnum)[number];

/**
 * Entidad de dominio pura para un Setlist.
 */
export interface SetlistEntity {
  id: string;
  title: string;
  scheduledDateTime: Date | null;
  status: SetlistStatus;
  directorUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entidad de dominio pura para un elemento individual dentro de un Setlist.
 */
export interface SetlistItemEntity {
  id: string;
  setlistId: string;
  sequenceOrder: number;
  itemType: SetlistItemType;
  // Campos cuando itemType === 'SONG'
  songId: string | null;
  targetKey: string | null;
  targetBpm: number | null;
  transitionType: TransitionType | null;
  // Campos cuando itemType === 'SERVICE_MOMENT'
  momentTitle: string | null;
  durationMinutes: number | null;
  musicalKey: string | null;
  // Notas generales de dinámica y dirección
  notesForTeam: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Representación expandida de un SetlistItem que incluye el resumen de la canción vinculada.
 */
export interface SetlistItemWithSongEntity extends SetlistItemEntity {
  song?: {
    id: string;
    title: string;
    artist: string | null;
    defaultKey: string;
    defaultBpm: number;
    timeSignature: string;
    status: string;
  } | null;
}

/**
 * Representación agregada completa de un Setlist con sus ítems ordenados.
 */
export interface SetlistWithItemsEntity extends SetlistEntity {
  directorName?: string | null;
  items: SetlistItemWithSongEntity[];
}

/**
 * Resumen de Setlist para listados paginados.
 */
export interface SetlistSummaryEntity {
  id: string;
  title: string;
  scheduledDateTime: Date | null;
  status: SetlistStatus;
  directorUserId: string | null;
  directorName?: string | null;
  totalItems: number;
  totalSongs: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Opciones de filtrado para consulta de setlists.
 */
export interface SetlistFilterOptions {
  status?: SetlistStatus;
  upcoming?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================================
// DTOs DE PERSISTENCIA Y REPOSITORIO (FASE 2C — WS3)
// ============================================================================

export interface CreateSetlistDTO {
  title: string;
  scheduledDateTime?: Date | string | null;
  status?: SetlistStatus;
  directorUserId?: string | null;
  notes?: string | null;
}

export interface UpdateSetlistDTO {
  title?: string;
  scheduledDateTime?: Date | string | null;
  directorUserId?: string | null;
  notes?: string | null;
}

export interface CreateSetlistItemDTO {
  itemType: SetlistItemType;
  sequenceOrder?: number;
  notesForTeam?: string | null;
  // Campos cuando itemType === 'SONG'
  songId?: string | null;
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: TransitionType | null;
  // Campos cuando itemType === 'SERVICE_MOMENT'
  momentTitle?: string | null;
  durationMinutes?: number | null;
  musicalKey?: string | null;
}

export interface UpdateSetlistItemDTO {
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: TransitionType | null;
  momentTitle?: string | null;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
}

export interface ReorderSetlistItemsDTO {
  itemIds: string[];
}
