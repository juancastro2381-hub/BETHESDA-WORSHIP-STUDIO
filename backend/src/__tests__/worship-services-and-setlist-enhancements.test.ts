/**
 * @file worship-services-and-setlist-enhancements.test.ts
 * @description Pruebas de integración (PostgreSQL + Fastify) para Fase 2C:
 *  - Cultos / Servicios Litúrgicos (/api/v1/worship-services): CRUD, categoría libre, vínculo a setlist, filtros temporales.
 *  - RBAC por rol (SUPER_ADMIN/ADMIN/WORSHIP_LEADER/MUSICIAN/VIEWER).
 *  - Duplicación de setlists y plantillas reutilizables (POST /api/v1/setlists/:id/duplicate).
 *  - Configuración musical por entrada (instrumento, afinación, formato sugerido) sin mutar la canción canónica.
 *  - Auditoría de eventos WORSHIP_SERVICE_CREATED / WORSHIP_SERVICE_DELETED / SETLIST_DUPLICATED.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import type { UserEntity, UserRole } from '../domain/auth-types.ts';

describe('Phase 2C — Worship Services, Setlist Duplication/Templates & Per-Entry Musical Configuration', () => {
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  const users: Record<string, UserEntity> = {};
  let canonicalSongId: string;
  let canonicalSongSnapshot: Record<string, unknown>;

  const createdUserIds = new Set<string>();
  const createdSetlistIds = new Set<string>();
  const createdServiceIds = new Set<string>();
  const PREFIX = `P2C-${Date.now()}`;

  const auth = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    const userRepo = new DrizzleUserRepository();

    const songRes = await pool.query('SELECT * FROM songs LIMIT 1');
    assert.ok(songRes.rows.length > 0, 'Debe existir al menos una canción canónica en la BD.');
    canonicalSongId = songRes.rows[0].id;
    canonicalSongSnapshot = songRes.rows[0];

    const roles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER'];
    for (const role of roles) {
      const u = await userRepo.create({
        email: `${PREFIX.toLowerCase()}-${role.toLowerCase()}@bethesda.co`,
        passwordHash: 'dummy_hash',
        firstName: role,
        lastName: 'P2C',
        role,
        accountStatus: 'ACTIVE',
      });
      users[role] = u;
      createdUserIds.add(u.id);
      tokens[role] = tokenService.signAccessToken({ sub: u.id, email: u.email, role: u.role }).token;
    }
  });

  after(async () => {
    if (createdServiceIds.size > 0) {
      await pool.query('DELETE FROM worship_services WHERE id = ANY($1)', [[...createdServiceIds]]);
    }
    await pool.query('DELETE FROM worship_services WHERE name LIKE $1', [`${PREFIX}%`]);
    if (createdSetlistIds.size > 0) {
      await pool.query('DELETE FROM setlists WHERE id = ANY($1)', [[...createdSetlistIds]]);
    }
    await pool.query('DELETE FROM setlists WHERE title LIKE $1', [`${PREFIX}%`]);
    if (createdUserIds.size > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[...createdUserIds]]);
    }
    await app.close();
  });

  async function createSetlist(title: string, role = 'WORSHIP_LEADER', extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setlists',
      headers: auth(role),
      payload: { title, ...extra },
    });
    assert.strictEqual(res.statusCode, 201, res.body);
    const data = res.json().data;
    createdSetlistIds.add(data.id);
    return data;
  }

  // ==========================================================================
  // 1. CULTOS / SERVICIOS LITÚRGICOS
  // ==========================================================================
  describe('1. Worship Services CRUD', () => {
    it('1.1 WORSHIP_LEADER creates a service with free-text category, leader, notes and linked setlist', async () => {
      const setlist = await createSetlist(`${PREFIX} Setlist Dominical`);
      const scheduledAt = new Date(Date.now() + 3 * 86400000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('WORSHIP_LEADER'),
        payload: {
          name: `${PREFIX} Culto Dominical`,
          description: 'Servicio principal de domingo',
          serviceType: 'Reunión de Jóvenes',
          scheduledAt,
          worshipLeaderId: users.WORSHIP_LEADER!.id,
          notes: 'Llegar 30 min antes para prueba de sonido',
          setlistId: setlist.id,
        },
      });

      assert.strictEqual(res.statusCode, 201, res.body);
      const data = res.json().data;
      createdServiceIds.add(data.id);
      assert.strictEqual(data.serviceType, 'Reunión de Jóvenes', 'La categoría es texto libre, no un enum fijo');
      assert.strictEqual(data.status, 'DRAFT');
      assert.strictEqual(data.worshipLeaderId, users.WORSHIP_LEADER!.id);
      assert.strictEqual(data.worshipLeaderName, 'WORSHIP_LEADER P2C');
      assert.strictEqual(data.setlistId, setlist.id);
      assert.strictEqual(data.setlist.title, `${PREFIX} Setlist Dominical`);
      assert.strictEqual(new Date(data.scheduledAt).toISOString(), scheduledAt);

      const audit = await pool.query(
        "SELECT user_id FROM audit_logs WHERE event_type = 'WORSHIP_SERVICE_CREATED' AND resource = $1",
        [`worship_service:${data.id}`]
      );
      assert.strictEqual(audit.rows.length, 1);
      assert.strictEqual(audit.rows[0].user_id, users.WORSHIP_LEADER!.id);
    });

    it('1.2 should reject missing name or invalid scheduledAt with 400', async () => {
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: { name: '   ', scheduledAt: new Date().toISOString() },
      });
      assert.strictEqual(r1.statusCode, 400);

      const r2 = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: { name: `${PREFIX} X`, scheduledAt: 'mañana' },
      });
      assert.strictEqual(r2.statusCode, 400);
    });

    it('1.3 should return 404 when linking a non-existent setlist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: {
          name: `${PREFIX} Huérfano`,
          scheduledAt: new Date().toISOString(),
          setlistId: '00000000-0000-4000-8000-000000000000',
        },
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it('1.4 should update, transition status, and unlink setlist', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: { name: `${PREFIX} Vigilia`, scheduledAt: new Date(Date.now() + 86400000).toISOString() },
      });
      const id = created.json().data.id;
      createdServiceIds.add(id);

      const setlist = await createSetlist(`${PREFIX} Setlist Vigilia`);
      const linked = await app.inject({
        method: 'PUT',
        url: `/api/v1/worship-services/${id}`,
        headers: auth('WORSHIP_LEADER'),
        payload: { setlistId: setlist.id, status: 'UPCOMING', notes: 'Ajuste' },
      });
      assert.strictEqual(linked.statusCode, 200, linked.body);
      assert.strictEqual(linked.json().data.setlistId, setlist.id);
      assert.strictEqual(linked.json().data.status, 'UPCOMING');

      const unlinked = await app.inject({
        method: 'PUT',
        url: `/api/v1/worship-services/${id}`,
        headers: auth('WORSHIP_LEADER'),
        payload: { setlistId: null },
      });
      assert.strictEqual(unlinked.statusCode, 200);
      assert.strictEqual(unlinked.json().data.setlistId, null);
      assert.strictEqual(unlinked.json().data.setlist, null);

      const emptyPatch = await app.inject({
        method: 'PUT',
        url: `/api/v1/worship-services/${id}`,
        headers: auth('WORSHIP_LEADER'),
        payload: {},
      });
      assert.strictEqual(emptyPatch.statusCode, 400);
    });

    it('1.5 should filter by timeframe (upcoming vs completed) and serviceType', async () => {
      const past = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: {
          name: `${PREFIX} Pasado`,
          serviceType: `${PREFIX}-Tipo`,
          scheduledAt: new Date(Date.now() - 7 * 86400000).toISOString(),
          status: 'COMPLETED',
        },
      });
      const future = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: {
          name: `${PREFIX} Futuro`,
          serviceType: `${PREFIX}-Tipo`,
          scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      });
      createdServiceIds.add(past.json().data.id);
      createdServiceIds.add(future.json().data.id);

      const upcoming = await app.inject({
        method: 'GET',
        url: `/api/v1/worship-services?timeframe=upcoming&serviceType=${encodeURIComponent(`${PREFIX}-Tipo`)}`,
        headers: auth('VIEWER'),
      });
      assert.strictEqual(upcoming.statusCode, 200);
      assert.deepStrictEqual(upcoming.json().data.map((s: any) => s.name), [`${PREFIX} Futuro`]);

      const completed = await app.inject({
        method: 'GET',
        url: `/api/v1/worship-services?timeframe=completed&serviceType=${encodeURIComponent(`${PREFIX}-Tipo`)}`,
        headers: auth('MUSICIAN'),
      });
      assert.strictEqual(completed.statusCode, 200);
      assert.deepStrictEqual(completed.json().data.map((s: any) => s.name), [`${PREFIX} Pasado`]);
    });

    it('1.6 deleting a linked setlist sets worship_services.setlist_id to NULL (service preserved)', async () => {
      const setlist = await createSetlist(`${PREFIX} Setlist Efímero`);
      const svc = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: { name: `${PREFIX} Con Setlist`, scheduledAt: new Date().toISOString(), setlistId: setlist.id },
      });
      const id = svc.json().data.id;
      createdServiceIds.add(id);

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/setlists/${setlist.id}`, headers: auth('ADMIN') });
      assert.strictEqual(del.statusCode, 200);

      const after = await app.inject({ method: 'GET', url: `/api/v1/worship-services/${id}`, headers: auth('VIEWER') });
      assert.strictEqual(after.statusCode, 200);
      assert.strictEqual(after.json().data.setlistId, null);
    });
  });

  // ==========================================================================
  // 2. RBAC
  // ==========================================================================
  describe('2. Worship Services RBAC Matrix', () => {
    it('2.1 MUSICIAN and VIEWER can read but not create/update/delete (403)', async () => {
      const svc = await app.inject({
        method: 'POST',
        url: '/api/v1/worship-services',
        headers: auth('ADMIN'),
        payload: { name: `${PREFIX} RBAC`, scheduledAt: new Date().toISOString() },
      });
      const id = svc.json().data.id;
      createdServiceIds.add(id);

      for (const role of ['MUSICIAN', 'VIEWER']) {
        const read = await app.inject({ method: 'GET', url: `/api/v1/worship-services/${id}`, headers: auth(role) });
        assert.strictEqual(read.statusCode, 200, `${role} debe poder leer`);

        const create = await app.inject({
          method: 'POST',
          url: '/api/v1/worship-services',
          headers: auth(role),
          payload: { name: `${PREFIX} Prohibido`, scheduledAt: new Date().toISOString() },
        });
        assert.strictEqual(create.statusCode, 403, `${role} no debe crear`);

        const update = await app.inject({
          method: 'PUT',
          url: `/api/v1/worship-services/${id}`,
          headers: auth(role),
          payload: { notes: 'hack' },
        });
        assert.strictEqual(update.statusCode, 403, `${role} no debe actualizar`);

        const del = await app.inject({ method: 'DELETE', url: `/api/v1/worship-services/${id}`, headers: auth(role) });
        assert.strictEqual(del.statusCode, 403, `${role} no debe eliminar`);
      }
    });

    it('2.2 WORSHIP_LEADER cannot delete (403); ADMIN and SUPER_ADMIN can (200, audited)', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const svc = await app.inject({
          method: 'POST',
          url: '/api/v1/worship-services',
          headers: auth('WORSHIP_LEADER'),
          payload: { name: `${PREFIX} Borrable ${i}`, scheduledAt: new Date().toISOString() },
        });
        ids.push(svc.json().data.id);
        createdServiceIds.add(svc.json().data.id);
      }

      const leaderDel = await app.inject({ method: 'DELETE', url: `/api/v1/worship-services/${ids[0]}`, headers: auth('WORSHIP_LEADER') });
      assert.strictEqual(leaderDel.statusCode, 403);

      const adminDel = await app.inject({ method: 'DELETE', url: `/api/v1/worship-services/${ids[0]}`, headers: auth('ADMIN') });
      assert.strictEqual(adminDel.statusCode, 200);
      const superDel = await app.inject({ method: 'DELETE', url: `/api/v1/worship-services/${ids[1]}`, headers: auth('SUPER_ADMIN') });
      assert.strictEqual(superDel.statusCode, 200);

      const audit = await pool.query(
        "SELECT resource FROM audit_logs WHERE event_type = 'WORSHIP_SERVICE_DELETED' AND resource = ANY($1)",
        [ids.map((id) => `worship_service:${id}`)]
      );
      assert.strictEqual(audit.rows.length, 2);
    });

    it('2.3 unauthenticated requests are rejected with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/worship-services' });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  // ==========================================================================
  // 3. DUPLICACIÓN Y PLANTILLAS
  // ==========================================================================
  describe('3. Setlist Duplication & Reusable Templates', () => {
    it('3.1 duplicates items by reference (same songId), preserves order/config, resets status to PLANNING', async () => {
      const source = await createSetlist(`${PREFIX} Origen`);

      const songItem = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/items`,
        headers: auth('WORSHIP_LEADER'),
        payload: {
          itemType: 'SONG',
          songId: canonicalSongId,
          targetKey: 'A',
          targetBpm: 72,
          notesForTeam: 'Intro suave',
          preferredInstrument: 'GUITAR',
          preferredTuning: 'DROP_D',
          preferredFormat: 'TAB',
        },
      });
      assert.strictEqual(songItem.statusCode, 201, songItem.body);
      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/items`,
        headers: auth('WORSHIP_LEADER'),
        payload: { itemType: 'SERVICE_MOMENT', momentTitle: 'Oración', durationMinutes: 5 },
      });

      const dup = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/duplicate`,
        headers: auth('WORSHIP_LEADER'),
        payload: { newTitle: `${PREFIX} Copia`, isTemplate: false },
      });
      assert.strictEqual(dup.statusCode, 201, dup.body);
      const data = dup.json().data;
      createdSetlistIds.add(data.id);

      assert.notStrictEqual(data.id, source.id);
      assert.strictEqual(data.status, 'PLANNING');
      assert.strictEqual(data.items.length, 2);
      assert.deepStrictEqual(data.items.map((i: any) => i.sequenceOrder), [1, 2]);
      assert.strictEqual(data.items[0].songId, canonicalSongId, 'La canción se referencia, no se copia');
      assert.strictEqual(data.items[0].targetKey, 'A');
      assert.strictEqual(data.items[0].preferredTuning, 'DROP_D');
      assert.strictEqual(data.items[0].preferredFormat, 'TAB');
      assert.strictEqual(data.items[1].momentTitle, 'Oración');
      assert.notStrictEqual(data.items[0].id, songItem.json().data.id, 'Los ítems son nuevos registros');

      // El origen queda intacto
      const sourceAfter = await app.inject({ method: 'GET', url: `/api/v1/setlists/${source.id}`, headers: auth('VIEWER') });
      assert.strictEqual(sourceAfter.json().data.items.length, 2);

      const audit = await pool.query(
        "SELECT metadata FROM audit_logs WHERE event_type = 'SETLIST_DUPLICATED' AND resource = $1",
        [`setlist:${data.id}`]
      );
      assert.strictEqual(audit.rows.length, 1);
      assert.strictEqual(audit.rows[0].metadata.sourceSetlistId, source.id);
    });

    it('3.2 saves a duplicate as a reusable template and filters with ?isTemplate=true', async () => {
      const source = await createSetlist(`${PREFIX} Base Plantilla`);
      const dup = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/duplicate`,
        headers: auth('ADMIN'),
        payload: { newTitle: `${PREFIX} Plantilla Santa Cena`, isTemplate: true },
      });
      assert.strictEqual(dup.statusCode, 201);
      createdSetlistIds.add(dup.json().data.id);
      assert.strictEqual(dup.json().data.isTemplate, true);

      const templates = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists?isTemplate=true&limit=100',
        headers: auth('MUSICIAN'),
      });
      assert.strictEqual(templates.statusCode, 200);
      const list = templates.json().data as any[];
      assert.ok(list.every((s) => s.isTemplate === true));
      assert.ok(list.some((s) => s.id === dup.json().data.id));
    });

    it('3.3 duplicate RBAC: MUSICIAN/VIEWER get 403; empty title 400; unknown id 404', async () => {
      const source = await createSetlist(`${PREFIX} RBAC Dup`);
      for (const role of ['MUSICIAN', 'VIEWER']) {
        const r = await app.inject({
          method: 'POST',
          url: `/api/v1/setlists/${source.id}/duplicate`,
          headers: auth(role),
          payload: { newTitle: `${PREFIX} Nope` },
        });
        assert.strictEqual(r.statusCode, 403);
      }
      const empty = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/duplicate`,
        headers: auth('ADMIN'),
        payload: { newTitle: '  ' },
      });
      assert.strictEqual(empty.statusCode, 400);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists/00000000-0000-4000-8000-000000000000/duplicate',
        headers: auth('ADMIN'),
        payload: { newTitle: `${PREFIX} Fantasma` },
      });
      assert.strictEqual(missing.statusCode, 404);
    });

    it('3.4 can duplicate a COMPLETED (read-only) setlist into an editable PLANNING copy', async () => {
      const source = await createSetlist(`${PREFIX} Histórico`);
      await pool.query("UPDATE setlists SET status = 'COMPLETED' WHERE id = $1", [source.id]);
      const dup = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${source.id}/duplicate`,
        headers: auth('WORSHIP_LEADER'),
        payload: { newTitle: `${PREFIX} Reutilizado` },
      });
      assert.strictEqual(dup.statusCode, 201);
      createdSetlistIds.add(dup.json().data.id);
      assert.strictEqual(dup.json().data.status, 'PLANNING');
    });
  });

  // ==========================================================================
  // 4. CONFIGURACIÓN MUSICAL POR ENTRADA
  // ==========================================================================
  describe('4. Per-Entry Musical Configuration (Zero canonical mutation)', () => {
    it('4.1 updates preferred instrument/tuning/format and rejects unknown reading formats', async () => {
      const setlist = await createSetlist(`${PREFIX} Config`);
      const item = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${setlist.id}/items`,
        headers: auth('WORSHIP_LEADER'),
        payload: { itemType: 'SONG', songId: canonicalSongId },
      });
      const itemId = item.json().data.id;
      assert.strictEqual(item.json().data.preferredFormat, null);

      const upd = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${setlist.id}/items/${itemId}`,
        headers: auth('WORSHIP_LEADER'),
        payload: { preferredInstrument: 'BASS', preferredTuning: 'STANDARD', preferredFormat: 'CHORD_SHEET', targetBpm: 90 },
      });
      assert.strictEqual(upd.statusCode, 200, upd.body);
      assert.strictEqual(upd.json().data.preferredInstrument, 'BASS');
      assert.strictEqual(upd.json().data.preferredFormat, 'CHORD_SHEET');

      const bad = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${setlist.id}/items/${itemId}`,
        headers: auth('WORSHIP_LEADER'),
        payload: { preferredFormat: 'MP3' },
      });
      assert.strictEqual(bad.statusCode, 400);
    });

    it('4.2 canonical song row remains byte-identical after all Phase 2C operations', async () => {
      const res = await pool.query('SELECT * FROM songs WHERE id = $1', [canonicalSongId]);
      assert.deepStrictEqual(res.rows[0], canonicalSongSnapshot);
    });
  });
});
