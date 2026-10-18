/**
 * @file types.ts
 * @description Tipos de dominio, contratos y estados para el subsistema PWA Offline (WP-04).
 */

import type { CanonicalMusicPayloadJSON } from '../canonical-model/index.ts';
import type { FrontendSetlistDetail } from '../api/setlist-types.ts';

/**
 * Estados deterministas del ciclo de vida de descarga y almacenamiento local.
 */
export type OfflineResourceStatus =
  | 'NOT_DOWNLOADED'
  | 'DOWNLOADING'
  | 'AVAILABLE_OFFLINE'
  | 'UPDATE_AVAILABLE'
  | 'FAILED'
  | 'REMOVED';

/**
 * Tipos de recursos musicales y litúrgicos soportados para descarga offline.
 */
export type OfflineResourceType = 'SONG' | 'SETLIST' | 'AUDIO';

/**
 * Metadatos persistidos en IndexedDB para cada recurso descargado.
 */
export interface OfflineResourceMetadata {
  /** Identificador único canónico (UUID) */
  readonly id: string;
  /** Tipo de recurso */
  readonly resourceType: OfflineResourceType;
  /** Título del recurso o nombre de la pista */
  readonly title: string;
  /** Número de versión o revisión del recurso en el servidor */
  readonly versionNumber: number;
  /** ID del usuario propietario de la sesión que autorizó la descarga */
  readonly ownerUserId: string | null;
  /** Estado actual de disponibilidad */
  readonly status: OfflineResourceStatus;
  /** Marca de tiempo ISO del momento exacto de descarga exitosa */
  readonly downloadedAt: string;
  /** Marca de tiempo ISO de la última verificación de integridad */
  readonly lastValidatedAt: string;
  /** Tamaño del contenido almacenado en bytes */
  readonly byteSize: number;
  /** Hash criptográfico SHA-256 de integridad del payload */
  readonly checksumSha256: string;
  /** Indica si el checksum fue verificado autoritativamente contra el servidor en la descarga */
  readonly checksumVerifiedAuthoritatively?: boolean | undefined;
  /** Mensaje de error descriptivo en caso de estado FAILED */
  readonly errorMessage?: string | undefined;
  /** Para SETLIST: lista de IDs de canciones que componen el repertorio */
  readonly associatedSongIds?: readonly string[] | undefined;
  /** Para SETLIST: lista de IDs de canciones faltantes para considerarlo completo */
  readonly missingSongIds?: readonly string[] | undefined;
  /** Para AUDIO: tipo MIME del archivo de audio */
  readonly audioMimeType?: string | undefined;
  /** Para AUDIO: nombre original del archivo */
  readonly audioFilename?: string | undefined;
}

/**
 * Carga útil para almacenamiento local de una canción canónica completa.
 */
export interface OfflineSongPayload {
  readonly id: string;
  readonly metadata: OfflineResourceMetadata;
  readonly canonicalPayload: CanonicalMusicPayloadJSON;
  readonly defaultKey: string;
  readonly defaultBpm: number;
  readonly timeSignature: string;
  readonly artist?: string | null | undefined;
}

/**
 * Carga útil para almacenamiento local de un setlist litúrgico.
 */
export interface OfflineSetlistPayload {
  readonly id: string;
  readonly metadata: OfflineResourceMetadata;
  readonly setlistDetail: FrontendSetlistDetail;
}

/**
 * Registro de audio almacenado localmente en IndexedDB.
 */
export interface OfflineAudioRecord {
  readonly id: string;
  readonly metadata: OfflineResourceMetadata;
  readonly blob: Blob;
  readonly mimeType: string;
}

/**
 * Progreso en tiempo real de una descarga en curso.
 */
export interface OfflineDownloadProgress {
  readonly resourceId: string;
  readonly resourceType: OfflineResourceType;
  readonly title: string;
  readonly bytesReceived: number;
  readonly totalBytes: number;
  readonly percentage: number;
}

/**
 * Resumen consolidado del inventario local.
 */
export interface OfflineInventorySummary {
  readonly totalItems: number;
  readonly songsCount: number;
  readonly setlistsCount: number;
  readonly audioCount: number;
  readonly totalBytes: number;
  readonly incompleteSetlistsCount: number;
  readonly staleItemsCount: number;
}

/**
 * Resultado de una operación de descarga o actualización.
 */
export interface OfflineDownloadResult {
  readonly success: boolean;
  readonly resourceId: string;
  readonly status: OfflineResourceStatus;
  readonly error?: string | undefined;
}

/**
 * Opciones para descargar un setlist.
 */
export interface DownloadSetlistOptions {
  /** Si es true, también intenta descargar las canciones que no estén en local */
  readonly includeSongs?: boolean;
  /** Si es true y existen pistas de audio, intenta descargarlas (Opt-in U-02) */
  readonly includeAudio?: boolean;
}

/**
 * Códigos de error del subsistema offline.
 */
export type OfflineErrorCode =
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'RESOURCE_NOT_FOUND'
  | 'CORRUPTED_RESOURCE'
  | 'OFFLINE_AUTHORIZATION_EXPIRED'
  | 'UNAUTHORIZED_SESSION'
  | 'NETWORK_ERROR'
  | 'STORAGE_UNAVAILABLE'
  | 'INTEGRITY_CHECK_FAILED';

/**
 * Error tipado del subsistema offline.
 */
export class OfflineStorageError extends Error {
  public readonly code: OfflineErrorCode;
  public readonly details?: unknown;

  public constructor(
    code: OfflineErrorCode,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'OfflineStorageError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Constantes y políticas de gobernanza de WP-04 (Decisiones no resueltas cerradas de forma segura y conservadora)
 */
export const OFFLINE_POLICIES = {
  /** Límite de días de gracia de autorización offline antes de requerir reconexión (Decisión U-01) */
  MAX_OFFLINE_DAYS_GRACE_PERIOD: 7,
  /** Tamaño máximo de un archivo individual permitido para almacenamiento local en bytes: 50MB (Decisión U-03) */
  MAX_SINGLE_RESOURCE_SIZE_BYTES: 50 * 1024 * 1024,
  /** Umbral de cuota de almacenamiento que dispara advertencia y rechazo preventivo: 85% */
  MAX_STORAGE_QUOTA_USAGE_RATIO: 0.85,
  /** Espacio libre mínimo requerido en disco/navegador antes de autorizar descarga: 20MB */
  MIN_REQUIRED_FREE_SPACE_BYTES: 20 * 1024 * 1024,
  /** Clave de tombstone en localStorage para verificar la limpieza de sesión (Decisión U-05) */
  CLEANUP_TOMBSTONE_KEY: 'bethesda_offline_purge_pending',
} as const;
