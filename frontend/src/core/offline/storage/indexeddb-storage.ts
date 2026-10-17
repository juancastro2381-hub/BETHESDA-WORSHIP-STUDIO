/**
 * @file indexeddb-storage.ts
 * @description Gestor de persistencia IndexedDB fuertemente tipado para Bethesda Worship Studio (WP-04).
 * 
 * PROPIEDADES DE SEGURIDAD Y RESILIENCIA:
 * - Aislamiento estricto por usuario (ownerUserId).
 * - Cero credenciales ni tokens en los almacenes locales.
 * - Soporte de fallback en memoria volátil para ejecución determinista en entornos Node.js / pruebas unitarias.
 * - Validación de cuota previa y control de errores.
 */

import {
  type OfflineResourceMetadata,
  type OfflineSongPayload,
  type OfflineSetlistPayload,
  type OfflineAudioRecord,
  OfflineStorageError,
  OFFLINE_POLICIES,
} from '../types.ts';

const DB_NAME = 'bethesda_worship_studio_offline_db';
const DB_VERSION = 1;

export const STORES = {
  METADATA: 'offline_metadata',
  SONG_PAYLOADS: 'song_payloads',
  SETLIST_PAYLOADS: 'setlist_payloads',
  AUDIO_BLOBS: 'audio_blobs',
} as const;

export class BethesdaOfflineStorage {
  private db: IDBDatabase | null = null;
  private isMemoryFallback = false;

  // Almacenes en memoria para entornos Node.js o navegadores que bloquean IndexedDB
  private memoryMetadata = new Map<string, OfflineResourceMetadata>();
  private memorySongs = new Map<string, OfflineSongPayload>();
  private memorySetlists = new Map<string, OfflineSetlistPayload>();
  private memoryAudio = new Map<string, OfflineAudioRecord>();

  public constructor() {
    // Si no existe indexedDB en el entorno (ej. Node.js native test runner), usar fallback
    if (typeof indexedDB === 'undefined') {
      this.isMemoryFallback = true;
    }
  }

  /**
   * Inicializa la conexión y crea los object stores e índices.
   */
  public async init(): Promise<void> {
    if (this.isMemoryFallback) {
      return;
    }

    if (this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 1. Almacén de Metadatos
          if (!db.objectStoreNames.contains(STORES.METADATA)) {
            const metaStore = db.createObjectStore(STORES.METADATA, { keyPath: 'id' });
            metaStore.createIndex('by_type', 'resourceType', { unique: false });
            metaStore.createIndex('by_owner', 'ownerUserId', { unique: false });
            metaStore.createIndex('by_status', 'status', { unique: false });
          }

          // 2. Almacén de Cargas Canónicas de Canciones
          if (!db.objectStoreNames.contains(STORES.SONG_PAYLOADS)) {
            db.createObjectStore(STORES.SONG_PAYLOADS, { keyPath: 'id' });
          }

          // 3. Almacén de Repertorios Litúrgicos (Setlists)
          if (!db.objectStoreNames.contains(STORES.SETLIST_PAYLOADS)) {
            db.createObjectStore(STORES.SETLIST_PAYLOADS, { keyPath: 'id' });
          }

          // 4. Almacén de Archivos de Audio Binarios (Blobs)
          if (!db.objectStoreNames.contains(STORES.AUDIO_BLOBS)) {
            db.createObjectStore(STORES.AUDIO_BLOBS, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          resolve();
        };

        request.onerror = (event) => {
          console.warn('⚠️ No se pudo inicializar IndexedDB. Activando fallback en memoria.', event);
          this.isMemoryFallback = true;
          resolve();
        };
      } catch (err) {
        console.warn('⚠️ Excepción al abrir IndexedDB. Activando fallback en memoria.', err);
        this.isMemoryFallback = true;
        resolve();
      }
    });
  }

  // ==========================================================================
  // METADATOS DE INVENTARIO
  // ==========================================================================

  public async saveMetadata(metadata: OfflineResourceMetadata): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memoryMetadata.set(metadata.id, { ...metadata });
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, 'readwrite');
      const store = tx.objectStore(STORES.METADATA);
      const req = store.put(metadata);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', 'Error al guardar metadatos en IndexedDB.'));
    });
  }

  public async getMetadata(id: string): Promise<OfflineResourceMetadata | null> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      return this.memoryMetadata.get(id) ?? null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, 'readonly');
      const store = tx.objectStore(STORES.METADATA);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al consultar metadatos con ID '${id}'.`));
    });
  }

  public async listMetadata(userId?: string | null): Promise<OfflineResourceMetadata[]> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      const all = Array.from(this.memoryMetadata.values());
      if (userId === undefined) return all;
      return all.filter((m) => m.ownerUserId === userId || m.ownerUserId === null);
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, 'readonly');
      const store = tx.objectStore(STORES.METADATA);
      const req = store.getAll();

      req.onsuccess = () => {
        const results: OfflineResourceMetadata[] = req.result ?? [];
        if (userId === undefined) {
          resolve(results);
        } else {
          resolve(results.filter((m) => m.ownerUserId === userId || m.ownerUserId === null));
        }
      };
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', 'Error al listar metadatos de IndexedDB.'));
    });
  }

  public async deleteMetadata(id: string): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memoryMetadata.delete(id);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, 'readwrite');
      const store = tx.objectStore(STORES.METADATA);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al eliminar metadatos '${id}'.`));
    });
  }

  // ==========================================================================
  // CARGAS CANÓNICAS DE CANCIONES (SONGS)
  // ==========================================================================

  public async saveSongPayload(payload: OfflineSongPayload): Promise<void> {
    await this.init();

    // Guardar metadatos asociados primero
    await this.saveMetadata(payload.metadata);

    if (this.isMemoryFallback || !this.db) {
      this.memorySongs.set(payload.id, { ...payload });
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SONG_PAYLOADS, 'readwrite');
      const store = tx.objectStore(STORES.SONG_PAYLOADS);
      const req = store.put(payload);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al almacenar canción '${payload.id}'.`));
    });
  }

  public async getSongPayload(id: string): Promise<OfflineSongPayload | null> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      return this.memorySongs.get(id) ?? null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SONG_PAYLOADS, 'readonly');
      const store = tx.objectStore(STORES.SONG_PAYLOADS);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al obtener canción '${id}'.`));
    });
  }

  public async deleteSongPayload(id: string): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memorySongs.delete(id);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SONG_PAYLOADS, 'readwrite');
      const store = tx.objectStore(STORES.SONG_PAYLOADS);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al eliminar canción '${id}'.`));
    });
  }

  // ==========================================================================
  // REPERTORIOS LITÚRGICOS (SETLISTS)
  // ==========================================================================

  public async saveSetlistPayload(payload: OfflineSetlistPayload): Promise<void> {
    await this.init();

    await this.saveMetadata(payload.metadata);

    if (this.isMemoryFallback || !this.db) {
      this.memorySetlists.set(payload.id, { ...payload });
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SETLIST_PAYLOADS, 'readwrite');
      const store = tx.objectStore(STORES.SETLIST_PAYLOADS);
      const req = store.put(payload);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al almacenar setlist '${payload.id}'.`));
    });
  }

  public async getSetlistPayload(id: string): Promise<OfflineSetlistPayload | null> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      return this.memorySetlists.get(id) ?? null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SETLIST_PAYLOADS, 'readonly');
      const store = tx.objectStore(STORES.SETLIST_PAYLOADS);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al obtener setlist '${id}'.`));
    });
  }

  public async deleteSetlistPayload(id: string): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memorySetlists.delete(id);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.SETLIST_PAYLOADS, 'readwrite');
      const store = tx.objectStore(STORES.SETLIST_PAYLOADS);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al eliminar setlist '${id}'.`));
    });
  }

  // ==========================================================================
  // PISTAS DE AUDIO BINARIAS (AUDIO BLOBS)
  // ==========================================================================

  public async saveAudioRecord(record: OfflineAudioRecord): Promise<void> {
    await this.init();

    // Validar límite por archivo (Decisión U-03)
    if (record.metadata.byteSize > OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES) {
      throw new OfflineStorageError(
        'STORAGE_QUOTA_EXCEEDED',
        `El archivo de audio (${(record.metadata.byteSize / (1024 * 1024)).toFixed(1)}MB) supera el límite máximo permitido de 50MB.`
      );
    }

    await this.saveMetadata(record.metadata);

    if (this.isMemoryFallback || !this.db) {
      this.memoryAudio.set(record.id, record);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.AUDIO_BLOBS, 'readwrite');
      const store = tx.objectStore(STORES.AUDIO_BLOBS);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al almacenar pista de audio '${record.id}'.`));
    });
  }

  public async getAudioRecord(id: string): Promise<OfflineAudioRecord | null> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      return this.memoryAudio.get(id) ?? null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.AUDIO_BLOBS, 'readonly');
      const store = tx.objectStore(STORES.AUDIO_BLOBS);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al obtener pista de audio '${id}'.`));
    });
  }

  public async deleteAudioRecord(id: string): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memoryAudio.delete(id);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.AUDIO_BLOBS, 'readwrite');
      const store = tx.objectStore(STORES.AUDIO_BLOBS);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', `Error al eliminar pista de audio '${id}'.`));
    });
  }

  // ==========================================================================
  // GESTIÓN DE RECURSOS, BORRADO SELECTIVO Y AISLAMIENTO DE SESIÓN
  // ==========================================================================

  /**
   * Elimina un recurso local y todos sus datos asociados (metadatos + carga).
   * NO AFECTA EL SERVIDOR (El servidor permanece como fuente de la verdad).
   */
  public async deleteResource(id: string): Promise<void> {
    const meta = await this.getMetadata(id);
    if (!meta) {
      return;
    }

    await this.deleteMetadata(id);

    if (meta.resourceType === 'SONG') {
      await this.deleteSongPayload(id);
    } else if (meta.resourceType === 'SETLIST') {
      await this.deleteSetlistPayload(id);
    } else if (meta.resourceType === 'AUDIO') {
      await this.deleteAudioRecord(id);
    }
  }

  /**
   * Obtiene la estimación de uso y cuota de almacenamiento local.
   */
  public async getStorageUsage(): Promise<{ usedBytes: number; quotaBytes?: number | undefined }> {
    await this.init();

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usedBytes: estimate.usage ?? 0,
          quotaBytes: estimate.quota !== undefined ? estimate.quota : undefined,
        };
      } catch {
        // Fallback al cálculo manual si navigator.storage falla
      }
    }

    const items = await this.listMetadata();
    const usedBytes = items.reduce((acc, curr) => acc + (curr.byteSize || 0), 0);
    return { usedBytes };
  }

  /**
   * Purga todos los datos locales privados pertenecientes a un usuario (Fase 2B / WP-04 Logout).
   * Garantiza que el siguiente usuario del mismo dispositivo no pueda acceder al material previo.
   */
  public async purgeUserData(userId: string): Promise<{ deletedCount: number }> {
    const userItems = await this.listMetadata(userId);
    let deletedCount = 0;

    for (const item of userItems) {
      if (item.ownerUserId === userId) {
        await this.deleteResource(item.id);
        deletedCount++;
      }
    }

    return { deletedCount };
  }

  /**
   * Purga completa y absoluta de todos los almacenes offline (Wipe total).
   */
  public async purgeAll(): Promise<void> {
    await this.init();

    if (this.isMemoryFallback || !this.db) {
      this.memoryMetadata.clear();
      this.memorySongs.clear();
      this.memorySetlists.clear();
      this.memoryAudio.clear();
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(
        [STORES.METADATA, STORES.SONG_PAYLOADS, STORES.SETLIST_PAYLOADS, STORES.AUDIO_BLOBS],
        'readwrite'
      );

      tx.objectStore(STORES.METADATA).clear();
      tx.objectStore(STORES.SONG_PAYLOADS).clear();
      tx.objectStore(STORES.SETLIST_PAYLOADS).clear();
      tx.objectStore(STORES.AUDIO_BLOBS).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new OfflineStorageError('STORAGE_UNAVAILABLE', 'Fallo al purgar almacenes IndexedDB.'));
    });
  }

  /**
   * Estima el uso y cuota de almacenamiento disponible.
   */
  public async estimateStorage(): Promise<{ usedBytes: number; quotaBytes?: number | undefined }> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        return {
          usedBytes: est.usage ?? 0,
          quotaBytes: est.quota !== undefined ? est.quota : undefined,
        };
      } catch {
        // Fallback al cálculo manual
      }
    }

    const all = await this.listMetadata();
    const usedBytes = all.reduce((acc, curr) => acc + (curr.byteSize || 0), 0);
    return { usedBytes };
  }
}

export const offlineStorage = new BethesdaOfflineStorage();
