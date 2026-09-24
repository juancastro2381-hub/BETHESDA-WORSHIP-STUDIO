/**
 * @file setlist-repository.test.ts
 * @description Suite de pruebas exhaustivas para DrizzleSetlistRepository (Fase 2C — WS3).
 * Valida CRUD, transacciones SQL, reordenamiento atómico, integridad referencial y preservación de datos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { setlists, songs, users } from '../db/schema.ts';
import { DrizzleSetlistRepository } from '../repositories/setlist-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';

describe('Phase 2C — WS3: DrizzleSetlistRepository and SQL Transactions', () => {
  const repository = new DrizzleSetlistRepository(db);
  const createdSetlistIds = new Set<string>();

  let sampleSongId: string;
  let sampleUserId: string;
  let initialSongCount: number;
  let initialUserCount: number;

  before(async () => {
    // 1. Obtener conteos base de canciones y usuarios
    const [songCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs);
    initialSongCount = songCountRes?.count ?? 0;

    const [userCountRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    initialUserCount = userCountRes?.count ?? 0;

    // 2. Obtener IDs de referencia existentes
    const [existingSong] = await db
      .select({ id: songs.id })
      .from(songs)
      .limit(1);
    assert.ok(existingSong, 'Debe existir al menos una canción base en la base de datos.');
    sampleSongId = existingSong.id;

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .limit(1);
    assert.ok(existingUser, 'Debe existir al menos un usuario base en la base de datos.');
    sampleUserId = existingUser.id;
  });

  after(async () => {
    // Limpieza estricta de todos los setlists de prueba creados
    if (createdSetlistIds.size > 0) {
      await db
        .delete(setlists)
        .where(inArray(setlists.id, Array.from(createdSetlistIds)));
    }

    // Verificación de integridad: la canción y usuario referenciados permanecen intactos
    const [songStillExists] = await db
      .select({ id: songs.id })
      .from(songs)
      .where(sql`${songs.id} = ${sampleSongId}`);

    const [userStillExists] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.id} = ${sampleUserId}`);

    assert.ok(songStillExists, 'La canción base referenciada debe mantenerse intacta.');
    assert.ok(userStillExists, 'El usuario base referenciado debe mantenerse intacto.');
  });

  // ==========================================================================
  // 1. SETLIST CRUD OPERATIONS
  // ==========================================================================

  describe('1. Setlist CRUD Operations', () => {
    let createdSetlistId: string;

    it('1.1 should create a new setlist with default PLANNING status', async () => {
      const scheduledDate = new Date(Date.now() + 86400000); // Mañana
      const created = await repository.create({
        title: 'Culto Dominical de Alabanza',
        scheduledDateTime: scheduledDate,
        directorUserId: sampleUserId,
        notes: 'Enfoque en gratitud y exaltación.',
      });

      assert.ok(created.id);
      createdSetlistIds.add(created.id);
      createdSetlistId = created.id;

      assert.strictEqual(created.title, 'Culto Dominical de Alabanza');
      assert.strictEqual(created.status, 'PLANNING');
      assert.strictEqual(created.directorUserId, sampleUserId);
      assert.strictEqual(created.notes, 'Enfoque en gratitud y exaltación.');
      assert.ok(created.createdAt instanceof Date);
      assert.ok(created.updatedAt instanceof Date);
    });

    it('1.2 should retrieve setlist by ID with director name and empty items list', async () => {
      const found = await repository.findById(createdSetlistId);
      assert.ok(found);
      assert.strictEqual(found.id, createdSetlistId);
      assert.strictEqual(found.title, 'Culto Dominical de Alabanza');
      assert.strictEqual(found.items.length, 0);
      assert.ok(typeof found.directorName === 'string' || found.directorName === null);
    });

    it('1.3 should update setlist fields', async () => {
      const updated = await repository.update(createdSetlistId, {
        title: 'Culto Principal de Adoración',
        notes: 'Apertura con júbilo.',
      });

      assert.ok(updated);
      assert.strictEqual(updated.title, 'Culto Principal de Adoración');
      assert.strictEqual(updated.notes, 'Apertura con júbilo.');
    });

    it('1.4 should update setlist status transition to ACTIVE', async () => {
      const updated = await repository.updateStatus(createdSetlistId, 'ACTIVE');
      assert.ok(updated);
      assert.strictEqual(updated.status, 'ACTIVE');

      const found = await repository.findById(createdSetlistId);
      assert.strictEqual(found?.status, 'ACTIVE');
    });

    it('1.5 should return null when querying non-existent setlist', async () => {
      const nonExistentId = '00000000-0000-4000-8000-000000000099';
      const result = await repository.findById(nonExistentId);
      assert.strictEqual(result, null);
    });
  });

  // ==========================================================================
  // 2. SETLIST ITEMS & POLYMORPHISM
  // ==========================================================================

  describe('2. Setlist Items & Polymorphic Persistence', () => {
    let testSetlistId: string;
    let songItemId: string;
    let momentItemId: string;

    before(async () => {
      const setlist = await repository.create({
        title: 'Servicio con Ítems Polimórficos',
      });
      testSetlistId = setlist.id;
      createdSetlistIds.add(testSetlistId);
    });

    it('2.1 should create a SONG item with execution overrides and default transition', async () => {
      const item = await repository.createItem(testSetlistId, {
        itemType: 'SONG',
        songId: sampleSongId,
        targetKey: 'D Major',
        targetBpm: 128,
        transitionType: 'SEGUE',
        notesForTeam: 'Entrada enérgica con batería',
      });

      assert.ok(item.id);
      songItemId = item.id;
      assert.strictEqual(item.setlistId, testSetlistId);
      assert.strictEqual(item.sequenceOrder, 1);
      assert.strictEqual(item.itemType, 'SONG');
      assert.strictEqual(item.songId, sampleSongId);
      assert.strictEqual(item.targetKey, 'D Major');
      assert.strictEqual(item.targetBpm, 128);
      assert.strictEqual(item.transitionType, 'SEGUE');
      assert.strictEqual(item.notesForTeam, 'Entrada enérgica con batería');
      assert.ok(item.song, 'El ítem de tipo SONG debe incluir el resumen de la canción vinculada.');
      assert.strictEqual(item.song?.id, sampleSongId);
    });

    it('2.2 should create a SERVICE_MOMENT item with auto sequence assignment', async () => {
      const item = await repository.createItem(testSetlistId, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Momento de Oración e Intercesión',
        durationMinutes: 7,
        musicalKey: 'D Minor',
        notesForTeam: 'Fondo suave en piano (pad ambiental)',
      });

      assert.ok(item.id);
      momentItemId = item.id;
      assert.strictEqual(item.setlistId, testSetlistId);
      assert.strictEqual(item.sequenceOrder, 2); // Secuencia calculada automáticamente
      assert.strictEqual(item.itemType, 'SERVICE_MOMENT');
      assert.strictEqual(item.momentTitle, 'Momento de Oración e Intercesión');
      assert.strictEqual(item.durationMinutes, 7);
      assert.strictEqual(item.musicalKey, 'D Minor');
      assert.strictEqual(item.song, null);
    });

    it('2.3 should retrieve items ordered by sequenceOrder via listItemsBySetlist', async () => {
      const items = await repository.listItemsBySetlist(testSetlistId);
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0]?.sequenceOrder, 1);
      assert.strictEqual(items[0]?.itemType, 'SONG');
      assert.strictEqual(items[1]?.sequenceOrder, 2);
      assert.strictEqual(items[1]?.itemType, 'SERVICE_MOMENT');
    });

    it('2.4 should update setlist item attributes', async () => {
      const updated = await repository.updateItem(testSetlistId, songItemId, {
        targetKey: 'E Major',
        targetBpm: 132,
        notesForTeam: 'Subir modulación en último coro',
      });

      assert.ok(updated);
      assert.strictEqual(updated.targetKey, 'E Major');
      assert.strictEqual(updated.targetBpm, 132);
      assert.strictEqual(updated.notesForTeam, 'Subir modulación en último coro');
    });

    it('2.5 should delete an item and compact sequence numbers', async () => {
      // Agregar un tercer ítem para probar compactación
      const thirdItem = await repository.createItem(testSetlistId, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Palabra y Mensaje Pastoral',
        durationMinutes: 30,
      });
      assert.strictEqual(thirdItem.sequenceOrder, 3);

      // Eliminar el primer ítem (songItemId en pos 1)
      const deleted = await repository.deleteItem(testSetlistId, songItemId);
      assert.strictEqual(deleted, true);

      // Comprobar que los ítems restantes se compactaron a 1 y 2
      const remainingItems = await repository.listItemsBySetlist(testSetlistId);
      assert.strictEqual(remainingItems.length, 2);
      assert.strictEqual(remainingItems[0]?.id, momentItemId);
      assert.strictEqual(remainingItems[0]?.sequenceOrder, 1);
      assert.strictEqual(remainingItems[1]?.id, thirdItem.id);
      assert.strictEqual(remainingItems[1]?.sequenceOrder, 2);
    });
  });

  // ==========================================================================
  // 3. PAGINATION AND FILTERING
  // ==========================================================================

  describe('3. Pagination & Filtering Queries', () => {
    let upcomingSetlistId: string;
    let pastSetlistId: string;

    before(async () => {
      const future = new Date(Date.now() + 172800000); // 2 días en el futuro
      const past = new Date(Date.now() - 172800000); // 2 días en el pasado

      const s1 = await repository.create({
        title: 'Culto Futuro Programado',
        scheduledDateTime: future,
        status: 'PLANNING',
      });
      upcomingSetlistId = s1.id;
      createdSetlistIds.add(upcomingSetlistId);

      const s2 = await repository.create({
        title: 'Culto Pasado Histórico',
        scheduledDateTime: past,
        status: 'COMPLETED',
      });
      pastSetlistId = s2.id;
      createdSetlistIds.add(pastSetlistId);
    });

    it('3.1 should filter by status COMPLETED', async () => {
      const res = await repository.list({ status: 'COMPLETED' });
      assert.ok(res.items.length >= 1);
      assert.ok(res.items.every((it) => it.status === 'COMPLETED'));
      assert.ok(res.items.some((it) => it.id === pastSetlistId));
    });

    it('3.2 should filter by upcoming = true', async () => {
      const res = await repository.list({ upcoming: true });
      assert.ok(res.items.some((it) => it.id === upcomingSetlistId));
      assert.ok(res.items.every((it) => it.scheduledDateTime !== null && it.scheduledDateTime.getTime() >= Date.now() - 60000));
    });

    it('3.3 should paginate correctly with limit and offset', async () => {
      const page1 = await repository.list({ limit: 1, offset: 0 });
      assert.strictEqual(page1.items.length, 1);
      assert.ok(page1.total >= 2);

      const page2 = await repository.list({ limit: 1, offset: 1 });
      assert.strictEqual(page2.items.length, 1);
      assert.notStrictEqual(page1.items[0]?.id, page2.items[0]?.id);
    });
  });

  // ==========================================================================
  // 4. ATOMIC REORDER TRANSACTIONS (CRITICAL WS3 RESPONSIBILITY)
  // ==========================================================================

  describe('4. Atomic Reorder Transactions and Concurrency Invariants', () => {
    let reorderSetlistId: string;
    let itemAId: string;
    let itemBId: string;
    let itemCId: string;

    before(async () => {
      const setlist = await repository.create({
        title: 'Setlist para Reordenamiento Atómico',
      });
      reorderSetlistId = setlist.id;
      createdSetlistIds.add(reorderSetlistId);

      const itemA = await repository.createItem(reorderSetlistId, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Bienvenida',
      });
      const itemB = await repository.createItem(reorderSetlistId, {
        itemType: 'SONG',
        songId: sampleSongId,
      });
      const itemC = await repository.createItem(reorderSetlistId, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Despedida',
      });

      itemAId = itemA.id;
      itemBId = itemB.id;
      itemCId = itemC.id;
    });

    it('4.1 should successfully reorder items atomically (C -> A -> B)', async () => {
      const newOrder = [itemCId, itemAId, itemBId];
      const reordered = await repository.reorderItems(reorderSetlistId, newOrder);

      assert.strictEqual(reordered.length, 3);
      assert.strictEqual(reordered[0]?.id, itemCId);
      assert.strictEqual(reordered[0]?.sequenceOrder, 1);

      assert.strictEqual(reordered[1]?.id, itemAId);
      assert.strictEqual(reordered[1]?.sequenceOrder, 2);

      assert.strictEqual(reordered[2]?.id, itemBId);
      assert.strictEqual(reordered[2]?.sequenceOrder, 3);

      // Verificar persistencia real en base de datos
      const persisted = await repository.listItemsBySetlist(reorderSetlistId);
      assert.deepStrictEqual(
        persisted.map((i) => i.id),
        newOrder
      );
    });

    it('4.2 should reject reorder with empty itemIds array', async () => {
      await assert.rejects(
        async () => {
          await repository.reorderItems(reorderSetlistId, []);
        },
        (error: unknown) => error instanceof ValidationError
      );
    });

    it('4.3 should reject reorder with duplicated IDs in array', async () => {
      await assert.rejects(
        async () => {
          await repository.reorderItems(reorderSetlistId, [itemCId, itemAId, itemCId]);
        },
        (error: unknown) => error instanceof ValidationError
      );
    });

    it('4.4 should reject reorder when item count does not match setlist items count', async () => {
      await assert.rejects(
        async () => {
          // Solo 2 de los 3 ítems
          await repository.reorderItems(reorderSetlistId, [itemCId, itemAId]);
        },
        (error: unknown) => error instanceof ValidationError
      );
    });

    it('4.5 should reject reorder when an item ID belongs to another setlist or does not exist', async () => {
      const foreignId = '00000000-0000-4000-8000-000000000077';
      await assert.rejects(
        async () => {
          await repository.reorderItems(reorderSetlistId, [itemCId, itemAId, foreignId]);
        },
        (error: unknown) => error instanceof ValidationError
      );
    });

    it('4.6 should reject reorder when setlistId does not exist (NotFoundError)', async () => {
      const nonExistentSetlistId = '00000000-0000-4000-8000-000000000099';
      await assert.rejects(
        async () => {
          await repository.reorderItems(nonExistentSetlistId, [itemAId, itemBId, itemCId]);
        },
        (error: unknown) => error instanceof NotFoundError
      );
    });

    it('4.7 should verify rollback on failure: original sequence remains unaffected', async () => {
      // Estado antes del intento fallido: [C (1), A (2), B (3)]
      const beforeFailure = await repository.listItemsBySetlist(reorderSetlistId);
      const originalOrder = beforeFailure.map((i) => ({ id: i.id, seq: i.sequenceOrder }));

      // Intentar reordenar con un elemento inválido que forzará fallo en la transacción
      const foreignId = '00000000-0000-4000-8000-000000000088';
      await assert.rejects(async () => {
        await repository.reorderItems(reorderSetlistId, [itemBId, itemAId, foreignId]);
      });

      // Verificar que ningún ítem fue modificado en la base de datos
      const afterFailure = await repository.listItemsBySetlist(reorderSetlistId);
      const currentOrder = afterFailure.map((i) => ({ id: i.id, seq: i.sequenceOrder }));

      assert.deepStrictEqual(currentOrder, originalOrder, 'La transacción fallida no debe dejar cambios parciales.');
    });
  });

  // ==========================================================================
  // 5. REFERENTIAL INTEGRITY AND DELETE SEMANTICS
  // ==========================================================================

  describe('5. Referential Integrity & Delete Semantics', () => {
    it('5.1 should fail to create a SONG item with a non-existent songId', async () => {
      const setlist = await repository.create({ title: 'Setlist FK Test' });
      createdSetlistIds.add(setlist.id);

      const fakeSongId = '00000000-0000-4000-8000-000000000055';
      await assert.rejects(
        async () => {
          await repository.createItem(setlist.id, {
            itemType: 'SONG',
            songId: fakeSongId,
          });
        },
        (error: unknown) => error instanceof NotFoundError
      );
    });

    it('5.2 should cascade-delete setlist items when setlist is deleted, without touching referenced song', async () => {
      const setlist = await repository.create({ title: 'Setlist Para Eliminar' });
      const item = await repository.createItem(setlist.id, {
        itemType: 'SONG',
        songId: sampleSongId,
      });

      // Confirmar existencia del ítem
      const foundItemBefore = await repository.findItemById(item.id);
      assert.ok(foundItemBefore);

      // Eliminar el setlist
      const deleted = await repository.delete(setlist.id);
      assert.strictEqual(deleted, true);

      // El ítem debe haber desaparecido por cascade
      const foundItemAfter = await repository.findItemById(item.id);
      assert.strictEqual(foundItemAfter, null);

      // La canción canónica referenciada DEBE permanecer intacta
      const [songStillExists] = await db
        .select({ id: songs.id })
        .from(songs)
        .where(sql`${songs.id} = ${sampleSongId}`);
      assert.ok(songStillExists, 'La canción canónica referenciada no debe ser alterada ni eliminada.');
    });
  });
});
