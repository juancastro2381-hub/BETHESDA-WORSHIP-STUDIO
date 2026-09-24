/**
 * @file audit-service.ts
 * @description Servicio de aplicación para auditoría de seguridad y gobernanza (Fase 2B).
 */

import type { IAuditLogRepository, CreateAuditLogInput } from '../repositories/audit-repository.ts';

export interface IAuditService {
  log(event: CreateAuditLogInput): Promise<void>;
}

export class AuditService implements IAuditService {
  public constructor(private readonly auditRepo: IAuditLogRepository) {}

  public async log(event: CreateAuditLogInput): Promise<void> {
    try {
      await this.auditRepo.create(event);
    } catch (err) {
      // La auditoría no debe detener la transacción principal si falla por I/O, pero debe registrarse el error
      console.error('⚠️ Error al registrar evento de auditoría:', err);
    }
  }
}
