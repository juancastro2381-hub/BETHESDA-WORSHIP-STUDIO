/**
 * @file setlist-service.test.ts
 * @description Suite exhaustiva de pruebas unitarias y de integración para SetlistService (Fase 2C — WS4).
 * Valida reglas de negocio: máquina de estados, único setlist ACTIVE, inmutabilidad de finalizados,
 * validaciones polimórficas de SONG y SERVICE_MOMENT, y delegación a la capa de persistencia.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SetlistService } from '../application/setlist-service.ts';
import type { ISetlistRepository } from '../repositories/setlist-repository.ts';
import type { ISongRepository } from '../repositories/song-repository.ts';
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
import type { SongEntity } from '../domain/types.ts';
import { ConflictError, NotFoundError, PersistenceError, ValidationError } from '../domain/errors.ts';

/**
 * Mock en memoria de ISetlistRepository para pruebas unitarias deterministas y aisladas.
 */
class InMemorySetlistRepository implements ISetlistRepository {
  public setlists = new Map<string, SetlistEntity>();
  public items = new Map<string, SetlistItemWithSongEntity[]>();
  public shouldFailWithPersistenceError = false;

  public async list(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }> {
    if (this.shouldFailWithPersistenceError) {
      throw new PersistenceError('Database timeout during list query');
    }

    let all = Array.from(this.setlists.values());
    if (filter?.status) {
      all = all.filter((s) => s.status === filter.status);
    }

    const total = all.length;
    const summaries: SetlistSummaryEntity[] = all.map((s) => {
      const setlistItems = this.items.get(s.id) ?? [];
      return {
        id: s.id,
        title: s.title,
        scheduledDateTime: s.scheduledDateTime,
        status: s.status,
        directorUserId: s.directorUserId,
        directorName: s.directorUserId ? 'Director Test' : undefined,
        totalItems: setlistItems.length,
        totalSongs: setlistItems.filter((i) => i.itemType === 'SONG').length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    return { items: summaries, total };
  }

  public async findById(id: string): Promise<SetlistWithItemsEntity | null> {
    if (this.shouldFailWithPersistenceError) {
      throw new PersistenceError('Database connection error');
    }

    const setlist = this.setlists.get(id);
    if (!setlist) return null;

    const setlistItems = this.items.get(id) ?? [];
    return {
      ...setlist,
      directorName: setlist.directorUserId ? 'Director Test' : null,
      items: [...setlistItems],
    };
  }

  public async create(dto: CreateSetlistDTO): Promise<SetlistEntity> {
    const id = `setlist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    const entity: SetlistEntity = {
      id,
      title: dto.title,
      scheduledDateTime: dto.scheduledDateTime ? new Date(dto.scheduledDateTime) : null,
      status: dto.status ?? 'PLANNING',
      directorUserId: dto.directorUserId ?? null,
      notes: dto.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.setlists.set(id, entity);
    this.items.set(id, []);
    return entity;
  }

  public async update(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity | null> {
    const setlist = this.setlists.get(id);
    if (!setlist) return null;

    const updated: SetlistEntity = {
      ...setlist,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.scheduledDateTime !== undefined
        ? { scheduledDateTime: dto.scheduledDateTime ? new Date(dto.scheduledDateTime) : null }
        : {}),
      ...(dto.directorUserId !== undefined ? { directorUserId: dto.directorUserId } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      updatedAt: new Date(),
    };
    this.setlists.set(id, updated);
    return updated;
  }

  public async updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null> {
    const setlist = this.setlists.get(id);
    if (!setlist) return null;

    const updated: SetlistEntity = {
      ...setlist,
      status,
      updatedAt: new Date(),
    };
    this.setlists.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    if (!this.setlists.has(id)) return false;
    this.setlists.delete(id);
    this.items.delete(id);
    return true;
  }

  public async listItemsBySetlist(setlistId: string): Promise<SetlistItemWithSongEntity[]> {
    return [...(this.items.get(setlistId) ?? [])];
  }

  public async findItemById(itemId: string): Promise<SetlistItemWithSongEntity | null> {
    for (const setlistItems of this.items.values()) {
      const found = setlistItems.find((i) => i.id === itemId);
      if (found) return found;
    }
    return null;
  }

  public async createItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity> {
    const current = this.items.get(setlistId) ?? [];
    const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    const item: SetlistItemWithSongEntity = {
      id,
      setlistId,
      sequenceOrder: dto.sequenceOrder ?? current.length + 1,
      itemType: dto.itemType,
      songId: dto.itemType === 'SONG' ? dto.songId ?? null : null,
      targetKey: dto.targetKey ?? null,
      targetBpm: dto.targetBpm ?? null,
      transitionType: dto.transitionType ?? 'STOP',
      momentTitle: dto.itemType === 'SERVICE_MOMENT' ? dto.momentTitle ?? null : null,
      durationMinutes: dto.itemType === 'SERVICE_MOMENT' ? dto.durationMinutes ?? null : null,
      musicalKey: dto.itemType === 'SERVICE_MOMENT' ? dto.musicalKey ?? null : null,
      notesForTeam: dto.notesForTeam ?? null,
      createdAt: now,
      updatedAt: now,
      song: dto.itemType === 'SONG' && dto.songId ? {
        id: dto.songId,
        title: 'Canción Canónica de Prueba',
        artist: 'Artista Ficticio',
        defaultKey: 'G',
        defaultBpm: 120,
        timeSignature: '4/4',
        status: 'APPROVED',
      } : null,
    };
    current.push(item);
    this.items.set(setlistId, current);
    return item;
  }

  public async updateItem(
    setlistId: string,
    itemId: string,
    dto: UpdateSetlistItemDTO
  ): Promise<SetlistItemWithSongEntity | null> {
    const current = this.items.get(setlistId) ?? [];
    const index = current.findIndex((i) => i.id === itemId);
    if (index === -1) return null;

    const existing = current[index]!;
    const updated: SetlistItemWithSongEntity = {
      ...existing,
      ...(dto.targetKey !== undefined ? { targetKey: dto.targetKey } : {}),
      ...(dto.targetBpm !== undefined ? { targetBpm: dto.targetBpm } : {}),
      ...(dto.transitionType !== undefined ? { transitionType: dto.transitionType } : {}),
      ...(dto.momentTitle !== undefined ? { momentTitle: dto.momentTitle } : {}),
      ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
      ...(dto.musicalKey !== undefined ? { musicalKey: dto.musicalKey } : {}),
      ...(dto.notesForTeam !== undefined ? { notesForTeam: dto.notesForTeam } : {}),
      updatedAt: new Date(),
    };
    current[index] = updated;
    this.items.set(setlistId, current);
    return updated;
  }

  public async deleteItem(setlistId: string, itemId: string): Promise<boolean> {
    const current = this.items.get(setlistId) ?? [];
    const filtered = current.filter((i) => i.id !== itemId);
    if (filtered.length === current.length) return false;

    // Compactar secuencias
    filtered.forEach((it, idx) => {
      it.sequenceOrder = idx + 1;
    });
    this.items.set(setlistId, filtered);
    return true;
  }

  public async reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]> {
    const current = this.items.get(setlistId) ?? [];
    const reordered: SetlistItemWithSongEntity[] = [];

    for (let i = 0; i < itemIds.length; i++) {
      const id = itemIds[i]!;
      const item = current.find((it) => it.id === id);
      if (item) {
        item.sequenceOrder = i + 1;
        reordered.push(item);
      }
    }

    this.items.set(setlistId, reordered);
    return reordered;
  }
}

/**
 * Mock en memoria de ISongRepository.
 */
class InMemorySongRepository implements ISongRepository {
  public songs = new Map<string, SongEntity>();

  public async findById(id: string): Promise<SongEntity | null> {
    return this.songs.get(id) ?? null;
  }

  public async findWithCurrentVersion(_id: string): Promise<any> {
    return null;
  }

  public async list(_params?: any): Promise<any> {
    return { items: [], total: 0 };
  }

  public async create(_dto: any): Promise<any> {
    throw new Error('Not implemented in mock');
  }

  public async updateStatus(_id: string, _status: any): Promise<any> {
    return null;
  }

  public async delete(_id: string): Promise<boolean> {
    return false;
  }
}

describe('Phase 2C — WS4: SetlistService Business Logic Tests', () => {
  let setlistRepo: InMemorySetlistRepository;
  let songRepo: InMemorySongRepository;
  let service: SetlistService;

  const validSongId = '00000000-0000-4000-8000-000000000001';

  beforeEach: () => {
    // Configuración limpia por prueba
  };

  function setup() {
    setlistRepo = new InMemorySetlistRepository();
    songRepo = new InMemorySongRepository();
    songRepo.songs.set(validSongId, {
      id: validSongId,
      title: 'Gracia Sublime Es Tu Amor',
      artist: 'En Espiritu y En Verdad',
      ccliNumber: '123456',
      defaultKey: 'G',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED',
      currentVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    service = new SetlistService(setlistRepo, songRepo);
  }

  // ==========================================================================
  // 1. SETLIST CRUD OPERATIONS
  // ==========================================================================

  describe('1. Setlist CRUD Operations', () => {
    it('1.1 should create a setlist with title and default PLANNING status', async () => {
      setup();
      const setlist = await service.createSetlist({
        title: 'Culto de Adoración Dominical',
        notes: 'Celebración y alabanza',
      });

      assert.ok(setlist.id);
      assert.strictEqual(setlist.title, 'Culto de Adoración Dominical');
      assert.strictEqual(setlist.status, 'PLANNING');
      assert.strictEqual(setlist.notes, 'Celebración y alabanza');
    });

    it('1.2 should reject setlist creation with empty or whitespace-only title', async () => {
      setup();
      await assert.rejects(
        async () => {
          await service.createSetlist({ title: '   ' });
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('título')
      );
    });

    it('1.3 should reject creating directly as ACTIVE if another setlist is already ACTIVE', async () => {
      setup();
      // Crear primero un setlist ACTIVE
      await service.createSetlist({ title: 'Culto Matutino', status: 'ACTIVE' });

      // Intentar crear un segundo setlist directamente en ACTIVE
      await assert.rejects(
        async () => {
          await service.createSetlist({ title: 'Culto Vespertino', status: 'ACTIVE' });
        },
        (err: unknown) =>
          err instanceof ConflictError && err.message.includes('Ya existe un setlist en estado ACTIVE')
      );
    });

    it('1.4 should retrieve an existing setlist with items via getSetlist', async () => {
      setup();
      const created = await service.createSetlist({ title: 'Culto Miércoles' });
      const retrieved = await service.getSetlist(created.id);

      assert.strictEqual(retrieved.id, created.id);
      assert.strictEqual(retrieved.title, 'Culto Miércoles');
      assert.deepStrictEqual(retrieved.items, []);
    });

    it('1.5 should throw NotFoundError when getSetlist target does not exist', async () => {
      setup();
      await assert.rejects(
        async () => {
          await service.getSetlist('non-existent-id');
        },
        (err: unknown) => err instanceof NotFoundError
      );
    });

    it('1.6 should list setlists with pagination through listSetlists', async () => {
      setup();
      await service.createSetlist({ title: 'Setlist 1' });
      await service.createSetlist({ title: 'Setlist 2' });

      const result = await service.listSetlists();
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.items.length, 2);
    });

    it('1.7 should update setlist title and notes via updateSetlist', async () => {
      setup();
      const created = await service.createSetlist({ title: 'Título Inicial' });
      const updated = await service.updateSetlist(created.id, {
        title: 'Título Corregido',
        notes: 'Notas actualizadas',
      });

      assert.strictEqual(updated.title, 'Título Corregido');
      assert.strictEqual(updated.notes, 'Notas actualizadas');
    });

    it('1.8 should reject updating setlist with empty title', async () => {
      setup();
      const created = await service.createSetlist({ title: 'Setlist Válido' });
      await assert.rejects(
        async () => {
          await service.updateSetlist(created.id, { title: '' });
        },
        (err: unknown) => err instanceof ValidationError
      );
    });

    it('1.9 should delete an existing setlist via deleteSetlist', async () => {
      setup();
      const created = await service.createSetlist({ title: 'Para Eliminar' });
      await service.deleteSetlist(created.id);

      await assert.rejects(
        async () => {
          await service.getSetlist(created.id);
        },
        (err: unknown) => err instanceof NotFoundError
      );
    });

    it('1.10 should throw NotFoundError when attempting to delete a non-existent setlist', async () => {
      setup();
      await assert.rejects(
        async () => {
          await service.deleteSetlist('id-fantasma');
        },
        (err: unknown) => err instanceof NotFoundError
      );
    });
  });

  // ==========================================================================
  // 2. STATE MACHINE & SINGLE ACTIVE INVARIANT
  // ==========================================================================

  describe('2. State Machine & Single ACTIVE Invariant', () => {
    it('2.1 should allow PLANNING -> ACTIVE when no other setlist is ACTIVE', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Especial' });
      const activated = await service.transitionStatus(setlist.id, 'ACTIVE');

      assert.strictEqual(activated.status, 'ACTIVE');
    });

    it('2.2 should REJECT PLANNING -> ACTIVE when another setlist is already ACTIVE (Rule A)', async () => {
      setup();
      const setlistA = await service.createSetlist({ title: 'Culto Mañana' });
      await service.transitionStatus(setlistA.id, 'ACTIVE');

      const setlistB = await service.createSetlist({ title: 'Culto Noche' });
      await assert.rejects(
        async () => {
          await service.transitionStatus(setlistB.id, 'ACTIVE');
        },
        (err: unknown) =>
          err instanceof ConflictError &&
          err.message.includes('Ya existe un setlist en estado ACTIVE') &&
          err.message.includes('Culto Mañana')
      );

      // Verificar que setlistB sigue en PLANNING y setlistA sigue en ACTIVE
      const checkB = await service.getSetlist(setlistB.id);
      assert.strictEqual(checkB.status, 'PLANNING');
      const checkA = await service.getSetlist(setlistA.id);
      assert.strictEqual(checkA.status, 'ACTIVE');
    });

    it('2.3 should allow ACTIVE -> COMPLETED (natural conclusion of service)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto en Curso' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      const completed = await service.transitionStatus(setlist.id, 'COMPLETED');

      assert.strictEqual(completed.status, 'COMPLETED');
    });

    it('2.4 should allow ACTIVE -> PLANNING (revert to draft if activated by mistake)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto de Ensayo' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      const reverted = await service.transitionStatus(setlist.id, 'PLANNING');

      assert.strictEqual(reverted.status, 'PLANNING');
    });

    it('2.5 should allow COMPLETED -> ARCHIVED (historical archiving)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Pasado' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      await service.transitionStatus(setlist.id, 'COMPLETED');
      const archived = await service.transitionStatus(setlist.id, 'ARCHIVED');

      assert.strictEqual(archived.status, 'ARCHIVED');
    });

    it('2.6 should allow PLANNING -> ARCHIVED (direct cancellation)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Cancelado' });
      const archived = await service.transitionStatus(setlist.id, 'ARCHIVED');

      assert.strictEqual(archived.status, 'ARCHIVED');
    });

    it('2.7 should REJECT COMPLETED -> ACTIVE (cannot reactivate completed service)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Terminado' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      await service.transitionStatus(setlist.id, 'COMPLETED');

      await assert.rejects(
        async () => {
          await service.transitionStatus(setlist.id, 'ACTIVE');
        },
        (err: unknown) =>
          err instanceof ConflictError &&
          err.message.includes("no se puede cambiar de 'COMPLETED' a 'ACTIVE'")
      );
    });

    it('2.8 should REJECT ARCHIVED -> PLANNING (unsupported unarchiving)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto en Archivo' });
      await service.transitionStatus(setlist.id, 'ARCHIVED');

      await assert.rejects(
        async () => {
          await service.transitionStatus(setlist.id, 'PLANNING');
        },
        (err: unknown) =>
          err instanceof ConflictError &&
          err.message.includes("no se puede cambiar de 'ARCHIVED' a 'PLANNING'")
      );
    });

    it('2.9 should be IDEMPOTENT for same-state transitions (no error, returns entity)', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Idempotente' });

      // PLANNING -> PLANNING
      const r1 = await service.transitionStatus(setlist.id, 'PLANNING');
      assert.strictEqual(r1.status, 'PLANNING');

      // ACTIVE -> ACTIVE
      await service.transitionStatus(setlist.id, 'ACTIVE');
      const r2 = await service.transitionStatus(setlist.id, 'ACTIVE');
      assert.strictEqual(r2.status, 'ACTIVE');

      // COMPLETED -> COMPLETED
      await service.transitionStatus(setlist.id, 'COMPLETED');
      const r3 = await service.transitionStatus(setlist.id, 'COMPLETED');
      assert.strictEqual(r3.status, 'COMPLETED');

      // ARCHIVED -> ARCHIVED
      await service.transitionStatus(setlist.id, 'ARCHIVED');
      const r4 = await service.transitionStatus(setlist.id, 'ARCHIVED');
      assert.strictEqual(r4.status, 'ARCHIVED');
    });
  });

  // ==========================================================================
  // 3. POLYMORPHIC ITEM CREATION & VALIDATION
  // ==========================================================================

  describe('3. Polymorphic Item Creation & Validation', () => {
    it('3.1 should create a SONG item with valid songId and transition', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist con Canción' });
      const item = await service.addItem(setlist.id, {
        itemType: 'SONG',
        songId: validSongId,
        targetKey: 'E',
        targetBpm: 130,
        transitionType: 'CROSSFADE',
        notesForTeam: 'Iniciar con pad y guitarra acústica',
      });

      assert.ok(item.id);
      assert.strictEqual(item.itemType, 'SONG');
      assert.strictEqual(item.songId, validSongId);
      assert.strictEqual(item.targetKey, 'E');
      assert.strictEqual(item.targetBpm, 130);
      assert.strictEqual(item.transitionType, 'CROSSFADE');
      assert.ok(item.song);
    });

    it('3.2 should reject SONG item with missing songId', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Test' });
      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SONG',
            songId: undefined,
          });
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('songId')
      );
    });

    it('3.3 should reject SONG item when referenced songId does not exist in songs repository', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Test' });
      const missingSongId = '00000000-0000-4000-8000-000000000999';

      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SONG',
            songId: missingSongId,
          });
        },
        (err: unknown) => err instanceof NotFoundError && err.message.includes('Canción')
      );
    });

    it('3.4 should create a SERVICE_MOMENT item with title, duration, and pad musicalKey', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist con Momento' });
      const moment = await service.addItem(setlist.id, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Tiempo de Ministración y Oración',
        durationMinutes: 8,
        musicalKey: 'D Minor',
        notesForTeam: 'Pad constante en Dm; teclado acompaña arpegios suaves',
      });

      assert.ok(moment.id);
      assert.strictEqual(moment.itemType, 'SERVICE_MOMENT');
      assert.strictEqual(moment.momentTitle, 'Tiempo de Ministración y Oración');
      assert.strictEqual(moment.durationMinutes, 8);
      assert.strictEqual(moment.musicalKey, 'D Minor');
      assert.strictEqual(moment.songId, null);
    });

    it('3.5 should reject SERVICE_MOMENT item with empty or missing momentTitle', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Test' });
      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SERVICE_MOMENT',
            momentTitle: '   ',
          });
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('momento litúrgico')
      );
    });

    it('3.6 should reject SERVICE_MOMENT item if songId is provided', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Test' });
      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SERVICE_MOMENT',
            momentTitle: 'Oración',
            songId: validSongId,
          });
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('songId no permitido')
      );
    });

    it('3.7 should reject unrecognized itemType', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Test' });
      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'INVALID_TYPE' as any,
          });
        },
        (err: unknown) => err instanceof ValidationError
      );
    });
  });

  // ==========================================================================
  // 4. FINALIZED SETLIST IMMUTABILITY (COMPLETED & ARCHIVED)
  // ==========================================================================

  describe('4. Finalized Setlist Immutability (Rule C)', () => {
    it('4.1 should reject addItem on COMPLETED setlist with ConflictError', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Concluido' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      await service.transitionStatus(setlist.id, 'COMPLETED');

      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SERVICE_MOMENT',
            momentTitle: 'Intento Post-Culto',
          });
        },
        (err: unknown) =>
          err instanceof ConflictError &&
          err.message.includes('No se pueden agregar elementos a un setlist en estado COMPLETED')
      );
    });

    it('4.2 should reject addItem on ARCHIVED setlist with ConflictError', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Archivado' });
      await service.transitionStatus(setlist.id, 'ARCHIVED');

      await assert.rejects(
        async () => {
          await service.addItem(setlist.id, {
            itemType: 'SONG',
            songId: validSongId,
          });
        },
        (err: unknown) =>
          err instanceof ConflictError &&
          err.message.includes('No se pueden agregar elementos a un setlist en estado ARCHIVED')
      );
    });

    it('4.3 should reject updateItem on COMPLETED or ARCHIVED setlist', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto con Ítem' });
      const item = await service.addItem(setlist.id, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Momento Original',
      });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      await service.transitionStatus(setlist.id, 'COMPLETED');

      await assert.rejects(
        async () => {
          await service.updateItem(setlist.id, item.id, { momentTitle: 'Intento Modificar' });
        },
        (err: unknown) =>
          err instanceof ConflictError && err.message.includes('No se pueden modificar elementos')
      );
    });

    it('4.4 should reject removeItem on COMPLETED or ARCHIVED setlist', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto para Archivar' });
      const item = await service.addItem(setlist.id, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Momento Litúrgico',
      });
      await service.transitionStatus(setlist.id, 'ARCHIVED');

      await assert.rejects(
        async () => {
          await service.removeItem(setlist.id, item.id);
        },
        (err: unknown) =>
          err instanceof ConflictError && err.message.includes('No se pueden eliminar elementos')
      );
    });

    it('4.5 should reject reorderItems on COMPLETED or ARCHIVED setlist', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto Histórico' });
      const itemA = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: 'A' });
      const itemB = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: 'B' });
      await service.transitionStatus(setlist.id, 'ACTIVE');
      await service.transitionStatus(setlist.id, 'COMPLETED');

      await assert.rejects(
        async () => {
          await service.reorderItems(setlist.id, [itemB.id, itemA.id]);
        },
        (err: unknown) =>
          err instanceof ConflictError && err.message.includes('No se pueden reordenar elementos')
      );
    });
  });

  // ==========================================================================
  // 5. ITEM MUTATION & REORDERING
  // ==========================================================================

  describe('5. Item Mutation & Reordering', () => {
    it('5.1 should update item properties in PLANNING state', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Culto en Planificación' });
      const item = await service.addItem(setlist.id, {
        itemType: 'SONG',
        songId: validSongId,
        targetKey: 'G',
      });

      const updated = await service.updateItem(setlist.id, item.id, {
        targetKey: 'A',
        notesForTeam: 'Modulación al final',
      });

      assert.strictEqual(updated.targetKey, 'A');
      assert.strictEqual(updated.notesForTeam, 'Modulación al final');
    });

    it('5.2 should throw NotFoundError when updating an item not in setlist', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Vacío' });
      await assert.rejects(
        async () => {
          await service.updateItem(setlist.id, 'item-no-existe', { targetKey: 'D' });
        },
        (err: unknown) => err instanceof NotFoundError
      );
    });

    it('5.3 should remove item in PLANNING state', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist para Borrar Ítem' });
      const item = await service.addItem(setlist.id, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Lectura',
      });

      await service.removeItem(setlist.id, item.id);
      const reloaded = await service.getSetlist(setlist.id);
      assert.strictEqual(reloaded.items.length, 0);
    });

    it('5.4 should successfully reorder items and delegate to repository', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Reordenar' });
      const i1 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '1' });
      const i2 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '2' });
      const i3 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '3' });

      const newOrder = [i3.id, i1.id, i2.id];
      const reordered = await service.reorderItems(setlist.id, newOrder);

      assert.strictEqual(reordered[0]?.id, i3.id);
      assert.strictEqual(reordered[0]?.sequenceOrder, 1);
      assert.strictEqual(reordered[1]?.id, i1.id);
      assert.strictEqual(reordered[1]?.sequenceOrder, 2);
      assert.strictEqual(reordered[2]?.id, i2.id);
      assert.strictEqual(reordered[2]?.sequenceOrder, 3);
    });

    it('5.5 should reject reorder with empty itemIds array', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Vacío' });
      await assert.rejects(
        async () => {
          await service.reorderItems(setlist.id, []);
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('no puede estar vacía')
      );
    });

    it('5.6 should reject reorder with duplicate IDs', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Dups' });
      const i1 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '1' });
      const i2 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '2' });

      await assert.rejects(
        async () => {
          await service.reorderItems(setlist.id, [i1.id, i1.id]);
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('duplicados')
      );
    });

    it('5.7 should reject reorder when item count does not match setlist items count', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Count Mismatch' });
      const i1 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '1' });
      await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '2' });

      // Pasar solo 1 de los 2 ítems
      await assert.rejects(
        async () => {
          await service.reorderItems(setlist.id, [i1.id]);
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('no coincide')
      );
    });

    it('5.8 should reject reorder when an ID does not belong to the setlist', async () => {
      setup();
      const setlist = await service.createSetlist({ title: 'Setlist Foreign' });
      const i1 = await service.addItem(setlist.id, { itemType: 'SERVICE_MOMENT', momentTitle: '1' });

      await assert.rejects(
        async () => {
          await service.reorderItems(setlist.id, ['foreign-item-id']);
        },
        (err: unknown) => err instanceof ValidationError && err.message.includes('no pertenece')
      );
    });
  });

  // ==========================================================================
  // 6. ERROR PROPAGATION & RESILIENCE
  // ==========================================================================

  describe('6. Error Propagation & Resilience', () => {
    it('6.1 should propagate PersistenceError from repository transparently', async () => {
      setup();
      setlistRepo.shouldFailWithPersistenceError = true;

      await assert.rejects(
        async () => {
          await service.listSetlists();
        },
        (err: unknown) => err instanceof PersistenceError
      );
    });
  });
});
