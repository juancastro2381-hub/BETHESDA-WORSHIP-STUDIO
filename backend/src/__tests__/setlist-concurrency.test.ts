/**
 * @file setlist-concurrency.test.ts
 * @description Suite de verificación de integridad de concurrencia para el Invariante de la Regla A (Fase 2C — WS4).
 *
 * Cobertura:
 * 1. Evidencia Histórica de Auditoría: Demuestra la ventana TOCTOU que existía en SetlistService en memoria.
 * 2. Remediación en PostgreSQL: Verifica que el índice único parcial `idx_setlists_single_active`
 *    garantiza que a lo sumo un setlist puede estar en estado ACTIVE en toda la base de datos.
 * 3. Mapeo de Error en Repositorio: Verifica que el error PostgreSQL 23505 es traducido a ConflictError.
 * 4. Activación Concurrente Remediada: Demuestra que frente a dos activaciones simultáneas, exactamente
 *    una tiene éxito, exactamente una es rechazada con ConflictError, y nunca coexisten dos setlists ACTIVE.
 * 5. Permisividad de Otros Estados: Verifica que coexisten ilimitados setlists en PLANNING, COMPLETED y ARCHIVED.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { setlists, songs, users } from '../db/schema.ts';
import { DrizzleSetlistRepository } from '../repositories/setlist-repository.ts';
import { SetlistService } from '../application/setlist-service.ts';
import { ConflictError } from '../domain/errors.ts';
import type { ISetlistRepository } from '../repositories/setlist-repository.ts';
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

/**
 * Mock asíncrono en memoria para documentar la evidencia histórica de auditoría.
 */
class ConcurrentMockSetlistRepository implements ISetlistRepository {
  public setlists = new Map<string, SetlistEntity>();
  private activeBarrierResolve: (() => void) | null = null;
  private activeBarrierPromise: Promise<void> | null = null;
  private activeListCalls = 0;

  public enableBarrier() {
    this.activeListCalls = 0;
    this.activeBarrierPromise = new Promise<void>((resolve) => {
      this.activeBarrierResolve = resolve;
    });
  }

  public async list(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }> {
    if (filter?.status === 'ACTIVE' && this.activeBarrierPromise) {
      this.activeListCalls++;
      if (this.activeListCalls >= 2) {
        this.activeBarrierResolve?.();
      } else {
        await this.activeBarrierPromise;
      }
    }

    const all = Array.from(this.setlists.values());
    const filtered = filter?.status ? all.filter((s) => s.status === filter.status) : all;
    return {
      items: filtered.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledDateTime: s.scheduledDateTime,
        status: s.status,
        directorUserId: s.directorUserId,
        totalItems: 0,
        totalSongs: 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total: filtered.length,
    };
  }

  public async findById(id: string): Promise<SetlistWithItemsEntity | null> {
    const s = this.setlists.get(id);
    if (!s) return null;
    return { ...s, items: [] };
  }

  public async create(dto: CreateSetlistDTO): Promise<SetlistEntity> {
    const id = `mock-setlist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
    return entity;
  }

  public async update(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity | null> {
    const s = this.setlists.get(id);
    if (!s) return null;
    const scheduledDateTime = dto.scheduledDateTime !== undefined
      ? (dto.scheduledDateTime instanceof Date ? dto.scheduledDateTime : dto.scheduledDateTime ? new Date(dto.scheduledDateTime) : null)
      : s.scheduledDateTime;
    const updated: SetlistEntity = {
      ...s,
      ...dto,
      scheduledDateTime,
      updatedAt: new Date(),
    };
    this.setlists.set(id, updated);
    return updated;
  }

  public async updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null> {
    const s = this.setlists.get(id);
    if (!s) return null;
    const updated = { ...s, status, updatedAt: new Date() };
    this.setlists.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.setlists.delete(id);
  }

  public async listItemsBySetlist(_setlistId: string): Promise<SetlistItemWithSongEntity[]> {
    return [];
  }

  public async findItemById(_itemId: string): Promise<SetlistItemWithSongEntity | null> {
    return null;
  }

  public async createItem(_setlistId: string, _dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity> {
    throw new Error('Not needed in concurrency test');
  }

  public async updateItem(_setlistId: string, _itemId: string, _dto: UpdateSetlistItemDTO): Promise<SetlistItemWithSongEntity | null> {
    return null;
  }

  public async deleteItem(_setlistId: string, _itemId: string): Promise<boolean> {
    return false;
  }

  public async reorderItems(_setlistId: string, _itemIds: string[]): Promise<SetlistItemWithSongEntity[]> {
    return [];
  }
}

describe('Phase 2C — WS4: Concurrency Remediation & Verification Suite', () => {
  const realRepository = new DrizzleSetlistRepository(db);
  const realService = new SetlistService(realRepository);
  const testSetlistIds = new Set<string>();

  let initialSongCount: number;
  let initialUserCount: number;

  before(async () => {
    const [songCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs);
    initialSongCount = songCountRes?.count ?? 0;

    const [userCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    initialUserCount = userCountRes?.count ?? 0;

    // Asegurar limpieza de cualquier setlist residual antes de las pruebas
    await db.delete(setlists).where(eq(setlists.status, 'ACTIVE'));
  });

  after(async () => {
    if (testSetlistIds.size > 0) {
      await db
        .delete(setlists)
        .where(inArray(setlists.id, Array.from(testSetlistIds)));
    }

    const [currentSongCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs);
    assert.ok(
      (currentSongCountRes?.count ?? 0) >= initialSongCount,
      'Las canciones canónicas deben permanecer intactas.'
    );

    const [currentUserCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    assert.ok(
      (currentUserCountRes?.count ?? 0) >= initialUserCount,
      'Los usuarios deben permanecer intactos.'
    );
  });

  // ==========================================================================
  // SECCIÓN 1: EVIDENCIA HISTÓRICA DE AUDITORÍA (POST-GATE AUDIT EVIDENCE)
  // ==========================================================================

  describe('1. Historical Audit Evidence (Pre-Remediation TOCTOU Window)', () => {
    it('1.1 should demonstrate how application-level check alone was vulnerable to TOCTOU', async () => {
      const mockRepo = new ConcurrentMockSetlistRepository();
      const concurrentService = new SetlistService(mockRepo);

      const setlistA = await concurrentService.createSetlist({ title: 'Culto Matutino Histórico' });
      const setlistB = await concurrentService.createSetlist({ title: 'Culto Vespertino Histórico' });

      mockRepo.enableBarrier();

      const [resA, resB] = await Promise.allSettled([
        concurrentService.transitionStatus(setlistA.id, 'ACTIVE'),
        concurrentService.transitionStatus(setlistB.id, 'ACTIVE'),
      ]);

      assert.strictEqual(resA.status, 'fulfilled', 'Petición A fue aprobada por SetlistService');
      assert.strictEqual(resB.status, 'fulfilled', 'Petición B fue aprobada por SetlistService');

      const activeInRepo = Array.from(mockRepo.setlists.values()).filter((s) => s.status === 'ACTIVE');
      assert.strictEqual(
        activeInRepo.length,
        2,
        'Evidencia histórica: sin restricción en base de datos, SetlistService en memoria permitía dos ACTIVE simultáneos.'
      );
    });
  });

  // ==========================================================================
  // SECCIÓN 2: COMPORTAMIENTO REMEDIADO EN POSTGRESQL (POST-REMEDIATION VERIFICATION)
  // ==========================================================================

  describe('2. Post-Remediation Verification (Database Constraint & Repository)', () => {
    it('2.1 should enforce partial unique index in PostgreSQL: reject 2nd ACTIVE insert directly with 23505', async () => {
      const [rowA] = await db
        .insert(setlists)
        .values({ title: 'CANDIDATO_ACTIVO_1', status: 'ACTIVE' })
        .returning();
      testSetlistIds.add(rowA.id);

      assert.strictEqual(rowA.status, 'ACTIVE');

      // El segundo insert con status ACTIVE DEBE ser rechazado por PostgreSQL a nivel de motor
      await assert.rejects(
        async () => {
          const [rowB] = await db
            .insert(setlists)
            .values({ title: 'CANDIDATO_ACTIVO_2', status: 'ACTIVE' })
            .returning();
          if (rowB) testSetlistIds.add(rowB.id);
        },
        (err: any) => {
          const is23505 = err?.code === '23505' || err?.message?.includes('idx_setlists_single_active');
          return is23505;
        }
      );

      // Confirmar que en la base de datos existe exactamente 1 registro ACTIVE
      const activeRows = await db
        .select()
        .from(setlists)
        .where(inArray(setlists.id, [rowA.id]));
      assert.strictEqual(activeRows.length, 1);
      assert.strictEqual(activeRows[0].status, 'ACTIVE');

      // Limpieza del registro activo para las siguientes pruebas
      await db.delete(setlists).where(eq(setlists.id, rowA.id));
      testSetlistIds.delete(rowA.id);
    });

    it('2.2 should translate PostgreSQL 23505 into domain ConflictError in DrizzleSetlistRepository', async () => {
      const setlistA = await realRepository.create({ title: 'Culto Oficial A', status: 'ACTIVE' });
      testSetlistIds.add(setlistA.id);

      // Intentar crear un segundo setlist directamente con status ACTIVE a través del repositorio
      await assert.rejects(
        async () => {
          const setlistB = await realRepository.create({ title: 'Culto Oficial B', status: 'ACTIVE' });
          if (setlistB) testSetlistIds.add(setlistB.id);
        },
        (err: unknown) => {
          return (
            err instanceof ConflictError &&
            err.message.includes('Ya existe un setlist en estado ACTIVE') &&
            err.message.includes('Culto Oficial A')
          );
        }
      );

      // Limpieza
      await db.delete(setlists).where(eq(setlists.id, setlistA.id));
      testSetlistIds.delete(setlistA.id);
    });

    it('2.3 should ensure exactly ONE succeeds and exactly ONE fails with ConflictError under concurrent activation', async () => {
      const setlistA = await realRepository.create({ title: 'Culto Domingo Mañana', status: 'PLANNING' });
      const setlistB = await realRepository.create({ title: 'Culto Domingo Noche', status: 'PLANNING' });
      testSetlistIds.add(setlistA.id);
      testSetlistIds.add(setlistB.id);

      // Para poner a prueba la protección de base de datos incluso si el chequeo de aplicación se intercalara:
      let barrierResolve: () => void;
      const barrierPromise = new Promise<void>((resolve) => {
        barrierResolve = resolve;
      });

      let listCalls = 0;
      const interceptedRepo: ISetlistRepository = Object.create(realRepository);
      interceptedRepo.list = async (filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }> => {
        const res = await realRepository.list(filter);
        if (filter?.status === 'ACTIVE') {
          listCalls++;
          if (listCalls >= 2) {
            barrierResolve();
          } else {
            await barrierPromise;
          }
        }
        return res;
      };

      const raceService = new SetlistService(interceptedRepo);

      // Disparar ambas activaciones concurrentemente
      const [resA, resB] = await Promise.allSettled([
        raceService.transitionStatus(setlistA.id, 'ACTIVE'),
        raceService.transitionStatus(setlistB.id, 'ACTIVE'),
      ]);

      const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
      const rejected = [resA, resB].filter((r) => r.status === 'rejected');

      // 1. Exactamente UNA tiene éxito
      assert.strictEqual(fulfilled.length, 1, 'Exactamente una petición de activación debe tener éxito.');

      // 2. Exactamente UNA es rechazada con ConflictError
      assert.strictEqual(rejected.length, 1, 'Exactamente una petición de activación debe ser rechazada.');
      const rejection = rejected[0] as PromiseRejectedResult;
      assert.ok(
        rejection.reason instanceof ConflictError,
        'La petición rechazada debe arrojar un ConflictError de dominio.'
      );
      assert.ok(
        rejection.reason.message.includes('Ya existe un setlist en estado ACTIVE'),
        'El mensaje de error debe indicar claramente el conflicto de estado ACTIVE.'
      );

      // 3. PostgreSQL NUNCA termina con dos filas ACTIVE: la base de datos contiene exactamente UN setlist ACTIVE
      const activeRowsInDb = await db
        .select()
        .from(setlists)
        .where(inArray(setlists.id, [setlistA.id, setlistB.id]));

      const activeCount = activeRowsInDb.filter((r) => r.status === 'ACTIVE').length;
      assert.strictEqual(
        activeCount,
        1,
        'PostgreSQL debe contener exactamente UN registro en estado ACTIVE.'
      );

      // Limpieza
      await db.delete(setlists).where(inArray(setlists.id, [setlistA.id, setlistB.id]));
      testSetlistIds.delete(setlistA.id);
      testSetlistIds.delete(setlistB.id);
    });

    it('2.4 should permit UNLIMITED coexistence of setlists in PLANNING, COMPLETED, and ARCHIVED', async () => {
      // 3 setlists en PLANNING
      const p1 = await realRepository.create({ title: 'Plan 1', status: 'PLANNING' });
      const p2 = await realRepository.create({ title: 'Plan 2', status: 'PLANNING' });
      const p3 = await realRepository.create({ title: 'Plan 3', status: 'PLANNING' });

      // 3 setlists en COMPLETED
      const c1 = await realRepository.create({ title: 'Comp 1', status: 'COMPLETED' });
      const c2 = await realRepository.create({ title: 'Comp 2', status: 'COMPLETED' });
      const c3 = await realRepository.create({ title: 'Comp 3', status: 'COMPLETED' });

      // 3 setlists en ARCHIVED
      const a1 = await realRepository.create({ title: 'Arch 1', status: 'ARCHIVED' });
      const a2 = await realRepository.create({ title: 'Arch 2', status: 'ARCHIVED' });
      const a3 = await realRepository.create({ title: 'Arch 3', status: 'ARCHIVED' });

      const createdIds = [p1.id, p2.id, p3.id, c1.id, c2.id, c3.id, a1.id, a2.id, a3.id];
      createdIds.forEach((id) => testSetlistIds.add(id));

      const rowsInDb = await db
        .select()
        .from(setlists)
        .where(inArray(setlists.id, createdIds));

      assert.strictEqual(rowsInDb.length, 9, 'Todos los 9 setlists deben coexistir en PostgreSQL sin conflicto.');

      // Limpieza
      await db.delete(setlists).where(inArray(setlists.id, createdIds));
      createdIds.forEach((id) => testSetlistIds.delete(id));
    });
  });
});
