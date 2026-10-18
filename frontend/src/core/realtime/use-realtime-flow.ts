/**
 * @file use-realtime-flow.ts
 * @description Hook de React para la orquestación del Flujo Litúrgico en Tiempo Real (Fase 3B).
 *
 * Conecta el atril con la sesión de culto en vivo:
 * - Detecta automáticamente si el usuario es Director de Alabanza o Músico.
 * - Sincroniza índice de canción, momento litúrgico, sección musical y tonalidad.
 * - Permite al músico desvincularse temporalmente ("Atril Independiente") sin salir de la sesión.
 * - Reconexión automática resiliente con Server-Sent Events.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { RealtimeClient } from './realtime-client.ts';
import type {
  RealtimeConnectionState,
  RealtimeSessionSnapshot,
} from './realtime-types.ts';

export interface UseRealtimeFlowOptions {
  setlistId: string | null;
  setlistTitle?: string | null;
  currentUser: { id: string; role: string; email: string } | null;
  token: string | null;
  currentIndex: number;
  onSyncItemIndex?: (index: number) => void;
  onSyncKeyOverride?: (key: string | null) => void;
  onSyncBpmOverride?: (bpm: number | null) => void;
}

export interface UseRealtimeFlowReturn {
  connectionState: RealtimeConnectionState;
  session: RealtimeSessionSnapshot | null;
  isLive: boolean;
  isHost: boolean;
  isDecoupled: boolean;
  currentSection: string | null;
  error: string | null;
  startLiveSession: () => Promise<void>;
  joinLiveSession: () => Promise<void>;
  broadcastItemIndex: (index: number) => Promise<void>;
  broadcastSection: (section: string | null) => Promise<void>;
  broadcastKeyOverride: (keyOverride: string | null) => Promise<void>;
  broadcastBpmOverride: (bpmOverride: number | null) => Promise<void>;
  toggleDecoupled: () => void;
  concludeLiveSession: () => Promise<void>;
}

export function useRealtimeFlow({
  setlistId,
  currentUser,
  token,
  currentIndex,
  onSyncItemIndex,
  onSyncKeyOverride,
  onSyncBpmOverride,
}: UseRealtimeFlowOptions): UseRealtimeFlowReturn {
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('DISCONNECTED');
  const [session, setSession] = useState<RealtimeSessionSnapshot | null>(null);
  const [isDecoupled, setIsDecoupled] = useState(false);
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const isHost = Boolean(session && currentUser && session.hostUserId === currentUser.id);
  const isLive = Boolean(session && session.status === 'ACTIVE');

  // Inicializar cliente SSE
  if (!clientRef.current) {
    clientRef.current = new RealtimeClient();
  }

  // Manejador de eventos entrantes del stream
  const handleSnapshot = useCallback(
    (snapshot: RealtimeSessionSnapshot) => {
      setSession(snapshot);
      setCurrentSection(snapshot.currentSection);

      if (!isDecoupled) {
        onSyncItemIndex?.(snapshot.currentItemIndex);
        onSyncKeyOverride?.(snapshot.currentKeyOverride);
        onSyncBpmOverride?.(snapshot.currentBpmOverride);
      }
    },
    [isDecoupled, onSyncItemIndex, onSyncKeyOverride, onSyncBpmOverride]
  );

  const handleStateChange = useCallback(
    (event: any) => {
      setSession(event.state);
      setCurrentSection(event.state.currentSection);

      if (!isDecoupled) {
        onSyncItemIndex?.(event.state.currentItemIndex);
        onSyncKeyOverride?.(event.state.currentKeyOverride);
        onSyncBpmOverride?.(event.state.currentBpmOverride);
      }
    },
    [isDecoupled, onSyncItemIndex, onSyncKeyOverride, onSyncBpmOverride]
  );

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    client.setCallbacks({
      onConnectionChange: setConnectionState,
      onSnapshot: handleSnapshot,
      onStateChange: handleStateChange,
      onError: (err) => setError(err.message),
      onConcluded: () => {
        setSession((prev) => (prev ? { ...prev, status: 'CONCLUDED' } : null));
      },
    });
  }, [handleSnapshot, handleStateChange]);

  // Chequeo inicial automático de sesión activa al montar o cambiar de setlist
  useEffect(() => {
    if (!setlistId || !token) {
      setSession(null);
      setConnectionState('DISCONNECTED');
      return;
    }

    let isMounted = true;
    const client = clientRef.current;
    if (!client) return;

    client
      .findActiveSession(setlistId, token)
      .then((activeSession) => {
        if (!isMounted) return;
        if (activeSession) {
          setSession(activeSession);
          client.connect(activeSession.sessionId, token);
        }
      })
      .catch(() => {
        // No hay sesión activa; permanecer en modo local/offline
      });

    return () => {
      isMounted = false;
      client.disconnect();
    };
  }, [setlistId, token]);

  // Acción: Iniciar sesión litúrgica en vivo (Director / Admin)
  const startLiveSession = useCallback(async () => {
    if (!setlistId || !token) return;
    setError(null);

    try {
      const client = clientRef.current!;
      const created = await client.createOrGetSession(setlistId, token, currentIndex);
      setSession(created);
      client.connect(created.sessionId, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión en vivo.');
    }
  }, [setlistId, token, currentIndex]);

  // Acción: Unirse a sesión activa
  const joinLiveSession = useCallback(async () => {
    if (!session || !token) return;
    setError(null);
    try {
      const client = clientRef.current!;
      client.connect(session.sessionId, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al unirse a la sesión.');
    }
  }, [session, token]);

  // Acción: Transmitir cambio de índice de canción (Director)
  const broadcastItemIndex = useCallback(
    async (index: number) => {
      if (!session || !token || !isHost) return;
      try {
        const client = clientRef.current!;
        const actionId = `nav-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await client.dispatchAction(session.sessionId, token, {
          actionId,
          expectedSequence: session.sequence,
          type: 'SET_ITEM_INDEX',
          payload: { itemIndex: index },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al transmitir navegación.');
      }
    },
    [session, token, isHost]
  );

  // Acción: Transmitir sección musical (Verso, Coro, Puente)
  const broadcastSection = useCallback(
    async (section: string | null) => {
      if (!session || !token || !isHost) return;
      try {
        const client = clientRef.current!;
        const actionId = `sec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await client.dispatchAction(session.sessionId, token, {
          actionId,
          expectedSequence: session.sequence,
          type: 'SET_SECTION',
          payload: { section },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al transmitir sección.');
      }
    },
    [session, token, isHost]
  );

  // Acción: Transmitir tonalidad en vivo
  const broadcastKeyOverride = useCallback(
    async (keyOverride: string | null) => {
      if (!session || !token || !isHost) return;
      try {
        const client = clientRef.current!;
        const actionId = `key-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await client.dispatchAction(session.sessionId, token, {
          actionId,
          expectedSequence: session.sequence,
          type: 'SET_KEY_OVERRIDE',
          payload: { keyOverride },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al transmitir tono.');
      }
    },
    [session, token, isHost]
  );

  // Acción: Transmitir tempo en vivo
  const broadcastBpmOverride = useCallback(
    async (bpmOverride: number | null) => {
      if (!session || !token || !isHost) return;
      try {
        const client = clientRef.current!;
        const actionId = `bpm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await client.dispatchAction(session.sessionId, token, {
          actionId,
          expectedSequence: session.sequence,
          type: 'SET_BPM_OVERRIDE',
          payload: { bpmOverride },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al transmitir BPM.');
      }
    },
    [session, token, isHost]
  );

  // Acción: Alternar modo desacoplado / atril independiente
  const toggleDecoupled = useCallback(() => {
    setIsDecoupled((prev) => !prev);
  }, []);

  // Acción: Concluir culto en vivo
  const concludeLiveSession = useCallback(async () => {
    if (!session || !token || !isHost) return;
    try {
      const client = clientRef.current!;
      const actionId = `conclude-${Date.now()}`;
      await client.dispatchAction(session.sessionId, token, {
        actionId,
        expectedSequence: session.sequence,
        type: 'SET_STATUS',
        payload: { status: 'CONCLUDED' },
      });
      client.disconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al concluir culto en vivo.');
    }
  }, [session, token, isHost]);

  return {
    connectionState,
    session,
    isLive,
    isHost,
    isDecoupled,
    currentSection,
    error,
    startLiveSession,
    joinLiveSession,
    broadcastItemIndex,
    broadcastSection,
    broadcastKeyOverride,
    broadcastBpmOverride,
    toggleDecoupled,
    concludeLiveSession,
  };
}
