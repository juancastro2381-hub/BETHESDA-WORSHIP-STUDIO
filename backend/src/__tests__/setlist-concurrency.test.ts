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
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { setlists, songs, users } from '../db/schema.ts';
import { env } from '../config/env.ts';
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

const { Pool } = pg;

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
        isTemplate: s.isTemplate,
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
      isTemplate: dto.isTemplate ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.setlists.set(id, entity);
    return entity;
  }

  public async duplicate(id: string, newTitle: string): Promise<SetlistWithItemsEntity> {
    const source = this.setlists.get(id);
    if (!source) throw new Error(`Setlist ${id} not found`);
    const created = await this.create({ title: newTitle, directorUserId: source.directorUserId, notes: source.notes });
    return { ...created, items: [] };
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

    if (status === 'ACTIVE' && this.activeBarrierPromise) {
      // Simula una lectura no transaccional previa a la escritura (ventana TOCTOU histórica)
      const activeBeforeBarrier = Array.from(this.setlists.values()).find(
        (item) => item.status === 'ACTIVE' && item.id !== id
      );
      this.activeListCalls++;
      if (this.activeListCalls >= 2) {
        this.activeBarrierResolve?.();
      } else {
        await this.activeBarrierPromise;
      }
      if (activeBeforeBarrier) {
        throw new ConflictError(`Ya existe un setlist en estado ACTIVE ('${activeBeforeBarrier.title}').`);
      }
    }

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

  // Dos pools de conexiones independientes a PostgreSQL para garantizar concurrencia real entre sesiones distintas
  const connectionString = env.NODE_ENV === 'test' ? (env.TEST_DATABASE_URL as string) : env.DATABASE_URL;
  let poolConn1: pg.Pool;
  let poolConn2: pg.Pool;
  let dbConn1: ReturnType<typeof drizzle<typeof schema>>;
  let dbConn2: ReturnType<typeof drizzle<typeof schema>>;
  let repoConn1: DrizzleSetlistRepository;
  let repoConn2: DrizzleSetlistRepository;
  let serviceConn1: SetlistService;
  let serviceConn2: SetlistService;

  let initialSongCount: number;
  let initialUserCount: number;

  async function getActiveCountFromPostgres(): Promise<number> {
    const res = await pool.query<{ active_count: number }>(
      "SELECT count(*)::int AS active_count FROM setlists WHERE status = 'ACTIVE'"
    );
    return res.rows[0]?.active_count ?? 0;
  }

  /**
   * Guardia de aislamiento de base de datos de pruebas:
   * Verifica que no exista un setlist ACTIVE preexistente ajeno a esta ejecución de pruebas.
   * Si existe, falla de forma segura con un diagnóstico claro sin eliminar jamás registros preexistentes.
   */
  async function assertNoPreExistingActiveSetlists(allowedTrackedIds: ReadonlySet<string>): Promise<void> {
    const activeRows = await db
      .select({ id: setlists.id, title: setlists.title })
      .from(setlists)
      .where(eq(setlists.status, 'ACTIVE'));

    const externalActive = activeRows.filter((row) => !allowedTrackedIds.has(row.id));
    if (externalActive.length > 0) {
      const details = externalActive.map((r) => `${r.id} ("${r.title}")`).join(', ');
      throw new Error(
        `❌ Violación de Aislamiento en Base de Datos de Pruebas: Se detectó un setlist ACTIVE preexistente no creado por esta suite [${details}]. Se aborta de forma segura sin eliminar registros preexistentes.`
      );
    }
  }

  /**
   * Limpia exclusivamente los registros cuyos IDs exactos fueron generados y registrados por esta suite.
   * Nunca elimina registros por estado ni afecta datos de otras suites o usuarios.
   */
  async function cleanupTrackedSetlists(idsToClean: Iterable<string>): Promise<void> {
    const ownedIds = Array.from(idsToClean).filter((id) => testSetlistIds.has(id));
    if (ownedIds.length === 0) return;

    await db.delete(setlists).where(inArray(setlists.id, ownedIds));
    for (const id of ownedIds) {
      testSetlistIds.delete(id);
    }
  }

  before(async () => {
    assert.ok(
      Boolean(env.TEST_DATABASE_URL),
      'TEST_DATABASE_URL es obligatorio durante la ejecución de pruebas.'
    );

    poolConn1 = new Pool({ connectionString, max: 2 });
    poolConn2 = new Pool({ connectionString, max: 2 });
    dbConn1 = drizzle(poolConn1, { schema });
    dbConn2 = drizzle(poolConn2, { schema });
    repoConn1 = new DrizzleSetlistRepository(dbConn1);
    repoConn2 = new DrizzleSetlistRepository(dbConn2);
    serviceConn1 = new SetlistService(repoConn1);
    serviceConn2 = new SetlistService(repoConn2);

    const [songCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs);
    initialSongCount = songCountRes?.count ?? 0;

    const [userCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    initialUserCount = userCountRes?.count ?? 0;

    // Verificar aislamiento sin eliminar jamás registros ACTIVE preexistentes
    await assertNoPreExistingActiveSetlists(testSetlistIds);
  });

  after(async () => {
    try {
      await cleanupTrackedSetlists(Array.from(testSetlistIds));
    } finally {
      await Promise.allSettled([poolConn1?.end(), poolConn2?.end()]);
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

      assert.strictEqual(resA.status, 'fulfilled', 'Petición A fue aprobada por mock sin transacción');
      assert.strictEqual(resB.status, 'fulfilled', 'Petición B fue aprobada por mock sin transacción');

      const activeInRepo = Array.from(mockRepo.setlists.values()).filter((s) => s.status === 'ACTIVE');
      assert.strictEqual(
        activeInRepo.length,
        2,
        'Evidencia histórica: sin transacción ni restricción en base de datos, lecturas separadas permitían dos ACTIVE simultáneos.'
      );
    });
  });

  // ==========================================================================
  // SECCIÓN 2: COMPORTAMIENTO REMEDIADO EN POSTGRESQL (CONEXIONES INDEPENDIENTES)
  // ==========================================================================

  describe('2. Post-Remediation Verification (Independent PostgreSQL Connections & Atomic Transactions)', () => {
    it('2.1 should enforce partial unique index in PostgreSQL: reject 2nd ACTIVE insert directly with 23505', async () => {
      const localIds: string[] = [];
      try {
        const [rowA] = await dbConn1
          .insert(setlists)
          .values({ title: 'CANDIDATO_ACTIVO_1', status: 'ACTIVE' })
          .returning();
        testSetlistIds.add(rowA!.id);
        localIds.push(rowA!.id);

        assert.strictEqual(rowA!.status, 'ACTIVE');

        // El segundo insert con status ACTIVE en la segunda conexión independiente DEBE ser rechazado por PostgreSQL (23505)
        await assert.rejects(
          async () => {
            const [rowB] = await dbConn2
              .insert(setlists)
              .values({ title: 'CANDIDATO_ACTIVO_2', status: 'ACTIVE' })
              .returning();
            if (rowB) {
              testSetlistIds.add(rowB.id);
              localIds.push(rowB.id);
            }
          },
          (err: any) => {
            return err?.code === '23505' || err?.message?.includes('idx_setlists_single_active');
          }
        );

        assert.strictEqual(await getActiveCountFromPostgres(), 1);
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.2 should reject activation while another setlist is already ACTIVE across independent connections', async () => {
      const localIds: string[] = [];
      try {
        const setlistA = await serviceConn1.createSetlist({ title: 'Culto Oficial A', status: 'ACTIVE' });
        testSetlistIds.add(setlistA.id);
        localIds.push(setlistA.id);

        const setlistB = await serviceConn1.createSetlist({ title: 'Culto Oficial B', status: 'PLANNING' });
        testSetlistIds.add(setlistB.id);
        localIds.push(setlistB.id);

        // 1. Intentar activar setlistB desde la conexión 2 mientras setlistA ya está ACTIVE
        await assert.rejects(
          async () => {
            await serviceConn2.transitionStatus(setlistB.id, 'ACTIVE');
          },
          (err: unknown) => {
            return (
              err instanceof ConflictError &&
              err.message.includes('Ya existe un setlist en estado ACTIVE') &&
              err.message.includes('Culto Oficial A')
            );
          }
        );

        // 2. Intentar crear un tercer setlist directamente como ACTIVE desde la conexión 2
        await assert.rejects(
          async () => {
            const setlistC = await serviceConn2.createSetlist({ title: 'Culto Oficial C', status: 'ACTIVE' });
            if (setlistC) {
              testSetlistIds.add(setlistC.id);
              localIds.push(setlistC.id);
            }
          },
          (err: unknown) => {
            return (
              err instanceof ConflictError &&
              err.message.includes('Ya existe un setlist en estado ACTIVE') &&
              err.message.includes('Culto Oficial A')
            );
          }
        );

        assert.strictEqual(await getActiveCountFromPostgres(), 1);
        const checkB = await serviceConn1.getSetlist(setlistB.id);
        assert.strictEqual(checkB.status, 'PLANNING');
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.3 should handle two concurrent activation requests for DIFFERENT setlists over independent PostgreSQL connections (exactly 1 succeeds, 1 fails with ConflictError)', async () => {
      const localIds: string[] = [];
      try {
        // Verificar que poolConn1 y poolConn2 utilizan procesos backend distintos en PostgreSQL
        const [pid1Res, pid2Res] = await Promise.all([
          poolConn1.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
          poolConn2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
        ]);
        assert.notStrictEqual(
          pid1Res.rows[0]?.pid,
          pid2Res.rows[0]?.pid,
          'Las conexiones independientes deben ejecutarse en backends PostgreSQL distintos.'
        );

        const setlistA = await serviceConn1.createSetlist({ title: 'Culto Domingo Mañana', status: 'PLANNING' });
        testSetlistIds.add(setlistA.id);
        localIds.push(setlistA.id);

        const setlistB = await serviceConn2.createSetlist({ title: 'Culto Domingo Noche', status: 'PLANNING' });
        testSetlistIds.add(setlistB.id);
        localIds.push(setlistB.id);

        // Disparar ambas activaciones simultáneamente sobre conexiones PostgreSQL independientes
        const [resA, resB] = await Promise.allSettled([
          serviceConn1.transitionStatus(setlistA.id, 'ACTIVE'),
          serviceConn2.transitionStatus(setlistB.id, 'ACTIVE'),
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

        // 3. Verificar directamente en PostgreSQL que el conteo final de ACTIVE es exactamente 1
        assert.strictEqual(
          await getActiveCountFromPostgres(),
          1,
          'PostgreSQL debe contener exactamente UN registro en estado ACTIVE.'
        );

        const rowsInDb = await db
          .select()
          .from(setlists)
          .where(inArray(setlists.id, [setlistA.id, setlistB.id]));
        const activeCount = rowsInDb.filter((r) => r.status === 'ACTIVE').length;
        const planningCount = rowsInDb.filter((r) => r.status === 'PLANNING').length;
        assert.strictEqual(activeCount, 1);
        assert.strictEqual(planningCount, 1);
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.4 should serialize two concurrent activation requests for the SAME setlist over independent PostgreSQL connections (SELECT ... FOR UPDATE)', async () => {
      const localIds: string[] = [];
      try {
        const setlistSame = await serviceConn1.createSetlist({
          title: 'Culto Único Concurrente',
          status: 'PLANNING',
        });
        testSetlistIds.add(setlistSame.id);
        localIds.push(setlistSame.id);

        const [res1, res2] = await Promise.allSettled([
          serviceConn1.transitionStatus(setlistSame.id, 'ACTIVE'),
          serviceConn2.transitionStatus(setlistSame.id, 'ACTIVE'),
        ]);

        // Gracias al bloqueo de fila (SELECT ... FOR UPDATE) e idempotencia del mismo estado,
        // ambas peticiones se serializan sin corrupción y el setlist queda ACTIVE exactamente una vez
        assert.strictEqual(res1.status, 'fulfilled');
        assert.strictEqual(res2.status, 'fulfilled');
        assert.strictEqual(res1.value.status, 'ACTIVE');
        assert.strictEqual(res2.value.status, 'ACTIVE');

        assert.strictEqual(
          await getActiveCountFromPostgres(),
          1,
          'El conteo de setlists ACTIVE en PostgreSQL debe ser exactamente 1.'
        );
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.5 should perform complete transaction rollback after an activation conflict, preserving previous state in PostgreSQL', async () => {
      const localIds: string[] = [];
      try {
        const setlistActive = await serviceConn1.createSetlist({
          title: 'Culto Activo Vigente',
          status: 'ACTIVE',
        });
        testSetlistIds.add(setlistActive.id);
        localIds.push(setlistActive.id);

        const setlistCandidate = await serviceConn1.createSetlist({
          title: 'Título Original Intacto',
          notes: 'Notas Originales Intactas',
          status: 'PLANNING',
        });
        testSetlistIds.add(setlistCandidate.id);
        localIds.push(setlistCandidate.id);

        // Caso A: Activación rechazada por servicio/repositorio preserva el estado PLANNING
        await assert.rejects(
          async () => {
            await serviceConn2.transitionStatus(setlistCandidate.id, 'ACTIVE');
          },
          (err: unknown) => err instanceof ConflictError
        );

        // Caso B: Transacción multi-operación en conexión 2 que modifica metadatos y luego choca con idx_setlists_single_active
        await assert.rejects(
          async () => {
            await dbConn2.transaction(async (tx) => {
              await tx
                .update(setlists)
                .set({
                  title: 'TÍTULO CORRUPTO NO CONFIRMADO',
                  notes: 'NOTAS NO CONFIRMADAS',
                })
                .where(eq(setlists.id, setlistCandidate.id));

              // Este UPDATE viola el índice único parcial idx_setlists_single_active (23505) y fuerza rollback
              await tx
                .update(setlists)
                .set({ status: 'ACTIVE' })
                .where(eq(setlists.id, setlistCandidate.id));
            });
          },
          (err: any) => err?.code === '23505' || err?.message?.includes('idx_setlists_single_active')
        );

        // Verificar directamente contra PostgreSQL que el rollback preservó el estado previo intacto
        const dbVerify = await pool.query<{ title: string; notes: string; status: string }>(
          'SELECT title, notes, status FROM setlists WHERE id = $1',
          [setlistCandidate.id]
        );
        assert.strictEqual(dbVerify.rows.length, 1);
        assert.strictEqual(dbVerify.rows[0]!.status, 'PLANNING', 'El estado debe permanecer en PLANNING tras rollback.');
        assert.strictEqual(
          dbVerify.rows[0]!.title,
          'Título Original Intacto',
          'El título modificado dentro de la transacción abortada debe revertirse.'
        );
        assert.strictEqual(
          dbVerify.rows[0]!.notes,
          'Notas Originales Intactas',
          'Las notas modificadas dentro de la transacción abortada deben revertirse.'
        );
        assert.strictEqual(await getActiveCountFromPostgres(), 1);
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.6 should ensure sequential and concurrent deactivation + activation transitions never violate single-ACTIVE invariant', async () => {
      const localIds: string[] = [];
      try {
        const setlistA = await serviceConn1.createSetlist({ title: 'Culto Turno 1', status: 'ACTIVE' });
        testSetlistIds.add(setlistA.id);
        localIds.push(setlistA.id);

        const setlistB = await serviceConn2.createSetlist({ title: 'Culto Turno 2', status: 'PLANNING' });
        testSetlistIds.add(setlistB.id);
        localIds.push(setlistB.id);

        assert.strictEqual(await getActiveCountFromPostgres(), 1);

        // Desactivar A en conexión 1 y activar B en conexión 2
        const deactivatedA = await serviceConn1.transitionStatus(setlistA.id, 'COMPLETED');
        assert.strictEqual(deactivatedA.status, 'COMPLETED');
        assert.strictEqual(await getActiveCountFromPostgres(), 0);

        const activatedB = await serviceConn2.transitionStatus(setlistB.id, 'ACTIVE');
        assert.strictEqual(activatedB.status, 'ACTIVE');
        assert.strictEqual(await getActiveCountFromPostgres(), 1);
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
      assert.strictEqual(await getActiveCountFromPostgres(), 0);
    });

    it('2.7 should permit UNLIMITED coexistence of setlists in PLANNING, COMPLETED, and ARCHIVED', async () => {
      const localIds: string[] = [];
      try {
        const p1 = await realService.createSetlist({ title: 'Plan 1', status: 'PLANNING' });
        const p2 = await realService.createSetlist({ title: 'Plan 2', status: 'PLANNING' });
        const p3 = await realService.createSetlist({ title: 'Plan 3', status: 'PLANNING' });

        const c1 = await realService.createSetlist({ title: 'Comp 1', status: 'COMPLETED' });
        const c2 = await realService.createSetlist({ title: 'Comp 2', status: 'COMPLETED' });
        const c3 = await realService.createSetlist({ title: 'Comp 3', status: 'COMPLETED' });

        const a1 = await realService.createSetlist({ title: 'Arch 1', status: 'ARCHIVED' });
        const a2 = await realService.createSetlist({ title: 'Arch 2', status: 'ARCHIVED' });
        const a3 = await realService.createSetlist({ title: 'Arch 3', status: 'ARCHIVED' });

        const createdIds = [p1.id, p2.id, p3.id, c1.id, c2.id, c3.id, a1.id, a2.id, a3.id];
        createdIds.forEach((id) => {
          testSetlistIds.add(id);
          localIds.push(id);
        });

        const rowsInDb = await db
          .select()
          .from(setlists)
          .where(inArray(setlists.id, createdIds));

        assert.strictEqual(rowsInDb.length, 9, 'Todos los 9 setlists deben coexistir en PostgreSQL sin conflicto.');
        assert.strictEqual(await getActiveCountFromPostgres(), 0);
      } finally {
        await cleanupTrackedSetlists(localIds);
      }
    });

    it('2.8 should NEVER delete pre-existing untracked ACTIVE setlists and should fail safely when one is detected', async () => {
      let simulatedExternalActiveId: string | null = null;
      const localTrackedIds: string[] = [];

      try {
        // 1. Insertar un registro simulando un setlist ACTIVE preexistente de otra suite/usuario (NO registrado en testSetlistIds)
        const [externalActive] = await db
          .insert(setlists)
          .values({ title: 'SETLIST_ACTIVO_EXTERNO_PREEXISTENTE', status: 'ACTIVE' })
          .returning();
        simulatedExternalActiveId = externalActive!.id;

        // 2. Insertar un setlist propio registrado en testSetlistIds
        const ownedPlanning = await realService.createSetlist({
          title: 'Setlist Propio Registrado',
          status: 'PLANNING',
        });
        testSetlistIds.add(ownedPlanning.id);
        localTrackedIds.push(ownedPlanning.id);

        // 3. Verificar que la guardia assertNoPreExistingActiveSetlists falla de forma segura con diagnóstico claro
        await assert.rejects(
          async () => {
            await assertNoPreExistingActiveSetlists(testSetlistIds);
          },
          (err: unknown) => {
            return (
              err instanceof Error &&
              err.message.includes('Violación de Aislamiento en Base de Datos de Pruebas') &&
              err.message.includes(simulatedExternalActiveId!) &&
              err.message.includes('SETLIST_ACTIVO_EXTERNO_PREEXISTENTE')
            );
          }
        );

        // 4. Ejecutar cleanupTrackedSetlists incluso pasando el ID externo: solo debe borrar los IDs pertenecientes a testSetlistIds
        await cleanupTrackedSetlists([ownedPlanning.id, simulatedExternalActiveId]);

        // 5. Demostrar que el registro propio fue limpiado pero el registro ACTIVE preexistente externo permanece intacto en PostgreSQL
        const ownedCheck = await db
          .select()
          .from(setlists)
          .where(eq(setlists.id, ownedPlanning.id));
        assert.strictEqual(ownedCheck.length, 0, 'El registro propio registrado debe limpiarse por su ID exacto.');

        const externalCheck = await db
          .select()
          .from(setlists)
          .where(eq(setlists.id, simulatedExternalActiveId));
        assert.strictEqual(
          externalCheck.length,
          1,
          'El registro ACTIVE preexistente ajeno a la suite NUNCA debe ser eliminado.'
        );
        assert.strictEqual(externalCheck[0]!.status, 'ACTIVE');
        assert.strictEqual(externalCheck[0]!.title, 'SETLIST_ACTIVO_EXTERNO_PREEXISTENTE');
      } finally {
        await cleanupTrackedSetlists(localTrackedIds);
        if (simulatedExternalActiveId) {
          await db.delete(setlists).where(eq(setlists.id, simulatedExternalActiveId));
        }
      }
    });
  });
});
