/**
 * @file worship-service-types.ts
 * @description Tipos, interfaces y contratos de dominio para Cultos y Servicios Litúrgicos (Fase 2C).
 */

export const WorshipServiceStatusEnum = [
  'DRAFT',
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
] as const;

export type WorshipServiceStatus = (typeof WorshipServiceStatusEnum)[number];

export interface WorshipServiceEntity {
  id: string;
  name: string;
  description: string | null;
  serviceType: string;
  scheduledAt: Date;
  worshipLeaderId: string | null;
  worshipLeaderName?: string | null;
  notes: string | null;
  status: WorshipServiceStatus;
  setlistId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorshipServiceWithSetlistEntity extends WorshipServiceEntity {
  setlist?: {
    id: string;
    title: string;
    status: string;
    totalItems: number;
  } | null;
}

export interface WorshipServiceFilterOptions {
  status?: WorshipServiceStatus;
  serviceType?: string;
  timeframe?: 'upcoming' | 'completed' | 'all';
  worshipLeaderId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateWorshipServiceDTO {
  name: string;
  description?: string | null;
  serviceType?: string;
  scheduledAt: Date | string;
  worshipLeaderId?: string | null;
  notes?: string | null;
  status?: WorshipServiceStatus;
  setlistId?: string | null;
}

export interface UpdateWorshipServiceDTO {
  name?: string;
  description?: string | null;
  serviceType?: string;
  scheduledAt?: Date | string;
  worshipLeaderId?: string | null;
  notes?: string | null;
  status?: WorshipServiceStatus;
  setlistId?: string | null;
}

