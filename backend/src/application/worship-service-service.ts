/**
 * @file worship-service-service.ts
 * @description Servicio de aplicación para la gestión litúrgica de Cultos y Servicios (Fase 2C).
 */

import type {
  CreateWorshipServiceDTO,
  UpdateWorshipServiceDTO,
  WorshipServiceFilterOptions,
  WorshipServiceStatus,
  WorshipServiceWithSetlistEntity,
} from '../domain/worship-service-types.ts';
import type { IWorshipServiceRepository } from '../repositories/worship-service-repository.ts';
import type { ISetlistRepository } from '../repositories/setlist-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';

export class WorshipServiceService {
  public constructor(
    private readonly serviceRepo: IWorshipServiceRepository,
    private readonly setlistRepo?: ISetlistRepository
  ) {}

  public async createService(dto: CreateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity> {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new ValidationError('El nombre del culto o servicio es obligatorio.');
    }

    if (!dto.scheduledAt) {
      throw new ValidationError('La fecha y hora programada es obligatoria.');
    }

    const scheduledDate = dto.scheduledAt instanceof Date ? dto.scheduledAt : new Date(dto.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new ValidationError('La fecha y hora programada es inválida.');
    }

    if (dto.setlistId && this.setlistRepo) {
      const setlist = await this.setlistRepo.findById(dto.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist', dto.setlistId);
      }
    }

    return await this.serviceRepo.create({
      ...dto,
      name: dto.name.trim(),
      serviceType: dto.serviceType?.trim() || 'Culto General',
      scheduledAt: scheduledDate,
    });
  }

  public async getService(id: string): Promise<WorshipServiceWithSetlistEntity> {
    const service = await this.serviceRepo.findById(id);
    if (!service) {
      throw new NotFoundError('Servicio Litúrgico', id);
    }
    return service;
  }

  public async listServices(filter?: WorshipServiceFilterOptions): Promise<{ items: WorshipServiceWithSetlistEntity[]; total: number }> {
    return await this.serviceRepo.list(filter);
  }

  public async updateService(id: string, dto: UpdateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity> {
    const existing = await this.serviceRepo.findById(id);
    if (!existing) {
      throw new NotFoundError('Servicio Litúrgico', id);
    }

    if (dto.name !== undefined) {
      if (dto.name.trim().length === 0) {
        throw new ValidationError('El nombre del servicio no puede estar vacío.');
      }
      dto.name = dto.name.trim();
    }

    if (dto.scheduledAt !== undefined) {
      const scheduledDate = dto.scheduledAt instanceof Date ? dto.scheduledAt : new Date(dto.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        throw new ValidationError('La fecha y hora programada es inválida.');
      }
      dto.scheduledAt = scheduledDate;
    }

    if (dto.setlistId !== undefined && dto.setlistId !== null && this.setlistRepo) {
      const setlist = await this.setlistRepo.findById(dto.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist', dto.setlistId);
      }
    }

    const updated = await this.serviceRepo.update(id, dto);
    if (!updated) {
      throw new NotFoundError('Servicio Litúrgico', id);
    }
    return updated;
  }

  public async deleteService(id: string): Promise<void> {
    const existing = await this.serviceRepo.findById(id);
    if (!existing) {
      throw new NotFoundError('Servicio Litúrgico', id);
    }

    const deleted = await this.serviceRepo.delete(id);
    if (!deleted) {
      throw new NotFoundError('Servicio Litúrgico', id);
    }
  }

  public async transitionStatus(id: string, status: WorshipServiceStatus): Promise<WorshipServiceWithSetlistEntity> {
    return await this.updateService(id, { status });
  }
}

