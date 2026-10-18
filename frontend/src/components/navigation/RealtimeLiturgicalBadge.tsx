/**
 * @file RealtimeLiturgicalBadge.tsx
 * @description Indicador de estado y barra de control litúrgico en tiempo real (Fase 3B).
 *
 * Muestra el estado de sincronización del atril (Director vs Músico), la sección
 * musical activa (Coro, Verso, Puente) y permite el desacoplamiento temporal.
 */

import React from 'react';
import type { UseRealtimeFlowReturn } from '../../core/realtime/use-realtime-flow.ts';

export interface RealtimeLiturgicalBadgeProps {
  realtime: UseRealtimeFlowReturn;
  userRole?: string | null;
}

const COMMON_SECTIONS = [
  'INTRO',
  'VERSO 1',
  'VERSO 2',
  'PRE-CORO',
  'CORO',
  'PUENTE',
  'SOLO / INSTRUMENTAL',
  'MINISTRACIÓN',
  'ESPONTÁNEO',
  'OUTRO',
];

export const RealtimeLiturgicalBadge: React.FC<RealtimeLiturgicalBadgeProps> = ({
  realtime,
  userRole,
}) => {
  const {
    connectionState,
    session,
    isLive,
    isHost,
    isDecoupled,
    currentSection,
    startLiveSession,
    broadcastSection,
    toggleDecoupled,
    concludeLiveSession,
  } = realtime;

  const isLeaderRole =
    userRole === 'WORSHIP_LEADER' || userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

  // Si no hay sesión en vivo y el usuario no tiene permisos de líder, no mostrar nada
  if (!isLive && !isLeaderRole) {
    return null;
  }

  // 1. Estado: No hay sesión en vivo, pero el usuario es líder -> Botón para iniciar
  if (!isLive && isLeaderRole) {
    return (
      <div className="realtime-badge-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={() => void startLiveSession()}
          className="btn-realtime-start"
          title="Iniciar sincronización de atril en vivo para toda la congregación"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: 'var(--color-primary-dark, #1e3a8a)',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '10px', color: '#60a5fa' }}>📡</span>
          <span>Iniciar Culto en Vivo</span>
        </button>
      </div>
    );
  }

  // 2. Estado: Sesión en vivo activa
  return (
    <div
      className="realtime-badge-container"
      role="region"
      aria-label="Panel de sincronización litúrgica en vivo"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        background: isHost ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
        border: `1px solid ${isHost ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
        borderRadius: '6px',
        fontSize: '0.8125rem',
      }}
    >
      {/* Indicador de estado */}
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isDecoupled ? '#eab308' : isHost ? '#ef4444' : '#22c55e',
          boxShadow: `0 0 6px ${isDecoupled ? '#eab308' : isHost ? '#ef4444' : '#22c55e'}`,
        }}
      />

      <span style={{ fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
        {isHost
          ? '🔴 EN VIVO (DIRECTOR)'
          : isDecoupled
          ? '🟡 ATRIL INDEPENDIENTE'
          : '🟢 EN VIVO (SINCRONIZADO)'}
      </span>

      {/* Participantes conectados */}
      {session && (
        <span
          title="Participantes conectados"
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted, #94a3b8)',
            background: 'rgba(0,0,0,0.2)',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          👥 {session.participantsCount}
        </span>
      )}

      {/* Sección activa actual */}
      {currentSection && (
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#38bdf8',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            padding: '2px 8px',
            borderRadius: '4px',
            letterSpacing: '0.5px',
          }}
        >
          {currentSection}
        </span>
      )}

      {/* Selector de sección musical para el Director */}
      {isHost && (
        <select
          value={currentSection || ''}
          onChange={(e) => void broadcastSection(e.target.value || null)}
          aria-label="Transmitir sección musical a los atriles"
          style={{
            background: 'rgba(0,0,0,0.4)',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          <option value="">(Sin sección)</option>
          {COMMON_SECTIONS.map((sec) => (
            <option key={sec} value={sec}>
              {sec}
            </option>
          ))}
        </select>
      )}

      {/* Botón de desacoplamiento para músicos */}
      {!isHost && isLive && (
        <button
          type="button"
          onClick={toggleDecoupled}
          style={{
            background: isDecoupled ? '#15803d' : 'transparent',
            color: isDecoupled ? '#ffffff' : 'var(--text-muted, #94a3b8)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          {isDecoupled ? 'Sincronizar' : 'Desvincular'}
        </button>
      )}

      {/* Botón para finalizar sesión en vivo (Director) */}
      {isHost && (
        <button
          type="button"
          onClick={() => void concludeLiveSession()}
          title="Concluir culto en vivo"
          style={{
            background: 'transparent',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Finalizar
        </button>
      )}
    </div>
  );
};
