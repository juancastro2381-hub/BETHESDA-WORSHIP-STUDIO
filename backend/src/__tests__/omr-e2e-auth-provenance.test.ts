/**
 * @file omr-e2e-auth-provenance.test.ts
 * @description Suite de pruebas end-to-end (E2E) para verificar la procedencia estricta de autenticación,
 * el aislamiento de usuario (IDOR), la matriz de autorización RBAC y la trazabilidad de auditoría
 * a través de rutas HTTP, servicios de aplicación y repositorios PostgreSQL (R3.1-05).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { db, pool } from '../db/index.ts';
import { users, songs, songVersions, omrProposals, omrAuditHistory } from '../db/schema.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { eq, inArray } from 'drizzle-orm';

describe('R3.1-05: Trazabilidad y Procedencia End-to-End de Autenticación OMR', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;

  let worshipLeaderUser: any;
  let worshipLeaderToken: string;

  let otherLeaderUser: any;
  let otherLeaderToken: string;

  let musicianUser: any;
  let musicianToken: string;

  let viewerUser: any;
  let viewerToken: string;

  let adminUser: any;
  let adminToken: string;

  const createdUserIds = new Set<string>();
  const createdProposalIds = new Set<string>();
  const createdSongIds = new Set<string>();

  before(async () => {
    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();

    app = await buildApp();
    await app.ready();

    const ts = Date.now();

    // 1. Director de Alabanza 1 (Propietario)
    worshipLeaderUser = await userRepo.create({
      email: `e2e-leader-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Leader',
      lastName: 'One',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(worshipLeaderUser.id);
    worshipLeaderToken = tokenService.signAccessToken({
      id: worshipLeaderUser.id,
      email: worshipLeaderUser.email,
      role: worshipLeaderUser.role,
    }).token;

    // 2. Director de Alabanza 2 (Tercero)
    otherLeaderUser = await userRepo.create({
      email: `e2e-other-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Leader',
      lastName: 'Two',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(otherLeaderUser.id);
    otherLeaderToken = tokenService.signAccessToken({
      id: otherLeaderUser.id,
      email: otherLeaderUser.email,
      role: otherLeaderUser.role,
    }).token;

    // 3. Músico
    musicianUser = await userRepo.create({
      email: `e2e-musician-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Musician',
      lastName: 'Bethesda',
      role: 'MUSICIAN',
    });
    createdUserIds.add(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      id: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    // 4. Visualizador (Sin permisos de modificación ni subida)
    viewerUser = await userRepo.create({
      email: `e2e-viewer-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Viewer',
      lastName: 'Bethesda',
      role: 'VIEWER',
    });
    createdUserIds.add(viewerUser.id);
    viewerToken = tokenService.signAccessToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    }).token;

    // 5. Administrador
    adminUser = await userRepo.create({
      email: `e2e-admin-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Admin',
      lastName: 'Bethesda',
      role: 'ADMIN',
    });
    createdUserIds.add(adminUser.id);
    adminToken = tokenService.signAccessToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    }).token;
  });

  after(async () => {
    // Limpieza ordenada respetando ON DELETE RESTRICT
    if (createdProposalIds.size > 0) {
      await db
        .delete(omrAuditHistory)
        .where(inArray(omrAuditHistory.proposalId, Array.from(createdProposalIds)))
        .catch(() => {});
      await db
        .delete(omrProposals)
        .where(inArray(omrProposals.id, Array.from(createdProposalIds)))
        .catch(() => {});
    }

    if (createdSongIds.size > 0) {
      await db
        .delete(songVersions)
        .where(inArray(songVersions.songId, Array.from(createdSongIds)))
        .catch(() => {});
      await db
        .delete(songs)
        .where(inArray(songs.id, Array.from(createdSongIds)))
        .catch(() => {});
    }

    if (createdUserIds.size > 0) {
      await db
        .delete(users)
        .where(inArray(users.id, Array.from(createdUserIds)))
        .catch(() => {});
    }

    await app.close();
  });

  // --------------------------------------------------------------------------
  // 1. INGESTA / SUBIDA OMR (POST /api/v1/omr/upload)
  // --------------------------------------------------------------------------

  it('E2E 1.1: should reject unauthenticated upload with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      payload: {
        filename: 'partitura.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.4 test buffer').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 401);
  });

  it('E2E 1.2: should reject upload with invalid or malformed Bearer token with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: {
        authorization: 'Bearer invalid.token.payload',
      },
      payload: {
        filename: 'partitura.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.4 test buffer').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 401);
  });

  it('E2E 1.3: should reject upload by VIEWER role with 403 Forbidden (RBAC)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: {
        authorization: `Bearer ${viewerToken}`,
      },
      payload: {
        filename: 'partitura.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.4 test buffer').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 403);
  });

  it('E2E 1.4: should process upload by WORSHIP_LEADER and attribute proposal and audit strictly to JWT user', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Sample PDF content for OMR testing');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: {
        authorization: `Bearer ${worshipLeaderToken}`,
      },
      payload: {
        filename: 'hosanna.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.ok(body.data.proposalId);
    assert.equal(body.data.userId, worshipLeaderUser.id);
    assert.equal(body.data.reviewStatus, 'PENDING_REVIEW');
    createdProposalIds.add(body.data.proposalId);

    // Verificar en PostgreSQL que el actor de auditoría es estrictamente el usuario del JWT
    const [audit] = await db
      .select()
      .from(omrAuditHistory)
      .where(eq(omrAuditHistory.proposalId, body.data.proposalId));
    assert.ok(audit);
    assert.equal(audit.userId, worshipLeaderUser.id);
    assert.equal(audit.actionType, 'CREATE_PROPOSAL');
  });

  // --------------------------------------------------------------------------
  // 2. RECUPERACIÓN DE PROPUESTA (GET /api/v1/omr/proposals/:proposalId)
  // --------------------------------------------------------------------------

  it('E2E 2.1: should reject GET proposal belonging to another user with 403 Forbidden (IDOR)', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Private Proposal');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'private.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    // Intentar acceder con un token de otro director de alabanza
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/omr/proposals/${proposalId}`,
      headers: { authorization: `Bearer ${otherLeaderToken}` },
    });

    assert.equal(getRes.statusCode, 403);
  });

  it('E2E 2.2: should allow owner WORSHIP_LEADER to retrieve their proposal with 200 OK', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Owner Proposal');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'owner.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/omr/proposals/${proposalId}`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
    });

    assert.equal(getRes.statusCode, 200);
    const body = JSON.parse(getRes.payload);
    assert.equal(body.data.proposalId, proposalId);
    assert.equal(body.data.userId, worshipLeaderUser.id);
  });

  it('E2E 2.3: should allow ADMIN to retrieve any user proposal with 200 OK', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Admin Accessible Proposal');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'for_admin.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/omr/proposals/${proposalId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.equal(getRes.statusCode, 200);
  });

  // --------------------------------------------------------------------------
  // 3. REVISIÓN HUMANA (POST /api/v1/omr/proposals/:proposalId/review)
  // --------------------------------------------------------------------------

  it('E2E 3.1: should reject review by non-owner with 403 Forbidden', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal for Review Test');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'review_cross.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/review`,
      headers: { authorization: `Bearer ${otherLeaderToken}` },
      payload: {
        status: 'APPROVED_FOR_IMPORT',
        notes: 'Aprobación no autorizada',
      },
    });

    assert.equal(reviewRes.statusCode, 403);
  });

  it('E2E 3.2: should allow owner to approve proposal and record immutable audit', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal Approved By Owner');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'approved_owner.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/review`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        status: 'APPROVED_FOR_IMPORT',
        notes: 'Revisión aprobada para importación',
      },
    });

    assert.equal(reviewRes.statusCode, 200);
    const body = JSON.parse(reviewRes.payload);
    assert.equal(body.data.reviewStatus, 'APPROVED_FOR_IMPORT');

    // Verificar auditoría en PostgreSQL
    const audits = await db
      .select()
      .from(omrAuditHistory)
      .where(eq(omrAuditHistory.proposalId, proposalId));
    assert.ok(audits.some((a) => a.actionType === 'APPROVE_PROPOSAL' && a.userId === worshipLeaderUser.id));
  });

  // --------------------------------------------------------------------------
  // 4. EDICIÓN DE COMPÁS (PATCH /api/v1/omr/proposals/:proposalId/measures/:measureNumber)
  // --------------------------------------------------------------------------

  it('E2E 4.1: should reject measure update of another user proposal with 403 Forbidden', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal for Measure Test');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'measure_cross.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/omr/proposals/${proposalId}/measures/1`,
      headers: { authorization: `Bearer ${otherLeaderToken}` },
      payload: {
        measure: {
          measureNumber: 1,
          timeSignature: '4/4',
          chordsDetected: [],
          notesDetected: [{ step: 'C', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          measureConfidence: 0.95,
          flags: [],
        },
      },
    });

    assert.equal(patchRes.statusCode, 403);
  });

  it('E2E 4.2: should allow owner to update measure and record audit trail', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal for Measure Edit');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'measure_edit.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/omr/proposals/${proposalId}/measures/1`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        measure: {
          measureNumber: 1,
          timeSignature: '4/4',
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'whole', confidence: 0.98 }],
          lyricsDetected: [],
          measureConfidence: 0.98,
          flags: [],
        },
      },
    });

    assert.equal(patchRes.statusCode, 200);

    const audits = await db
      .select()
      .from(omrAuditHistory)
      .where(eq(omrAuditHistory.proposalId, proposalId));
    assert.ok(audits.some((a) => a.actionType === 'UPDATE_MEASURE' && a.userId === worshipLeaderUser.id));
  });

  // --------------------------------------------------------------------------
  // 5. COMPROMISO CANÓNICO ATÓMICO (POST /api/v1/omr/proposals/:proposalId/commit)
  // --------------------------------------------------------------------------

  it('E2E 5.1: should reject commit of another user proposal with 403 Forbidden', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal for Commit Test');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'commit_cross.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/review`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: { status: 'APPROVED_FOR_IMPORT' },
    });

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/commit`,
      headers: { authorization: `Bearer ${otherLeaderToken}` },
      payload: {},
    });

    assert.equal(commitRes.statusCode, 403);
  });

  it('E2E 5.2: should allow owner to commit approved proposal creating canonical song and version', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Proposal for Successful Commit');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'commit_success.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/review`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: { status: 'APPROVED_FOR_IMPORT' },
    });

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/omr/proposals/${proposalId}/commit`,
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {},
    });

    assert.equal(commitRes.statusCode, 201);
    const body = JSON.parse(commitRes.payload);
    assert.ok(body.data.song.id);
    assert.ok(body.data.version.id);
    createdSongIds.add(body.data.song.id);

    // Verificar en PostgreSQL que la propuesta tiene status COMMITTED y canonical_song_id
    const [dbProp] = await db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId));
    assert.equal(dbProp.reviewStatus, 'COMMITTED');
    assert.equal(dbProp.canonicalSongId, body.data.song.id);
  });

  // --------------------------------------------------------------------------
  // 6. CONSULTA DE AUDITORÍA (GET /api/v1/omr/proposals/:proposalId/audit)
  // --------------------------------------------------------------------------

  it('E2E 6.1: should reject audit inspection by unprivileged user (MUSICIAN) with 403 Forbidden', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Audit Inspection Test');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'audit_perm.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/omr/proposals/${proposalId}/audit`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });

    assert.equal(auditRes.statusCode, 403);
  });

  it('E2E 6.2: should allow ADMIN to inspect audit history with 200 OK', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4 Audit Inspection Admin');
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/omr/upload',
      headers: { authorization: `Bearer ${worshipLeaderToken}` },
      payload: {
        filename: 'audit_admin.pdf',
        mimeType: 'application/pdf',
        dataBase64: sampleBuffer.toString('base64'),
      },
    });
    const { proposalId } = JSON.parse(uploadRes.payload).data;
    createdProposalIds.add(proposalId);

    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/omr/proposals/${proposalId}/audit`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.equal(auditRes.statusCode, 200);
    const body = JSON.parse(auditRes.payload);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
  });
});

