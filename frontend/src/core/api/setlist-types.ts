/**
 * @file setlist-types.ts
 * @description Tipos de datos, DTOs y uniones discriminadas para Setlists y Momentos Litúrgicos en el Frontend (Fase 2C — WS6).
 *
 * Contratos estrictos derivados y reconciliados contra los esquemas de backend de WS5:
 * - backend/src/interfaces/http/schemas/setlist.schemas.ts
 * - backend/src/domain/setlist-types.ts
 *
 * PROHIBICIÓN ABSOLUTA:
 * - Cero uso de 'any'.
 * - Tipos discriminados estrictos para SONG vs SERVICE_MOMENT.
 */

export type FrontendSetlistStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export type FrontendSetlistItemType = 'SONG' | 'SERVICE_MOMENT';

export type FrontendTransitionType = 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY';

/**
 * Resumen de setlist para vistas de catálogo y listados paginados.
 * Corresponde a SetlistSummaryEntity serializado.
 */
export interface FrontendSetlistSummary {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  directorName?: string | null;
  totalItems: number;
  totalSongs: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Entidad pura de setlist serializada por WS5 (POST, PUT, POST /status).
 * No contiene la lista de ítems.
 */
export interface FrontendSetlistEntity {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Metadatos ligeros de la canción embebida en un ítem de setlist retornado por WS5.
 */
export interface FrontendSetlistItemSong {
  id: string;
  title: string;
  artist: string | null;
  defaultKey: string;
  defaultBpm: number;
  timeSignature: string;
  status: string;
}

/**
 * Elemento individual de un setlist con datos polimórficos de canción o momento litúrgico.
 */
export interface FrontendSetlistItem {
  id: string;
  setlistId: string;
  sequenceOrder: number;
  itemType: FrontendSetlistItemType;
  songId: string | null;
  targetKey: string | null;
  targetBpm: number | null;
  transitionType: FrontendTransitionType | null;
  momentTitle: string | null;
  durationMinutes: number | null;
  musicalKey: string | null;
  notesForTeam: string | null;
  createdAt: string;
  updatedAt: string;
  song: FrontendSetlistItemSong | null;
}

/**
 * Detalle completo de un setlist con sus ítems ordenados.
 * Corresponde a la respuesta de GET /api/v1/setlists/:id.
 */
export interface FrontendSetlistDetail extends FrontendSetlistEntity {
  directorName?: string | null;
  items: FrontendSetlistItem[];
}

// ============================================================================
// PAYLOADS DISCRIMINADOS DE CREACIÓN Y ACTUALIZACIÓN
// ============================================================================

/**
 * Payload para crear un ítem de tipo SONG.
 * Exige songId y prohíbe campos de momento de servicio.
 */
export interface CreateSongItemPayload {
  itemType: 'SONG';
  songId: string;
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

/**
 * Payload para crear un ítem de tipo SERVICE_MOMENT.
 * Exige momentTitle y prohíbe songId.
 */
export interface CreateServiceMomentPayload {
  itemType: 'SERVICE_MOMENT';
  momentTitle: string;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

/**
 * Unión discriminada exhaustiva para creación de elementos en el setlist.
 */
export type CreateSetlistItemPayload =
  | CreateSongItemPayload
  | CreateServiceMomentPayload;

/**
 * Payload para actualización de un ítem existente.
 * Requiere que al menos un campo sea modificado.
 */
export interface UpdateSetlistItemPayload {
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  momentTitle?: string | null;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
}

/**
 * Payload para crear un nuevo setlist (estado inicial PLANNING).
 */
export interface CreateSetlistPayload {
  title: string;
  scheduledDateTime?: string | null;
  directorUserId?: string | null;
  notes?: string | null;
}

/**
 * Payload para modificar metadatos de un setlist existente.
 */
export interface UpdateSetlistPayload {
  title?: string;
  scheduledDateTime?: string | null;
  directorUserId?: string | null;
  notes?: string | null;
}

// ============================================================================
// DTOs DE RESPUESTA HTTP ENCAPSULADA
// ============================================================================

/**
 * Respuesta exacta producida por GET /api/v1/setlists en WS5.
 */
export interface HttpListSetlistsResponse {
  data: FrontendSetlistSummary[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Resultado ergonómico retornado por BethesdaApiClient.listSetlists().
 */
export interface FrontendListSetlistsResult {
  items: FrontendSetlistSummary[];
  total: number;
  limit: number;
  offset: number;
}
