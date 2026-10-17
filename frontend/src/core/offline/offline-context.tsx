/**
 * @file offline-context.tsx
 * @description Contexto de React y Proveedor para el estado offline de la aplicación (WP-04).
 */

import React, { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  type OfflineResourceMetadata,
  type OfflineInventorySummary,
  type OfflineResourceStatus,
  type OfflineDownloadResult,
  type DownloadSetlistOptions,
  type OfflineDownloadProgress,
} from './types.ts';
import { offlineManager } from './offline-manager.ts';
import { useAuth } from '../auth/use-auth.ts';

export interface OfflineContextType {
  isOnline: boolean;
  inventory: OfflineResourceMetadata[];
  summary: OfflineInventorySummary;
  storageUsage: { usedBytes: number; quotaBytes?: number };
  downloadSong: (songId: string) => Promise<OfflineDownloadResult>;
  downloadSetlist: (setlistId: string, options?: DownloadSetlistOptions) => Promise<OfflineDownloadResult>;
  downloadAudio: (audioId: string, url: string, title: string) => Promise<OfflineDownloadResult>;
  deleteLocalResource: (resourceId: string) => Promise<void>;
  refreshInventory: () => Promise<void>;
  getAudioUrl: (audioId: string) => Promise<string | null>;
  isResourceDownloaded: (resourceId: string) => boolean;
  getResourceStatus: (resourceId: string) => OfflineResourceStatus;
  activeDownloads: Map<string, OfflineDownloadProgress>;
}

export const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

export const OfflineProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [inventory, setInventory] = useState<OfflineResourceMetadata[]>([]);
  const [summary, setSummary] = useState<OfflineInventorySummary>({
    totalItems: 0,
    songsCount: 0,
    setlistsCount: 0,
    audioCount: 0,
    totalBytes: 0,
    incompleteSetlistsCount: 0,
    staleItemsCount: 0,
  });
  const [storageUsage, setStorageUsage] = useState<{ usedBytes: number; quotaBytes?: number }>({
    usedBytes: 0,
  });
  const [activeDownloads] = useState<Map<string, OfflineDownloadProgress>>(new Map());

  // 1. Escuchar eventos de conectividad del navegador
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      offlineManager.checkForUpdates().catch(() => {});
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  // 2. Refrescar inventario y métricas de almacenamiento
  const refreshInventory = useCallback(async () => {
    try {
      const items = await offlineManager.getInventory(user?.id);
      setInventory(items);

      const s = await offlineManager.getInventorySummary(user?.id);
      setSummary(s);

      // Calcular estimación de almacenamiento
      const totalBytes = items.reduce((acc, curr) => acc + (curr.byteSize || 0), 0);
      setStorageUsage({ usedBytes: totalBytes });
    } catch (err) {
      console.warn('⚠️ No se pudo refrescar inventario offline:', err);
    }
  }, [user]);

  // Refrescar al montar o al cambiar de usuario autenticado
  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  // 3. Descargar Canción
  const downloadSong = useCallback(
    async (songId: string): Promise<OfflineDownloadResult> => {
      const result = await offlineManager.downloadSong(songId, user?.id);
      await refreshInventory();
      return result;
    },
    [user, refreshInventory]
  );

  // 4. Descargar Setlist
  const downloadSetlist = useCallback(
    async (setlistId: string, options?: DownloadSetlistOptions): Promise<OfflineDownloadResult> => {
      const result = await offlineManager.downloadSetlist(setlistId, user?.id, options);
      await refreshInventory();
      return result;
    },
    [user, refreshInventory]
  );

  // 5. Descargar Audio
  const downloadAudio = useCallback(
    async (audioId: string, url: string, title: string): Promise<OfflineDownloadResult> => {
      const result = await offlineManager.downloadAudio(audioId, url, title, user?.id);
      await refreshInventory();
      return result;
    },
    [user, refreshInventory]
  );

  // 6. Eliminar Copia Local
  const deleteLocalResource = useCallback(
    async (resourceId: string): Promise<void> => {
      await offlineManager.deleteLocalResource(resourceId);
      await refreshInventory();
    },
    [refreshInventory]
  );

  // 7. Consultar URL de Audio
  const getAudioUrl = useCallback(async (audioId: string): Promise<string | null> => {
    return await offlineManager.getAudioObjectUrl(audioId);
  }, []);

  // 8. Helpers de Consulta Rápida de Estado
  const isResourceDownloaded = useCallback(
    (resourceId: string): boolean => {
      return inventory.some(
        (item) => item.id === resourceId && item.status === 'AVAILABLE_OFFLINE'
      );
    },
    [inventory]
  );

  const getResourceStatus = useCallback(
    (resourceId: string): OfflineResourceStatus => {
      const found = inventory.find((item) => item.id === resourceId);
      return found ? found.status : 'NOT_DOWNLOADED';
    },
    [inventory]
  );

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        inventory,
        summary,
        storageUsage,
        downloadSong,
        downloadSetlist,
        downloadAudio,
        deleteLocalResource,
        refreshInventory,
        getAudioUrl,
        isResourceDownloaded,
        getResourceStatus,
        activeDownloads,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
};
