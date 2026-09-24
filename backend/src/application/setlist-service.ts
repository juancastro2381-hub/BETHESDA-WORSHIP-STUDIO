/**
 * @file setlist-service.ts
 * @description Servicio de aplicación que orquesta la lógica de negocio y casos de uso para Setlists y Momentos Litúrgicos (Fase 2C — WS4).
 *
 * Responsabilidades:
 * - Ciclo de vida y CRUD de Setlists.
 * - Máquina de estados litúrgicos estricta (PLANNING -> ACTIVE -> COMPLETED -> ARCHIVED).
 * - Invariante de negocio: solo UN setlist en estado ACTIVE simultáneamente a nivel global.
 * - Inmutabilidad histórica: elementos de setlists en COMPLETED o ARCHIVED son de solo lectura.
 * - Validación de reglas polimórficas para SONG y SERVICE_MOMENT.
 * - Delegación de persistencia y reordenamiento atómico a ISetlistRepository.
 * - Cero mutaciones en la tabla canónica de canciones (songs / song_versions).
 */

import type {
  CreateSetlistDTO,
  CreateSetlistItemDTO,
  SetlistEntity,
  SetlistFilterOptions,
  SetlistItemWithSongEntity,
  SetlistStatus,
  SetlistSummaryEntity,
  SetlistWithItemsEntity,
  UpdateSetlistDTO,
  UpdateSetlistItemDTO,
} from '../domain/setlist-types.ts';
import type { ISetlistRepository } from '../repositories/setlist-repository.ts';
import type { ISongRepository } from '../repositories/song-repository.ts';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.ts';

/**
 * Matriz estricta de transiciones autorizadas para la máquina de estados litúrgicos.
 * Regla B autorizada:
 * - PLANNING -> ACTIVE, ARCHIVED
 * - ACTIVE -> COMPLETED, PLANNING
 * - COMPLETED -> ARCHIVED
 * - ARCHIVED -> (ninguna transición saliente permitida)
 */
const ALLOWED_STATUS_TRANSITIONS: Record<SetlistStatus, readonly SetlistStatus[]> = {
  PLANNING: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['COMPLETED', 'PLANNING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
} as const;

export class SetlistService {
  public constructor(
    private readonly setlistRepo: ISetlistRepository,
    private readonly songRepo?: ISongRepository
  ) {}

  // ==========================================================================
  // 1. GESTIÓN DE SETLISTS (CRUD)
  // ==========================================================================

  public async createSetlist(dto: CreateSetlistDTO): Promise<SetlistEntity> {
    if (!dto.title || dto.title.trim().length === 0) {
      throw new ValidationError('El título del setlist es obligatorio.');
    }

    const trimmedTitle = dto.title.trim();
    const targetStatus = dto.status ?? 'PLANNING';

    // Si se intenta crear directamente en estado ACTIVE, validar la invariante global única
    if (targetStatus === 'ACTIVE') {
      await this.assertNoOtherActiveSetlist();
    }

    return await this.setlistRepo.create({
      ...dto,
      title: trimmedTitle,
      status: targetStatus,
    });
  }

  public async getSetlist(id: string): Promise<SetlistWithItemsEntity> {
    const setlist = await this.setlistRepo.findById(id);
    if (!setlist) {
      throw new NotFoundError('Setlist', id);
    }
    return setlist;
  }

  public async listSetlists(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }> {
    return await this.setlistRepo.list(filter);
  }

  public async updateSetlist(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity> {
    // Verificar existencia del setlist
    const existing = await this.setlistRepo.findById(id);
    if (!existing) {
      throw new NotFoundError('Setlist', id);
    }

    if (dto.title !== undefined) {
      if (dto.title.trim().length === 0) {
        throw new ValidationError('El título del setlist no puede estar vacío.');
      }
      dto.title = dto.title.trim();
    }

    const updated = await this.setlistRepo.update(id, dto);
    if (!updated) {
      throw new NotFoundError('Setlist', id);
    }
    return updated;
  }

  public async deleteSetlist(id: string): Promise<void> {
    const existing = await this.setlistRepo.findById(id);
    if (!existing) {
      throw new NotFoundError('Setlist', id);
    }

    const deleted = await this.setlistRepo.delete(id);
    if (!deleted) {
      throw new NotFoundError('Setlist', id);
    }
  }

  // ==========================================================================
  // 2. MÁQUINA DE ESTADOS LITÚRGICOS (TRANSICIÓN DE ESTADO)
  // ==========================================================================

  public async transitionStatus(id: string, newStatus: SetlistStatus): Promise<SetlistEntity> {
    const existing = await this.setlistRepo.findById(id);
    if (!existing) {
      throw new NotFoundError('Setlist', id);
    }

    // Regla de Idempotencia: si el setlist ya se encuentra en el estado solicitado, retornar sin mutar
    if (existing.status === newStatus) {
      return {
        id: existing.id,
        title: existing.title,
        scheduledDateTime: existing.scheduledDateTime,
        status: existing.status,
        directorUserId: existing.directorUserId,
        notes: existing.notes,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    // Regla B: Validación estricta de la máquina de estados
    const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new ConflictError(
        `Transición de estado litúrgico no permitida: no se puede cambiar de '${existing.status}' a '${newStatus}'.`
      );
    }

    // Regla A: Invariante de único setlist en estado ACTIVE
    if (newStatus === 'ACTIVE') {
      await this.assertNoOtherActiveSetlist(id);
    }

    const updated = await this.setlistRepo.updateStatus(id, newStatus);
    if (!updated) {
      throw new NotFoundError('Setlist', id);
    }
    return updated;
  }

  // ==========================================================================
  // 3. GESTIÓN POLIMÓRFICA DE ELEMENTOS (SETLIST ITEMS)
  // ==========================================================================

  public async addItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity> {
    const setlist = await this.setlistRepo.findById(setlistId);
    if (!setlist) {
      throw new NotFoundError('Setlist', setlistId);
    }

    // Regla C: Inmutabilidad histórica en estados COMPLETED y ARCHIVED
    this.assertSetlistIsMutable(setlist.status, 'agregar elementos a');

    // Validación polimórfica según tipo de ítem
    if (dto.itemType === 'SONG') {
      if (!dto.songId) {
        throw new ValidationError('El songId es obligatorio para elementos de tipo SONG.');
      }

      // Si se inyectó el repositorio de canciones, verificar existencia
      if (this.songRepo) {
        const song = await this.songRepo.findById(dto.songId);
        if (!song) {
          throw new NotFoundError('Canción', dto.songId);
        }
      }
    } else if (dto.itemType === 'SERVICE_MOMENT') {
      if (dto.songId) {
        throw new ValidationError('Un momento litúrgico no puede referenciar una canción (songId no permitido).');
      }

      if (!dto.momentTitle || dto.momentTitle.trim().length === 0) {
        throw new ValidationError('El título del momento litúrgico es obligatorio.');
      }
      dto.momentTitle = dto.momentTitle.trim();
    } else {
      throw new ValidationError("El tipo de ítem debe ser 'SONG' o 'SERVICE_MOMENT'.");
    }

    return await this.setlistRepo.createItem(setlistId, dto);
  }

  public async updateItem(
    setlistId: string,
    itemId: string,
    dto: UpdateSetlistItemDTO
  ): Promise<SetlistItemWithSongEntity> {
    const setlist = await this.setlistRepo.findById(setlistId);
    if (!setlist) {
      throw new NotFoundError('Setlist', setlistId);
    }

    // Regla C: Inmutabilidad histórica en estados COMPLETED y ARCHIVED
    this.assertSetlistIsMutable(setlist.status, 'modificar elementos de');

    const existingItem = setlist.items.find((item) => item.id === itemId);
    if (!existingItem) {
      throw new NotFoundError('Elemento de setlist', itemId);
    }

    if (existingItem.itemType === 'SERVICE_MOMENT' && dto.momentTitle !== undefined) {
      if (!dto.momentTitle || dto.momentTitle.trim().length === 0) {
        throw new ValidationError('El título del momento litúrgico no puede estar vacío.');
      }
      dto.momentTitle = dto.momentTitle.trim();
    }

    const updated = await this.setlistRepo.updateItem(setlistId, itemId, dto);
    if (!updated) {
      throw new NotFoundError('Elemento de setlist', itemId);
    }
    return updated;
  }

  public async removeItem(setlistId: string, itemId: string): Promise<void> {
    const setlist = await this.setlistRepo.findById(setlistId);
    if (!setlist) {
      throw new NotFoundError('Setlist', setlistId);
    }

    // Regla C: Inmutabilidad histórica en estados COMPLETED y ARCHIVED
    this.assertSetlistIsMutable(setlist.status, 'eliminar elementos de');

    const existingItem = setlist.items.find((item) => item.id === itemId);
    if (!existingItem) {
      throw new NotFoundError('Elemento de setlist', itemId);
    }

    const deleted = await this.setlistRepo.deleteItem(setlistId, itemId);
    if (!deleted) {
      throw new NotFoundError('Elemento de setlist', itemId);
    }
  }

  // ==========================================================================
  // 4. REORDENAMIENTO LITÚRGICO
  // ==========================================================================

  public async reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]> {
    const setlist = await this.setlistRepo.findById(setlistId);
    if (!setlist) {
      throw new NotFoundError('Setlist', setlistId);
    }

    // Regla C: Inmutabilidad histórica en estados COMPLETED y ARCHIVED
    this.assertSetlistIsMutable(setlist.status, 'reordenar elementos de');

    if (!itemIds || itemIds.length === 0) {
      throw new ValidationError('La lista de reordenamiento no puede estar vacía.');
    }

    if (new Set(itemIds).size !== itemIds.length) {
      throw new ValidationError('La lista de reordenamiento no puede contener identificadores duplicados.');
    }

    if (itemIds.length !== setlist.items.length) {
      throw new ValidationError(
        `La cantidad de identificadores (${itemIds.length}) no coincide con los elementos del setlist (${setlist.items.length}).`
      );
    }

    const existingIdSet = new Set(setlist.items.map((i) => i.id));
    for (const id of itemIds) {
      if (!existingIdSet.has(id)) {
        throw new ValidationError(
          `El ítem con identificador '${id}' no pertenece al setlist '${setlistId}'.`
        );
      }
    }

    return await this.setlistRepo.reorderItems(setlistId, itemIds);
  }

  // ==========================================================================
  // HELPERS PRIVADOS DE DOMINIO Y REGLAS DE NEGOCIO
  // ==========================================================================

  /**
   * Garantiza la Regla A: solo puede haber un setlist en estado ACTIVE simultáneamente.
   * Si ya existe otro setlist activo, rechaza la operación con ConflictError.
   */
  private async assertNoOtherActiveSetlist(excludeId?: string): Promise<void> {
    const activeList = await this.setlistRepo.list({ status: 'ACTIVE', limit: 5 });
    const currentActive = activeList.items.find((item) => item.id !== excludeId);

    if (currentActive) {
      throw new ConflictError(
        `Ya existe un setlist en estado ACTIVE ('${currentActive.title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.`
      );
    }
  }

  /**
   * Garantiza la Regla C: inmutabilidad histórica de setlists en COMPLETED o ARCHIVED.
   */
  private assertSetlistIsMutable(status: SetlistStatus, actionDescription: string): void {
    if (status === 'COMPLETED' || status === 'ARCHIVED') {
      throw new ConflictError(
        `No se pueden ${actionDescription} un setlist en estado ${status}.`
      );
    }
  }
}
