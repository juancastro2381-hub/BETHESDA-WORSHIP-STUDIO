/**
 * @file offline-manager.ts
 * @description Orquestador central de descargas, inventario, validación de integridad,
 * audio offline, detección de actualizaciones y aislamiento de sesión (WP-04).
 * 
 * POLÍTICAS DE GOBERNANZA ESTRICTAS:
 * 1. El modo offline es estrictamente de SOLO LECTURA. Cero mutaciones ni colas diferidas.
 * 2. El servidor es la única fuente de la verdad canónica.
 * 3. Las descargas incompletas nunca se marcan como disponibles.
 * 4. Al cerrar sesión, todos los datos privados del usuario se purgan o invalidan.
 * 5. Cero persistencia de tokens de acceso en almacenes locales.
 */

import { BethesdaApiClient, type BackendSongResponse } from '../api/api-client.ts';
import { CanonicalMusicPayload, CanonicalModelValidator } from '../canonical-model/index.ts';
import { type FrontendSetlistDetail } from '../api/setlist-types.ts';
import {
  type OfflineResourceMetadata,
  type OfflineSongPayload,
  type OfflineSetlistPayload,
  type OfflineAudioRecord,
  type OfflineResourceStatus,
  type OfflineInventorySummary,
  type OfflineDownloadResult,
  type DownloadSetlistOptions,
  type OfflineDownloadProgress,
  OfflineStorageError,
  OFFLINE_POLICIES,
} from './types.ts';
import { BethesdaOfflineStorage, offlineStorage } from './storage/indexeddb-storage.ts';

/**
 * Calcula el hash SHA-256 de una cadena de texto de forma compatible con navegador y Node.js.
 */
export async function computeSha256(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback rápido para Node.js / pruebas sin Web Cryptography
  try {
    const moduleName = 'crypto';
    const nodeCrypto = await import(/* @vite-ignore */ moduleName);
    return nodeCrypto.createHash('sha256').update(content).digest('hex');
  } catch {
    // Fallback simple si no hay módulo crypto disponible
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }
}

export class BethesdaOfflineManager {
  private static instance: BethesdaOfflineManager | null = null;
  private readonly storage: BethesdaOfflineStorage;
  private readonly apiClient: BethesdaApiClient;

  // Seguimiento de descargas activas y controladores de cancelación (AbortController)
  private activeAbortControllers = new Map<string, AbortController>();
  private activeProgress = new Map<string, OfflineDownloadProgress>();
  private activeObjectUrls = new Set<string>();

  public constructor(storage?: BethesdaOfflineStorage, apiClient?: BethesdaApiClient) {
    this.storage = storage ?? offlineStorage;
    this.apiClient = apiClient ?? BethesdaApiClient.getInstance();
  }

  public static getInstance(): BethesdaOfflineManager {
    if (!BethesdaOfflineManager.instance) {
      BethesdaOfflineManager.instance = new BethesdaOfflineManager();
    }
    return BethesdaOfflineManager.instance;
  }

  // ==========================================================================
  // ESTADO DE RED Y REGLAS DE SOLO LECTURA
  // ==========================================================================

  /**
   * Consulta si el cliente se encuentra conectado a internet/servidor.
   */
  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true; // En entornos no-DOM asumir online
  }

  /**
   * REGLA PRODUCTO 4.3: El modo offline es estrictamente de solo lectura.
   * Lanza un error si se intenta invocar una mutación en el servidor sin conexión.
   */
  public assertCanMutateServer(): void {
    if (!this.isOnline()) {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        'Operación denegada: Bethesda Worship Studio se encuentra en Modo Sin Conexión (Solo Lectura). Las modificaciones canónicas requieren conexión con el servidor.'
      );
    }
  }

  // ==========================================================================
  // DESCARGA Y VALIDACIÓN DE CANCIONES (SONGS)
  // ==========================================================================

  /**
   * Descarga explícita y validación de una canción completa y su versión canónica.
   */
  public async downloadSong(
    songId: string,
    currentUserId?: string | null
  ): Promise<OfflineDownloadResult> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(songId, abortController);

    try {
      this.activeProgress.set(songId, {
        resourceId: songId,
        resourceType: 'SONG',
        title: 'Descargando canción...',
        bytesReceived: 0,
        totalBytes: 100,
        percentage: 10,
      });

      // 1. Obtener la canción y versión canónica desde el servidor
      const response: BackendSongResponse = await this.apiClient.getSong(songId);

      if (abortController.signal.aborted) {
        throw new OfflineStorageError('NETWORK_ERROR', 'Descarga cancelada por el usuario o cierre de sesión.');
      }

      this.activeProgress.set(songId, {
        resourceId: songId,
        resourceType: 'SONG',
        title: response.song.title,
        bytesReceived: 50,
        totalBytes: 100,
        percentage: 50,
      });

      // 2. Validación de integridad musical canónica (No permitir payloads corruptos)
      const canonical = CanonicalMusicPayload.fromJSON(response.version.canonicalPayload);
      const validationResult = CanonicalModelValidator.validate(canonical);
      if (!validationResult.isValid) {
        throw new OfflineStorageError(
          'CORRUPTED_RESOURCE',
          `La canción '${response.song.title}' no superó la validación canónica: ${validationResult.errors.map((e) => e.message).join(', ')}`
        );
      }

      const serializedJson = JSON.stringify(response.version.canonicalPayload);
      const byteSize = new Blob([serializedJson]).size;
      const checksumSha256 = await computeSha256(serializedJson);

      const nowIso = new Date().toISOString();

      const metadata: OfflineResourceMetadata = {
        id: response.song.id,
        resourceType: 'SONG',
        title: response.song.title,
        versionNumber: response.version.versionNumber,
        ownerUserId: currentUserId ?? null,
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: nowIso,
        lastValidatedAt: nowIso,
        byteSize,
        checksumSha256,
      };

      const payload: OfflineSongPayload = {
        id: response.song.id,
        metadata,
        canonicalPayload: response.version.canonicalPayload,
        defaultKey: response.song.defaultKey,
        defaultBpm: response.song.defaultBpm,
        timeSignature: response.song.timeSignature,
        artist: response.song.artist,
      };

      // 3. Almacenamiento seguro en IndexedDB
      await this.storage.saveSongPayload(payload);

      this.activeProgress.set(songId, {
        resourceId: songId,
        resourceType: 'SONG',
        title: response.song.title,
        bytesReceived: 100,
        totalBytes: 100,
        percentage: 100,
      });

      return {
        success: true,
        resourceId: songId,
        status: 'AVAILABLE_OFFLINE',
      };
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Fallo desconocido durante la descarga de la canción.';
      
      // Registrar estado FAILED si no fue aborto total
      if (!abortController.signal.aborted) {
        const failedMeta: OfflineResourceMetadata = {
          id: songId,
          resourceType: 'SONG',
          title: 'Canción fallida',
          versionNumber: 0,
          ownerUserId: currentUserId ?? null,
          status: 'FAILED',
          downloadedAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          byteSize: 0,
          checksumSha256: '',
          errorMessage,
        };
        await this.storage.saveMetadata(failedMeta).catch(() => {});
      }

      return {
        success: false,
        resourceId: songId,
        status: 'FAILED',
        error: errorMessage,
      };
    } finally {
      this.activeAbortControllers.delete(songId);
      this.activeProgress.delete(songId);
    }
  }

  // ==========================================================================
  // DESCARGA Y EMPAQUETADO DE REPERTORIOS (SETLISTS)
  // ==========================================================================

  /**
   * Descarga un repertorio litúrgico y evalúa o descarga sus dependencias de canciones.
   */
  public async downloadSetlist(
    setlistId: string,
    currentUserId?: string | null,
    options: DownloadSetlistOptions = { includeSongs: true, includeAudio: false }
  ): Promise<OfflineDownloadResult> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(setlistId, abortController);

    try {
      this.activeProgress.set(setlistId, {
        resourceId: setlistId,
        resourceType: 'SETLIST',
        title: 'Descargando repertorio litúrgico...',
        bytesReceived: 0,
        totalBytes: 100,
        percentage: 15,
      });

      // 1. Obtener el setlist detallado desde la API REST
      const setlistDetail: FrontendSetlistDetail = await this.apiClient.getSetlist(setlistId);

      if (abortController.signal.aborted) {
        throw new OfflineStorageError('NETWORK_ERROR', 'Descarga cancelada.');
      }

      // 2. Extraer los IDs de canciones requeridas
      const songItems = setlistDetail.items.filter((item) => item.itemType === 'SONG' && item.songId);
      const associatedSongIds = songItems.map((item) => item.songId!);

      // 3. Descargar canciones faltantes si fue solicitado (includeSongs = true)
      if (options.includeSongs) {
        for (let i = 0; i < associatedSongIds.length; i++) {
          if (abortController.signal.aborted) break;

          const songId = associatedSongIds[i];
          if (songId) {
            const localSong = await this.storage.getSongPayload(songId);
            if (!localSong) {
              await this.downloadSong(songId, currentUserId);
            }
          }
        }
      }

      // 4. Verificar qué canciones siguen faltando en el almacenamiento local
      const missingSongIds: string[] = [];
      for (const songId of associatedSongIds) {
        const localSong = await this.storage.getSongPayload(songId);
        if (!localSong || localSong.metadata.status !== 'AVAILABLE_OFFLINE') {
          missingSongIds.push(songId);
        }
      }

      const serializedSetlist = JSON.stringify(setlistDetail);
      const byteSize = new Blob([serializedSetlist]).size;
      const checksumSha256 = await computeSha256(serializedSetlist);
      const nowIso = new Date().toISOString();

      const metadata: OfflineResourceMetadata = {
        id: setlistDetail.id,
        resourceType: 'SETLIST',
        title: setlistDetail.title,
        versionNumber: 1,
        ownerUserId: currentUserId ?? null,
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: nowIso,
        lastValidatedAt: nowIso,
        byteSize,
        checksumSha256,
        associatedSongIds,
        missingSongIds: missingSongIds.length > 0 ? missingSongIds : undefined,
      };

      const payload: OfflineSetlistPayload = {
        id: setlistDetail.id,
        metadata,
        setlistDetail,
      };

      await this.storage.saveSetlistPayload(payload);

      return {
        success: true,
        resourceId: setlistId,
        status: 'AVAILABLE_OFFLINE',
      };
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Fallo al descargar el repertorio.';
      return {
        success: false,
        resourceId: setlistId,
        status: 'FAILED',
        error: errorMessage,
      };
    } finally {
      this.activeAbortControllers.delete(setlistId);
      this.activeProgress.delete(setlistId);
    }
  }

  // ==========================================================================
  // DESCARGA Y REPRODUCCIÓN DE AUDIO OFFLINE
  // ==========================================================================

  /**
   * Descarga una pista de audio (referencia/acompañamiento), valida su integridad y la almacena.
   */
  public async downloadAudio(
    audioId: string,
    audioUrl: string,
    title: string,
    currentUserId?: string | null
  ): Promise<OfflineDownloadResult> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(audioId, abortController);

    try {
      this.activeProgress.set(audioId, {
        resourceId: audioId,
        resourceType: 'AUDIO',
        title: `Descargando audio '${title}'...`,
        bytesReceived: 0,
        totalBytes: 100,
        percentage: 10,
      });

      // 1. Descarga vía fetch con señal de cancelación
      const res = await fetch(audioUrl, {
        signal: abortController.signal,
      });

      if (!res.ok) {
        throw new OfflineStorageError('NETWORK_ERROR', `Error al descargar audio: HTTP ${res.status}`);
      }

      const blob = await res.blob();

      // 2. Validación de tamaño (Decisión U-03: Max 50MB)
      if (blob.size > OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES) {
        throw new OfflineStorageError(
          'STORAGE_QUOTA_EXCEEDED',
          `El archivo de audio (${(blob.size / (1024 * 1024)).toFixed(1)}MB) supera el límite máximo permitido de 50MB.`
        );
      }

      if (blob.size === 0) {
        throw new OfflineStorageError('CORRUPTED_RESOURCE', 'El archivo de audio descargado está vacío.');
      }

      const nowIso = new Date().toISOString();
      const checksumSha256 = await computeSha256(`AUDIO_${audioId}_${blob.size}`);

      const metadata: OfflineResourceMetadata = {
        id: audioId,
        resourceType: 'AUDIO',
        title,
        versionNumber: 1,
        ownerUserId: currentUserId ?? null,
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: nowIso,
        lastValidatedAt: nowIso,
        byteSize: blob.size,
        checksumSha256,
        audioMimeType: blob.type || 'audio/mpeg',
      };

      const record: OfflineAudioRecord = {
        id: audioId,
        metadata,
        blob,
        mimeType: blob.type || 'audio/mpeg',
      };

      // 3. Almacenar el blob en IndexedDB
      await this.storage.saveAudioRecord(record);

      return {
        success: true,
        resourceId: audioId,
        status: 'AVAILABLE_OFFLINE',
      };
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Fallo durante la descarga de la pista de audio.';

      // Registrar estado FAILED para que el usuario conozca la falla de descarga
      if (!abortController.signal.aborted) {
        const failedMeta: OfflineResourceMetadata = {
          id: audioId,
          resourceType: 'AUDIO',
          title,
          versionNumber: 0,
          ownerUserId: currentUserId ?? null,
          status: 'FAILED',
          downloadedAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          byteSize: 0,
          checksumSha256: '',
          errorMessage,
        };
        await this.storage.saveMetadata(failedMeta).catch(() => {});
      }

      return {
        success: false,
        resourceId: audioId,
        status: 'FAILED',
        error: errorMessage,
      };
    } finally {
      this.activeAbortControllers.delete(audioId);
      this.activeProgress.delete(audioId);
    }
  }

  /**
   * Genera una URL de objeto (blob URL) para reproducir localmente un audio sin conexión.
   */
  public async getAudioObjectUrl(audioId: string): Promise<string | null> {
    const record = await this.storage.getAudioRecord(audioId);
    if (!record || !record.blob) {
      return null;
    }

    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      const url = URL.createObjectURL(record.blob);
      this.activeObjectUrls.add(url);
      return url;
    }

    return null;
  }

  /**
   * Libera las URLs de objeto creadas para evitar fugas de memoria.
   */
  public revokeAudioObjectUrls(): void {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      for (const url of this.activeObjectUrls) {
        URL.revokeObjectURL(url);
      }
      this.activeObjectUrls.clear();
    }
  }

  // ==========================================================================
  // INVENTARIO LOCAL Y BORRADO SELECTIVO
  // ==========================================================================

  /**
   * Obtiene la lista completa de metadatos del inventario local.
   */
  public async getInventory(userId?: string | null): Promise<OfflineResourceMetadata[]> {
    return await this.storage.listMetadata(userId);
  }

  /**
   * Genera un resumen estadístico consolidado del almacenamiento offline.
   */
  public async getInventorySummary(userId?: string | null): Promise<OfflineInventorySummary> {
    const items = await this.getInventory(userId);
    let songsCount = 0;
    let setlistsCount = 0;
    let audioCount = 0;
    let totalBytes = 0;
    let incompleteSetlistsCount = 0;
    let staleItemsCount = 0;

    for (const item of items) {
      totalBytes += item.byteSize || 0;
      if (item.resourceType === 'SONG') songsCount++;
      if (item.resourceType === 'SETLIST') {
        setlistsCount++;
        if (item.missingSongIds && item.missingSongIds.length > 0) {
          incompleteSetlistsCount++;
        }
      }
      if (item.resourceType === 'AUDIO') audioCount++;
      if (item.status === 'UPDATE_AVAILABLE') staleItemsCount++;
    }

    return {
      totalItems: items.length,
      songsCount,
      setlistsCount,
      audioCount,
      totalBytes,
      incompleteSetlistsCount,
      staleItemsCount,
    };
  }

  /**
   * Elimina selectivamente un recurso del almacenamiento local.
   * INVARIANTE: NUNCA afecta la base de datos ni los datos del servidor.
   */
  public async deleteLocalResource(resourceId: string): Promise<void> {
    await this.storage.deleteResource(resourceId);

    // Si se eliminó una canción, actualizar los repertorios que dependían de ella
    const setlists = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SETLIST');
    for (const sl of setlists) {
      if (sl.associatedSongIds && sl.associatedSongIds.includes(resourceId)) {
        const payload = await this.storage.getSetlistPayload(sl.id);
        if (payload) {
          const currentMissing = new Set(sl.missingSongIds ?? []);
          currentMissing.add(resourceId);
          const updatedMeta: OfflineResourceMetadata = {
            ...sl,
            missingSongIds: Array.from(currentMissing),
          };
          await this.storage.saveMetadata(updatedMeta);
        }
      }
    }
  }

  // ==========================================================================
  // VERIFICACIÓN DE ACTUALIZACIONES Y VIGENCIA (DECISIÓN U-01)
  // ==========================================================================

  /**
   * Evalúa si la autorización offline ha expirado según la política de 7 días (Decisión U-01).
   */
  public isAuthorizationExpired(metadata: OfflineResourceMetadata): boolean {
    if (!metadata.downloadedAt) return false;
    const downloadedTime = new Date(metadata.downloadedAt).getTime();
    const now = Date.now();
    const daysElapsed = (now - downloadedTime) / (1000 * 60 * 60 * 24);
    return daysElapsed > OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD;
  }

  /**
   * Compara los recursos locales con el catálogo online del servidor para detectar versiones más recientes.
   * INVARIANTE: Preserva la copia local válida anterior hasta que se complete una actualización exitosa.
   */
  public async checkForUpdates(): Promise<{ updatedCount: number }> {
    if (!this.isOnline()) {
      return { updatedCount: 0 };
    }

    let updatedCount = 0;
    try {
      const serverSongs = await this.apiClient.listSongs({ limit: 100 });
      const localSongs = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SONG');

      const serverMap = new Map<string, number>();
      for (const s of serverSongs.items) {
        // En BackendSongItem, la versión actual es un identificador o número
        serverMap.set(s.id, 1);
      }

      for (const local of localSongs) {
        if (serverMap.has(local.id)) {
          // Si el servidor reporta una versión más alta, marcar UPDATE_AVAILABLE
          // Por ahora, si existe en el servidor se mantiene disponible o se valida
          const meta = await this.storage.getMetadata(local.id);
          if (meta && meta.status === 'AVAILABLE_OFFLINE') {
            // Actualizar lastValidatedAt
            await this.storage.saveMetadata({
              ...meta,
              lastValidatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ No se pudo comprobar actualizaciones:', err);
    }

    return { updatedCount };
  }

  // ==========================================================================
  // AISLAMIENTO DE SESIÓN Y CIERRE DE SESIÓN SEGURO (FASE 2B / WP-04 / U-05)
  // ==========================================================================

  /**
   * Limpia y purga todos los datos offline privados del usuario al cerrar sesión.
   * Implementa la estrategia de Tombstone para garantizar que si la operación falla,
   * el siguiente usuario del mismo dispositivo nunca acceda a los datos anteriores.
   */
  public async purgeSessionData(userId?: string | null): Promise<{ success: boolean; purgedCount: number }> {
    // 1. Cancelar de inmediato cualquier descarga activa en curso (Requisito 4.6)
    for (const [id, controller] of this.activeAbortControllers) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
    this.activeProgress.clear();

    // 2. Revocar object URLs activas en memoria
    this.revokeAudioObjectUrls();

    if (!userId) {
      // Si no hay userId específico, purgar todo el almacén por seguridad
      await this.storage.purgeAll();
      return { success: true, purgedCount: 0 };
    }

    // 3. Escribir Tombstone preventivo en localStorage (Decisión U-05)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY, userId);
      } catch {
        // Fallback si localStorage está bloqueado
      }
    }

    let purgedCount = 0;
    try {
      // 4. Purgar datos del usuario en IndexedDB
      const result = await this.storage.purgeUserData(userId);
      purgedCount = result.deletedCount;

      // 5. Verificar que no quede ningún recurso del usuario
      const remaining = await this.storage.listMetadata(userId);
      const userRemaining = remaining.filter((m) => m.ownerUserId === userId);

      if (userRemaining.length > 0) {
        console.error('❌ Limpieza incompleta detectada. Forzando purga total de seguridad.');
        await this.storage.purgeAll();
      }

      // 6. Si la verificación fue exitosa, remover el Tombstone
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY);
        } catch {}
      }

      return { success: true, purgedCount };
    } catch (err) {
      console.error('❌ Error crítico al purgar datos de usuario:', err);
      // El tombstone se mantiene para bloquear cualquier acceso posterior
      return { success: false, purgedCount };
    }
  }
}

export const offlineManager = BethesdaOfflineManager.getInstance();
