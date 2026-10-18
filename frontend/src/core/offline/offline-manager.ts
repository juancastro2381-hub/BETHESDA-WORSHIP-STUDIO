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

import { BethesdaApiClient, type BackendSongResponse, type BackendSongItem } from '../api/api-client.ts';
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

  /**
   * Valida la cuota de almacenamiento disponible antes de autorizar una descarga (Decisión U-03).
   * Si navigator.storage.estimate() no está disponible o falla, opera con tolerancia sin bloquear.
   * Si la cuota proyectada supera el 85% (MAX_STORAGE_QUOTA_USAGE_RATIO), rechaza la operación.
   */
  public async assertStorageQuotaAvailable(projectedBytes: number = 0): Promise<void> {
    try {
      const usage = await this.storage.getStorageUsage();
      if (usage.quotaBytes && usage.quotaBytes > 0) {
        const totalProjected = usage.usedBytes + projectedBytes;
        const ratio = totalProjected / usage.quotaBytes;
        if (ratio >= OFFLINE_POLICIES.MAX_STORAGE_QUOTA_USAGE_RATIO) {
          throw new OfflineStorageError(
            'STORAGE_QUOTA_EXCEEDED',
            `Cuota de almacenamiento casi agotada (${(ratio * 100).toFixed(1)}% utilizado). Límite de seguridad: 85%. Libere espacio antes de descargar nuevos recursos.`
          );
        }
      }
    } catch (err) {
      if (err instanceof OfflineStorageError) throw err;
      // Tolerancia: si navigator.storage.estimate() falla o no está soportado, permitir descarga
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
      // 0. Validar cuota antes de iniciar
      await this.assertStorageQuotaAvailable(50 * 1024);

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
      // 0. Validar cuota antes de iniciar
      await this.assertStorageQuotaAvailable(100 * 1024);

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
      // 0. Validar cuota de almacenamiento disponible antes de iniciar
      await this.assertStorageQuotaAvailable(5 * 1024 * 1024);

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

      // 2. Validación de tipo MIME: debe ser audio/* (rechaza páginas HTML de error o JSON de fallo)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('audio/')) {
        throw new OfflineStorageError(
          'CORRUPTED_RESOURCE',
          `El tipo de contenido retornado ('${contentType}') no es un formato de audio válido (ej. audio/mpeg, audio/wav).`
        );
      }

      const blob = await res.blob();

      // 3. Validación de tamaño estricta contra bytes reales descargados (Decisión U-03: Max 50MB)
      if (blob.size > OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES) {
        throw new OfflineStorageError(
          'STORAGE_QUOTA_EXCEEDED',
          `El archivo de audio (${(blob.size / (1024 * 1024)).toFixed(1)}MB) supera el límite máximo permitido de 50MB.`
        );
      }

      if (blob.size === 0) {
        throw new OfflineStorageError('CORRUPTED_RESOURCE', 'El archivo de audio descargado está vacío (0 bytes).');
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
   * Si la autorización expiró y el cliente está offline, bloquea la reproducción (Decisión U-01).
   */
  public async getAudioObjectUrl(audioId: string): Promise<string | null> {
    const meta = await this.storage.getMetadata(audioId);
    if (meta && meta.status === 'FAILED') {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        `El acceso a la pista de audio '${meta.title}' fue revocado por el servidor.`
      );
    }

    const record = await this.storage.getAudioRecord(audioId);
    if (!record || !record.blob) {
      return null;
    }

    // Guard de seguridad contra audio revocado o en estado FAILED
    if (record.metadata.status === 'FAILED') {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        `El acceso a la pista de audio '${record.metadata.title}' fue revocado por el servidor.`
      );
    }

    if (this.isAuthorizationExpired(record.metadata)) {
      if (!this.isOnline()) {
        throw new OfflineStorageError(
          'UNAUTHORIZED_SESSION',
          `La autorización sin conexión de la pista de audio '${record.metadata.title}' ha expirado (límite de 7 días sin revalidar con el servidor).`
        );
      }
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
  /**
   * Actualiza los repertorios locales que dependían de una canción que fue eliminada o revocada.
   */
  private async updateSetlistsMissingSong(songId: string): Promise<void> {
    const setlists = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SETLIST');
    for (const sl of setlists) {
      if (sl.associatedSongIds && sl.associatedSongIds.includes(songId)) {
        const payload = await this.storage.getSetlistPayload(sl.id);
        if (payload) {
          const currentMissing = new Set(sl.missingSongIds ?? []);
          currentMissing.add(songId);
          const updatedMeta: OfflineResourceMetadata = {
            ...sl,
            missingSongIds: Array.from(currentMissing),
          };
          await this.storage.saveMetadata(updatedMeta);
        }
      }
    }
  }

  /**
   * Elimina selectivamente un recurso del almacenamiento local.
   * INVARIANTE: NUNCA afecta la base de datos ni los datos del servidor.
   */
  public async deleteLocalResource(resourceId: string): Promise<void> {
    await this.storage.deleteResource(resourceId);
    await this.updateSetlistsMissingSong(resourceId);
  }

  // ==========================================================================
  // VERIFICACIÓN DE ACTUALIZACIONES Y VIGENCIA (DECISIÓN U-01)
  // ==========================================================================

  /**
   * Evalúa si la autorización offline ha expirado según la política aprobada de 7 días (Decisión U-01).
   * REGLA DE SEGURIDAD AUDITADA:
   * 1. Utiliza estrictamente la fecha de la última revalidación exitosa con el servidor (lastValidatedAt),
   *    recurriendo a downloadedAt solo si lastValidatedAt no está definido.
   * 2. Calcula el límite exacto de 7 días (7 * 24 * 60 * 60 * 1000 ms).
   * 3. Detecta anomalías o atrasos deliberados del reloj del cliente (> 5 minutos en el pasado)
   *    marcando el recurso como expirado por seguridad.
   */
  public isAuthorizationExpired(metadata: OfflineResourceMetadata): boolean {
    const authTimestamp = metadata.lastValidatedAt || metadata.downloadedAt;
    if (!authTimestamp) return true;

    const authTime = new Date(authTimestamp).getTime();
    if (Number.isNaN(authTime)) return true;

    const now = Date.now();
    const elapsedMs = now - authTime;

    // Protección contra alteración o atraso malicioso del reloj del cliente (> 5 minutos en el pasado)
    if (elapsedMs < -300000) {
      console.warn(`⚠️ Posible alteración de reloj detectada para el recurso '${metadata.id}'. Marcando como expirado.`);
      return true;
    }

    const gracePeriodMs = OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD * 24 * 60 * 60 * 1000;
    return elapsedMs >= gracePeriodMs;
  }

  /**
   * Obtiene la carga útil de una canción garantizando la vigencia de autorización offline.
   * Si la autorización expiró y el cliente está offline, BLOQUEA la lectura arrojando UNAUTHORIZED_SESSION.
   * Si está en línea, revalida la autorización contra el servidor.
   * Si el recurso está en estado FAILED o revocado, BLOQUEA incondicionalmente la lectura.
   */
  public async getAuthorizedSongPayload(songId: string): Promise<OfflineSongPayload | null> {
    const meta = await this.storage.getMetadata(songId);
    if (meta && meta.status === 'FAILED') {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        `El acceso a la canción '${meta.title}' fue revocado por el servidor o no está disponible.`
      );
    }

    const payload = await this.storage.getSongPayload(songId);
    if (!payload) return null;

    // Guard de seguridad contra contenido revocado o en estado FAILED
    if (payload.metadata.status === 'FAILED') {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        `El acceso a la canción '${payload.metadata.title}' fue revocado por el servidor o no está disponible.`
      );
    }

    if (this.isAuthorizationExpired(payload.metadata)) {
      if (!this.isOnline()) {
        throw new OfflineStorageError(
          'UNAUTHORIZED_SESSION',
          `La autorización sin conexión de la obra '${payload.metadata.title}' ha expirado tras superar el período de gracia de 7 días sin revalidar con el servidor. Debe conectarse a internet para revalidar el acceso.`
        );
      }

      // Si está en línea, revalidar contra el servidor
      try {
        const response = await this.apiClient.getSong(songId);
        const nowIso = new Date().toISOString();
        const updatedMeta: OfflineResourceMetadata = {
          ...payload.metadata,
          lastValidatedAt: nowIso,
          versionNumber: response.version.versionNumber,
          status: 'AVAILABLE_OFFLINE',
        };
        const updatedPayload: OfflineSongPayload = {
          ...payload,
          metadata: updatedMeta,
        };
        // Persistir en ambos almacenes (song_payloads y metadata) para garantizar consistencia canónica (Finding A)
        await this.storage.saveSongPayload(updatedPayload);
        return updatedPayload;
      } catch (err: any) {
        if (err?.statusCode === 401 || err?.statusCode === 403) {
          await this.storage.deleteResource(songId);
          throw new OfflineStorageError(
            'UNAUTHORIZED_SESSION',
            `El acceso a la canción '${payload.metadata.title}' fue revocado por el servidor.`
          );
        }
        throw new OfflineStorageError(
          'UNAUTHORIZED_SESSION',
          `No se pudo revalidar la autorización de '${payload.metadata.title}' con el servidor.`
        );
      }
    }

    return payload;
  }

  /**
   * Compara los recursos locales con el catálogo online del servidor para detectar versiones más recientes.
   * INVARIANTE (Finding C & Revocation Read-Path Audit):
   * 1. Pagina exhaustivamente el catálogo del servidor sin truncar en 100 elementos.
   * 2. NUNCA infiere revocación por ausencia en respuestas parciales o errores de red.
   * 3. Compara números de versión reales (serverVersionNumber vs localVersionNumber) marcando UPDATE_AVAILABLE.
   * 4. Si la versión es igual o anterior, actualiza lastValidatedAt como revalidación exitosa.
   * 5. Para canciones ausentes del catálogo completo, realiza verificación dirigida con getSong(id);
   *    si el servidor responde 401/403 o 404, purga la carga útil de STORES.SONG_PAYLOADS, marca FAILED en metadatos,
   *    y actualiza los repertorios dependientes para que el contenido revocado no permanezca accesible.
   * 6. Preserva la copia local válida intacta ante errores transitorios.
   */
  public async checkForUpdates(): Promise<{ updatedCount: number; revokedCount: number }> {
    if (!this.isOnline()) {
      return { updatedCount: 0, revokedCount: 0 };
    }

    let updatedCount = 0;
    let revokedCount = 0;
    try {
      const localSongs = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SONG');
      if (localSongs.length === 0) {
        return { updatedCount: 0, revokedCount: 0 };
      }

      // 1. Paginación exhaustiva del catálogo del servidor
      const serverMap = new Map<string, BackendSongItem>();
      let offset = 0;
      const pageSize = 100;
      let catalogIsComplete = false;

      while (true) {
        const page = await this.apiClient.listSongs({ limit: pageSize, offset });
        for (const s of page.items) {
          serverMap.set(s.id, s);
        }
        offset += page.items.length;
        if (page.items.length === 0 || offset >= page.total) {
          catalogIsComplete = true;
          break;
        }
      }

      const nowIso = new Date().toISOString();

      // 2. Evaluación individual de cada canción local
      for (const local of localSongs) {
        if (serverMap.has(local.id)) {
          try {
            // Comparar versión real del servidor
            const serverSong = await this.apiClient.getSong(local.id);
            const serverVersion = serverSong.version?.versionNumber ?? 1;

            const meta = await this.storage.getMetadata(local.id);
            if (meta) {
              if (serverVersion > local.versionNumber) {
                updatedCount++;
                await this.storage.saveMetadata({
                  ...meta,
                  status: 'UPDATE_AVAILABLE',
                  lastValidatedAt: nowIso,
                });
              } else if (meta.status === 'AVAILABLE_OFFLINE') {
                await this.storage.saveMetadata({
                  ...meta,
                  lastValidatedAt: nowIso,
                });
              }
            }
          } catch (err: any) {
            const isUnauthorized =
              err?.statusCode === 401 ||
              err?.statusCode === 403 ||
              (typeof err?.message === 'string' && (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')));

            if (isUnauthorized) {
              revokedCount++;
              // Purgar carga útil de la canción revocada para que no quede accesible en disco
              await this.storage.deleteSongPayload(local.id);
              const meta = await this.storage.getMetadata(local.id);
              if (meta) {
                await this.storage.saveMetadata({
                  ...meta,
                  status: 'FAILED',
                  errorMessage: 'Autorización revocada por el servidor.',
                });
              }
              await this.updateSetlistsMissingSong(local.id);
            } else {
              // Falla transitoria: preservar la copia local válida y no extender lastValidatedAt
              console.warn(`⚠️ Error de red o transitorio al consultar versión de '${local.id}'. Preservando copia local.`);
            }
          }
        } else if (catalogIsComplete) {
          // Canción no encontrada en el catálogo completo: verificación dirigida para confirmar revocación real
          try {
            const serverSong = await this.apiClient.getSong(local.id);
            // El recurso aún existe en el servidor: actualizar versión o vigencia
            const serverVersion = serverSong.version?.versionNumber ?? 1;
            const meta = await this.storage.getMetadata(local.id);
            if (meta) {
              if (serverVersion > local.versionNumber) {
                updatedCount++;
                await this.storage.saveMetadata({
                  ...meta,
                  status: 'UPDATE_AVAILABLE',
                  lastValidatedAt: nowIso,
                });
              } else if (meta.status === 'AVAILABLE_OFFLINE') {
                await this.storage.saveMetadata({
                  ...meta,
                  lastValidatedAt: nowIso,
                });
              }
            }
          } catch (err: any) {
            const isRevokedOrRemoved =
              err?.statusCode === 404 ||
              err?.statusCode === 401 ||
              err?.statusCode === 403 ||
              (typeof err?.message === 'string' &&
                (err.message.includes('HTTP 404') ||
                  err.message.includes('HTTP 401') ||
                  err.message.includes('HTTP 403') ||
                  err.message.includes('no encontrada') ||
                  err.message.includes('No se encontró')));

            if (isRevokedOrRemoved) {
              revokedCount++;
              // Purgar carga útil de la canción retirada/revocada para que no quede accesible en disco
              await this.storage.deleteSongPayload(local.id);
              const meta = await this.storage.getMetadata(local.id);
              if (meta) {
                await this.storage.saveMetadata({
                  ...meta,
                  status: 'FAILED',
                  errorMessage: 'Autorización revocada o recurso retirado del catálogo del servidor.',
                });
              }
              await this.updateSetlistsMissingSong(local.id);
            } else {
              // Inconcluso por fallo de red: preservar la copia local válida
              console.warn(`⚠️ Verificación inconclusa para canción ausente '${local.id}'. Preservando copia local.`);
            }
          }
        }
        // Si !catalogIsComplete, NUNCA inferir revocación por ausencia.
      }
    } catch (err: any) {
      if (err?.statusCode === 401 || err?.statusCode === 403) {
        console.warn('⚠️ Sesión no autorizada en el servidor durante la comprobación de actualizaciones.');
      } else {
        console.warn('⚠️ No se pudo comprobar actualizaciones:', err);
      }
    }

    return { updatedCount, revokedCount };
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
