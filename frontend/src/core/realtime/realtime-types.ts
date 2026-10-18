/**
 * @file realtime-types.ts
 * @description Tipos de datos para el Flujo Litúrgico en Tiempo Real (Fase 3B) en el cliente frontend.
 */

export type RealtimeSessionStatus = 'ACTIVE' | 'PAUSED' | 'CONCLUDED';

export type RealtimeActionType =
  | 'SET_ITEM_INDEX'
  | 'SET_SECTION'
  | 'SET_KEY_OVERRIDE'
  | 'SET_BPM_OVERRIDE'
  | 'SET_STATUS';

export interface RealtimeActionPayload {
  itemIndex?: number;
  section?: string | null;
  keyOverride?: string | null;
  bpmOverride?: number | null;
  status?: RealtimeSessionStatus;
}

export interface RealtimeAction {
  actionId: string;
  expectedSequence?: number;
  type: RealtimeActionType;
  payload: RealtimeActionPayload;
}

export interface ParticipantState {
  userId: string;
  name: string;
  role: string;
  lastSeenAt: string;
  isHost: boolean;
}

export interface RealtimeSessionSnapshot {
  sessionId: string;
  setlistId: string;
  setlistTitle: string;
  hostUserId: string;
  status: RealtimeSessionStatus;
  epoch: number;
  sequence: number;
  currentItemIndex: number;
  currentSection: string | null;
  currentKeyOverride: string | null;
  currentBpmOverride: number | null;
  participantsCount: number;
  participants: ParticipantState[];
  lastActivityAt: string;
}

export type RealtimeEventType =
  | 'SESSION_SNAPSHOT'
  | 'STATE_CHANGED'
  | 'PARTICIPANT_JOINED'
  | 'PARTICIPANT_LEFT'
  | 'HEARTBEAT'
  | 'SESSION_CONCLUDED';

export interface RealtimeEvent {
  eventId: string;
  sessionId: string;
  type: RealtimeEventType;
  epoch: number;
  sequence: number;
  timestamp: string;
  state: RealtimeSessionSnapshot;
  action?: {
    actionId: string;
    type: RealtimeActionType;
    performedBy: string;
  };
}

export type RealtimeConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';
