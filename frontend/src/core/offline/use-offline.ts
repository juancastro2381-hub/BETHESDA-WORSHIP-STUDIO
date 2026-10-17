/**
 * @file use-offline.ts
 * @description Hook de consumo para el contexto offline de Bethesda Worship Studio (WP-04).
 */

import { useContext } from 'react';
import { OfflineContext, type OfflineContextType } from './offline-context.tsx';

export function useOffline(): OfflineContextType {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline debe utilizarse dentro de un <OfflineProvider>.');
  }
  return context;
}
