/**
 * @file audio.routes.ts
 * @description Endpoints RESTful para la gestión, streaming y descarga de activos de audio (Workstream A).
 */

import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleAudioRepository } from '../../../repositories/audio-repository.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { LocalFileSystemAudioStorageProvider } from '../../../domain/audio/storage-provider.ts';
import { AudioService } from '../../../application/audio-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../../../domain/errors.ts';
import { ROLE_PERMISSIONS, type Permission, type UserRole } from '../../../domain/auth-types.ts';
import { globalStreamTicketService } from '../../../application/stream-ticket-service.ts';
import { globalPythonAudioWorkerBridge } from '../../../infrastructure/python-worker/python-audio-worker-bridge.ts';
import { AudioTranscriptionService } from '../../../application/audio-transcription-service.ts';
import { CanonicalMusicPayload } from '../../../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { Timeline } from '../../../../../frontend/src/core/canonical-model/timeline.ts';
import { TempoMap } from '../../../../../frontend/src/core/canonical-model/tempo-map.ts';
import { CANONICAL_TPQN } from '../../../../../frontend/src/core/canonical-model/types.ts';
import { CanonicalSerializer } from '../../../domain/canonical-serializer.ts';

const AUDIO_UPLOAD_HTTP_BODY_LIMIT = 80 * 1024 * 1024; // 80 MiB (cubre 50 MiB binarios o ~67 MiB Base64)

const UploadAudioBodySchema = z.object({
  title: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  dataBase64: z.string().min(1, 'El contenido de audio en base64 no puede estar vacío'),
  durationSeconds: z.number().int().positive().optional(),
  verifyWithWorker: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

interface NormalizedAudioUploadInput {
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  readonly durationSeconds?: number | undefined;
  readonly verifyWithWorker?: boolean | undefined;
  readonly idempotencyKey?: string | undefined;
}

function parseMultipartFormDataUpload(rawBuffer: Buffer, contentTypeHeader: string): NormalizedAudioUploadInput {
  if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
    throw new ValidationError('El cuerpo multipart/form-data está vacío.', [
      { field: 'body', message: 'El cuerpo multipart no puede estar vacío.' },
    ]);
  }

  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentTypeHeader);
  const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? '').trim();
  if (!boundary) {
    throw new ValidationError('Cabecera Content-Type multipart/form-data inválida: falta parámetro boundary.', [
      { field: 'content-type', message: 'Falta parámetro boundary en multipart/form-data.' },
    ]);
  }

  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const closeDelimiter = Buffer.from(`--${boundary}--`, 'utf8');
  const headerSeparator = Buffer.from('\r\n\r\n', 'utf8');

  if (rawBuffer.indexOf(delimiter) === -1 || rawBuffer.indexOf(closeDelimiter) === -1) {
    throw new ValidationError('Cuerpo multipart/form-data malformado o incompleto (delimitadores ausentes).', [
      { field: 'body', message: 'Delimitadores boundary de apertura o cierre no encontrados.' },
    ]);
  }

  const fields: Record<string, string> = {};
  let fileBuffer: Buffer | null = null;
  let filePartFilename: string | undefined;
  let filePartContentType: string | undefined;

  let cursor = rawBuffer.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (rawBuffer.subarray(partStart, partStart + 2).equals(Buffer.from('--', 'utf8'))) {
      break;
    }

    let contentOffset = partStart;
    if (rawBuffer.subarray(contentOffset, contentOffset + 2).equals(Buffer.from('\r\n', 'utf8'))) {
      contentOffset += 2;
    } else if (rawBuffer[contentOffset] === 0x0a) {
      contentOffset += 1;
    }

    const nextBoundaryIdx = rawBuffer.indexOf(delimiter, contentOffset);
    if (nextBoundaryIdx === -1) {
      throw new ValidationError('Cuerpo multipart/form-data truncado antes del delimitador de cierre.', [
        { field: 'body', message: 'Parte multipart sin cierre de boundary.' },
      ]);
    }

    const headerEndIdx = rawBuffer.indexOf(headerSeparator, contentOffset);
    if (headerEndIdx === -1 || headerEndIdx >= nextBoundaryIdx) {
      throw new ValidationError('Parte multipart/form-data malformada: faltan cabeceras de sección.', [
        { field: 'body', message: 'Cabeceras de parte multipart ausentes o malformadas.' },
      ]);
    }

    const rawHeaders = rawBuffer.subarray(contentOffset, headerEndIdx).toString('utf8');
    let bodyEndIdx = nextBoundaryIdx;
    if (
      bodyEndIdx >= 2 &&
      rawBuffer[bodyEndIdx - 2] === 0x0d &&
      rawBuffer[bodyEndIdx - 1] === 0x0a
    ) {
      bodyEndIdx -= 2;
    } else if (bodyEndIdx >= 1 && rawBuffer[bodyEndIdx - 1] === 0x0a) {
      bodyEndIdx -= 1;
    }

    const partBody = rawBuffer.subarray(headerEndIdx + headerSeparator.length, bodyEndIdx);
    const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(rawHeaders);
    if (!dispositionMatch) {
      throw new ValidationError('Parte multipart/form-data sin cabecera Content-Disposition válida.', [
        { field: 'body', message: 'Falta Content-Disposition: form-data.' },
      ]);
    }

    const dispositionParams = dispositionMatch[1] ?? '';
    const nameMatch = /\bname="([^"]+)"/i.exec(dispositionParams);
    const fieldName = nameMatch?.[1]?.trim();
    if (!fieldName) {
      throw new ValidationError('Parte multipart/form-data sin atributo name.', [
        { field: 'body', message: 'Atributo name requerido en Content-Disposition.' },
      ]);
    }

    const filenameMatch = /\bfilename="([^"]*)"/i.exec(dispositionParams);
    const partMimeMatch = /content-type:\s*([^\r\n;]+)/i.exec(rawHeaders);

    if (filenameMatch !== null || fieldName === 'file' || fieldName === 'audio') {
      if (fieldName !== 'file' && fieldName !== 'audio') {
        throw new ValidationError(
          `Campo de archivo multipart no reconocido: "${fieldName}". Use "file" o "audio".`,
          [{ field: fieldName, message: 'El archivo binario debe enviarse en el campo "file" o "audio".' }]
        );
      }
      fileBuffer = Buffer.from(partBody);
      if (filenameMatch?.[1]?.trim()) {
        filePartFilename = filenameMatch[1].trim();
      }
      if (partMimeMatch?.[1]?.trim()) {
        filePartContentType = partMimeMatch[1].trim();
      }
    } else {
      fields[fieldName] = partBody.toString('utf8').trim();
    }

    cursor = nextBoundaryIdx;
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new ValidationError('Formulario multipart/form-data inválido: falta el archivo binario ("file" o "audio").', [
      { field: 'file', message: 'Se requiere un archivo de audio binario no vacío.' },
    ]);
  }

  const resolvedFilename = (fields['filename'] || filePartFilename || '').trim();
  if (!resolvedFilename || resolvedFilename.length > 255) {
    throw new ValidationError('Falta el nombre de archivo ("filename") en la solicitud multipart.', [
      { field: 'filename', message: 'El nombre de archivo es obligatorio (1-255 caracteres).' },
    ]);
  }

  const resolvedTitle = (fields['title'] || resolvedFilename.replace(/\.[^/.]+$/, '') || resolvedFilename).trim();
  if (!resolvedTitle || resolvedTitle.length > 255) {
    throw new ValidationError('El título del activo de audio ("title") es inválido.', [
      { field: 'title', message: 'El título es obligatorio (1-255 caracteres).' },
    ]);
  }

  const resolvedMimeType = (fields['mimeType'] || filePartContentType || '').trim();
  if (!resolvedMimeType || resolvedMimeType.length > 128) {
    throw new ValidationError('Falta el tipo MIME ("mimeType") del archivo de audio.', [
      { field: 'mimeType', message: 'El tipo MIME es obligatorio.' },
    ]);
  }

  let durationSeconds: number | undefined;
  if (fields['durationSeconds'] !== undefined && fields['durationSeconds'] !== '') {
    const parsedDuration = Number(fields['durationSeconds']);
    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
      throw new ValidationError('El campo "durationSeconds" debe ser un entero positivo.', [
        { field: 'durationSeconds', message: 'Debe ser un entero positivo.' },
      ]);
    }
    durationSeconds = parsedDuration;
  }

  let verifyWithWorker: boolean | undefined;
  if (fields['verifyWithWorker'] !== undefined && fields['verifyWithWorker'] !== '') {
    if (fields['verifyWithWorker'] === 'true' || fields['verifyWithWorker'] === '1') {
      verifyWithWorker = true;
    } else if (fields['verifyWithWorker'] === 'false' || fields['verifyWithWorker'] === '0') {
      verifyWithWorker = false;
    } else {
      throw new ValidationError('El campo "verifyWithWorker" debe ser booleano ("true" o "false").', [
        { field: 'verifyWithWorker', message: 'Valor booleano inválido.' },
      ]);
    }
  }

  const idempotencyKey = fields['idempotencyKey']?.trim() || undefined;

  return {
    title: resolvedTitle,
    filename: resolvedFilename,
    mimeType: resolvedMimeType,
    buffer: fileBuffer,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(verifyWithWorker !== undefined ? { verifyWithWorker } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function normalizeAudioUploadPayload(request: FastifyRequest): NormalizedAudioUploadInput {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase().trim();

  if (contentType.startsWith('multipart/form-data')) {
    if (!Buffer.isBuffer(request.body)) {
      throw new ValidationError('Cuerpo multipart/form-data inválido o ilegible.', [
        { field: 'body', message: 'No se pudo procesar el flujo binario multipart.' },
      ]);
    }
    return parseMultipartFormDataUpload(request.body, String(request.headers['content-type'] ?? ''));
  }

  let rawCandidate: unknown = request.body;
  if (typeof rawCandidate === 'string') {
    const trimmed = rawCandidate.trim();
    if (!trimmed.startsWith('{')) {
      throw new ValidationError(
        'Los datos enviados en la solicitud no cumplen con el esquema requerido (se esperaba un objeto JSON o multipart/form-data).',
        [{ field: 'body', message: 'Expected object, received string' }]
      );
    }
    try {
      rawCandidate = JSON.parse(trimmed);
    } catch {
      throw new ValidationError(
        'El cuerpo de la solicitud contiene JSON malformado.',
        [{ field: 'body', message: 'Invalid JSON payload' }]
      );
    }
  }

  const body = UploadAudioBodySchema.parse(rawCandidate);
  const rawBase64 = body.dataBase64.includes(',')
    ? body.dataBase64.slice(body.dataBase64.indexOf(',') + 1).trim()
    : body.dataBase64.trim();

  if (!rawBase64 || !/^[A-Za-z0-9+/=\s]+$/.test(rawBase64)) {
    throw new ValidationError('El campo "dataBase64" contiene caracteres fuera del alfabeto Base64 estándar.', [
      { field: 'dataBase64', message: 'Codificación Base64 inválida.' },
    ]);
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length === 0) {
    throw new ValidationError('El contenido de audio decodificado está vacío.', [
      { field: 'dataBase64', message: 'El buffer decodificado tiene 0 bytes.' },
    ]);
  }

  const idempotencyHeader =
    typeof request.headers['x-idempotency-key'] === 'string'
      ? request.headers['x-idempotency-key'].trim()
      : undefined;

  return {
    title: body.title,
    filename: body.filename,
    mimeType: body.mimeType,
    buffer,
    ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
    ...(body.verifyWithWorker !== undefined ? { verifyWithWorker: body.verifyWithWorker } : {}),
    ...((body.idempotencyKey ?? idempotencyHeader)
      ? { idempotencyKey: body.idempotencyKey ?? idempotencyHeader }
      : {}),
  };
}

const SongIdParamSchema = z.object({
  songId: z.string().uuid(),
});

const AudioIdParamSchema = z.object({
  id: z.string().uuid(),
});

const AudioDraftParamSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
});

const AudioDraftExportParamSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  format: z.enum(['CHORD_PRO', 'MUSIC_XML', 'MIDI', 'TABLATURE', 'LYRICS_ONLY']),
});

const SupportedInstrumentSchema = z.enum(['GUITAR', 'BASS', 'PIANO', 'VOCAL']);

const AnalyzeAudioBodySchema = z
  .object({
    verifiedLyrics: z.string().max(20000).optional(),
    selectedInstrument: SupportedInstrumentSchema.optional(),
    titleOverride: z.string().min(1).max(255).optional(),
    keyOverride: z.string().max(16).optional(),
    bpmOverride: z.number().int().min(20).max(300).optional(),
    timeSignatureOverride: z.string().max(16).optional(),
  })
  .default({});

const UpdateAudioDraftBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  key: z.string().max(16).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  timeSignature: z.string().max(16).optional(),
  proposedChordPro: z.string().max(100000).optional(),
  verifiedLyrics: z.string().max(20000).optional(),
  selectedInstrument: SupportedInstrumentSchema.optional(),
  reason: z.string().max(1000).optional(),
});

const ReviewAudioDraftBodySchema = z.object({
  decision: z.enum(['REJECTED', 'CORRECTION_REQUESTED', 'APPROVED_FOR_IMPORT']),
  notes: z.string().max(1000).optional(),
});

const ApproveAudioDraftBodySchema = z
  .object({
    targetSongId: z.string().uuid().optional(),
    versionName: z.string().min(1).max(255).optional(),
    versionDescription: z.string().max(1000).optional(),
    setAsCurrent: z.boolean().optional(),
    reviewNotes: z.string().max(1000).optional(),
  })
  .default({});

const CreateAudioDraftSongBodySchema = z.object({
  title: z.string().min(1).max(255),
  artist: z.string().max(255).optional(),
});

const ReconcileRecoveryBodySchema = z
  .object({
    purgeOrphanFiles: z.boolean().optional().default(false),
    recoverFailedOperations: z.boolean().optional().default(true),
    minOrphanAgeMs: z.number().int().nonnegative().optional().default(60_000),
  })
  .default({
    purgeOrphanFiles: false,
    recoverFailedOperations: true,
    minOrphanAgeMs: 60_000,
  });

export const globalAudioService = new AudioService(
  new DrizzleAudioRepository(),
  new LocalFileSystemAudioStorageProvider(env.AUDIO_STORAGE_PATH, env.MAX_AUDIO_FILE_SIZE_BYTES),
  new DrizzleSongRepository(),
  env.MAX_AUDIO_FILE_SIZE_BYTES,
  globalPythonAudioWorkerBridge
);

export const globalAudioTranscriptionService = new AudioTranscriptionService(
  new LocalFileSystemAudioStorageProvider(env.AUDIO_STORAGE_PATH, env.MAX_AUDIO_FILE_SIZE_BYTES),
  globalPythonAudioWorkerBridge
);

export const audioRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const audioService = globalAudioService;

  fastify.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: AUDIO_UPLOAD_HTTP_BODY_LIMIT },
    (_req, body, done) => {
      done(null, body);
    }
  );

  /**
   * Valida en tiempo real contra PostgreSQL que el usuario dueño del ticket o Bearer token
   * sigue existiendo, está ACTIVE, no está bloqueado y conserva el permiso requerido.
   */
  async function verifyActiveAuthorizedStreamUser(
    userId: string,
    requiredPermission: Permission = 'songs:read'
  ): Promise<void> {
    const dbUser = await userRepo.findById(userId);
    if (!dbUser) {
      globalStreamTicketService.revokeTicketsForUser(userId);
      throw new UnauthorizedError('Usuario no encontrado o dado de baja en la base de datos.');
    }

    if (dbUser.accountStatus !== 'ACTIVE') {
      globalStreamTicketService.revokeTicketsForUser(userId);
      throw new ForbiddenError(
        `Su cuenta se encuentra en estado '${dbUser.accountStatus}'. Operación denegada.`
      );
    }

    if (dbUser.lockoutUntil && dbUser.lockoutUntil.getTime() > Date.now()) {
      globalStreamTicketService.revokeTicketsForUser(userId);
      throw new ForbiddenError('La cuenta se encuentra temporalmente bloqueada por seguridad.');
    }

    const userPermissions = ROLE_PERMISSIONS[dbUser.role as UserRole] || [];
    if (!userPermissions.includes(requiredPermission)) {
      globalStreamTicketService.revokeTicketsForUser(userId);
      throw new ForbiddenError(
        `Acceso denegado: Su rol actual (${dbUser.role}) no posee el permiso '${requiredPermission}'.`
      );
    }
  }

  // 1. POST /api/v1/songs/:songId/audio - Subir activo de audio (Líderes y Administradores)
  fastify.post(
    '/songs/:songId/audio',
    {
      bodyLimit: AUDIO_UPLOAD_HTTP_BODY_LIMIT,
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const operationId = crypto.randomUUID();
      const { songId } = SongIdParamSchema.parse(request.params);
      const normalized = normalizeAudioUploadPayload(request);
      const userId = request.user?.sub;

      request.log.info(
        {
          event: 'AUDIO_PRESERVATION_STARTED',
          operationId,
          requestId: request.id,
          songId,
          userId: userId ?? null,
          filename: normalized.filename,
          mimeType: normalized.mimeType,
          declaredSizeBytes: normalized.buffer.length,
        },
        'Iniciando preservación de activo de audio (WS-AUDIO-01).'
      );

      try {
        const created = await audioService.uploadAudio({
          songId,
          title: normalized.title,
          filename: normalized.filename,
          mimeType: normalized.mimeType,
          buffer: normalized.buffer,
          durationSeconds: normalized.durationSeconds,
          uploadedByUserId: userId,
          verifyWithPythonWorker: normalized.verifyWithWorker,
          idempotencyKey: normalized.idempotencyKey,
        });

        request.log.info(
          {
            event: 'AUDIO_PRESERVATION_COMPLETED',
            operationId,
            requestId: request.id,
            songId,
            audioId: created.id,
            userId: userId ?? null,
            filename: created.filename,
            mimeType: created.mimeType,
            fileSizeBytes: created.fileSizeBytes,
            checksumSha256: created.checksumSha256,
          },
          'Activo de audio preservado exitosamente.'
        );

        return reply.status(201).send({
          data: created,
        });
      } catch (err) {
        request.log.warn(
          {
            event: 'AUDIO_PRESERVATION_REJECTED',
            operationId,
            requestId: request.id,
            songId,
            userId: userId ?? null,
            filename: normalized.filename,
            mimeType: normalized.mimeType,
            declaredSizeBytes: normalized.buffer.length,
            errorCode: (err as { code?: string })?.code ?? 'UNKNOWN_ERROR',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          'Solicitud de preservación de audio rechazada o fallida.'
        );
        throw err;
      }
    }
  );

  // 2. GET /api/v1/songs/:songId/audio - Listar audios de una canción (Autenticado)
  fastify.get(
    '/songs/:songId/audio',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { songId } = SongIdParamSchema.parse(request.params);
      const audios = await audioService.getAudiosBySongId(songId);

      return reply.status(200).send({
        data: audios,
      });
    }
  );

  // 3. GET /api/v1/audio/:id/download - Descargar audio completo
  fastify.get(
    '/audio/:id/download',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const file = await audioService.downloadAudio(id);

      reply.header('Content-Type', file.mimeType);
      reply.header('Content-Length', file.fileSizeBytes);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      reply.header('Cache-Control', 'private, no-cache');
      if (file.checksumSha256) {
        reply.header('X-Checksum-Sha256', file.checksumSha256);
        reply.header('ETag', `"${file.checksumSha256}"`);
      }

      return reply.status(200).send(file.buffer);
    }
  );

  // 3b. GET /api/v1/audio/:id - Metadatos de un activo de audio
  fastify.get(
    '/audio/:id',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const asset = await audioService.getAudioById(id);

      return reply.status(200).send({
        data: asset,
      });
    }
  );

  // 4a. POST /api/v1/audio/:id/ticket - Emitir ticket temporal para streaming de audio en <audio>
  fastify.post(
    '/audio/:id/ticket',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const user = request.user!;

      // Validar que el activo exista
      await audioService.getAudioById(id);

      const ticket = globalStreamTicketService.issueTicket({
        userId: user.sub,
        role: user.role,
        resourceId: id,
        purpose: 'AUDIO_STREAM',
      });

      return reply.status(200).send({
        data: {
          ticket,
          expiresInSeconds: 60,
        },
      });
    }
  );

  // 4b. GET /api/v1/audio/:id/stream - Streaming con soporte Range (HTTP 206 / 200)
  fastify.get(
    '/audio/:id/stream',
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const rangeHeader = request.headers.range;
      const ticketQuery = (request.query as any)?.ticket as string | undefined;

      let authenticatedUserId: string | null = null;

      if (ticketQuery) {
        // Validar ticket multimedia sin quemar inmediatamente para permitir Range requests sucesivos durante seeking
        const ticketData = globalStreamTicketService.consumeTicket(
          {
            ticket: ticketQuery,
            resourceId: id,
            purpose: 'AUDIO_STREAM',
          },
          false
        );
        authenticatedUserId = ticketData.userId;
      } else {
        await authGuard.authenticate(request, reply);
        if (request.user) {
          authenticatedUserId = request.user.sub;
        }
      }

      if (!authenticatedUserId) {
        throw new UnauthorizedError(
          'Autenticación requerida para streaming de audio. Provea un ticket de reproducción o encabezado Bearer.'
        );
      }

      // Verificar en tiempo real contra PostgreSQL que el usuario siga activo, desbloqueado y autorizado
      await verifyActiveAuthorizedStreamUser(authenticatedUserId, 'songs:read');

      const streamResult = await audioService.streamAudio(id, rangeHeader);

      for (const [headerName, headerVal] of Object.entries(streamResult.headers)) {
        reply.header(headerName, headerVal);
      }

      return reply.status(streamResult.statusCode).send(streamResult.stream);
    }
  );

  // 4c. POST /api/v1/audio/:id/verify - Verificación binaria profunda y PCM vía worker Python local
  fastify.post(
    '/audio/:id/verify',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const report = await audioService.inspectAndVerifyStoredAudio(id);

      return reply.status(200).send({
        status: 'success',
        data: report,
      });
    }
  );

  // 4d. GET /api/v1/audio/recovery/status - Estado observable de recuperación al arranque y reconciliación
  fastify.get(
    '/audio/recovery/status',
    {
      preHandler: [authGuard.requirePermission('audit:read', true)],
    },
    async (_request, reply) => {
      const recoveryRecords = audioService.getRecoveryRecords();
      return reply.status(200).send({
        status: 'success',
        data: {
          startupRecovery: audioService.getLastStartupRecoveryStatus(),
          pendingRecoveryRecords: recoveryRecords.filter((r) => r.status === 'PENDING_RECOVERY'),
          manualInterventionRecords: recoveryRecords.filter(
            (r) => r.status === 'MANUAL_INTERVENTION_REQUIRED'
          ),
          recoveryRecords,
          malformedRecoveryEvents: audioService.getMalformedRecoveryAuditEntries(),
          lastReconciliationReport: audioService.getLastReconciliationReport(),
        },
      });
    }
  );

  // 4e. POST /api/v1/audio/recovery/reconcile - Ejecución administrativa idempotente y serializada
  fastify.post(
    '/audio/recovery/reconcile',
    {
      preHandler: [authGuard.requirePermission('audit:read', true)],
    },
    async (request, reply) => {
      const options = ReconcileRecoveryBodySchema.parse(request.body ?? {});
      const report = await audioService.reconcileStorageConsistency(options);

      request.log.info(
        {
          event: 'AUDIO_ADMIN_RECOVERY_RECONCILED',
          actorUserId: request.user?.sub ?? null,
          purgeOrphanFiles: options.purgeOrphanFiles,
          recoverFailedOperations: options.recoverFailedOperations,
          rehydrationSucceeded: report.rehydrationReport.rehydrationSucceeded,
          recoveredCount: report.recoveredOperations.length,
          purgedOrphansCount: report.purgedOrphanFiles.length,
          pendingRecoveryCount: report.pendingRecoveryRecords.length,
          manualInterventionCount: report.manualInterventionRecords.length,
          malformedEventsCount: report.malformedRecoveryEvents.length,
        },
        'Reconciliación administrativa de almacenamiento de audio ejecutada.'
      );

      return reply.status(200).send({
        status: 'success',
        data: report,
      });
    }
  );

  // 5. DELETE /api/v1/audio/:id - Eliminar activo de audio físico y en BD (Control Anti-IDOR)
  fastify.delete(
    '/audio/:id',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const user = request.user!;

      // Anti-IDOR: verificar propiedad o privilegios de administración
      const asset = await audioService.getAudioById(id);
      const isPrivileged = user.role === 'SUPER_ADMIN' || user.role === 'WORSHIP_LEADER';
      const isOwner = asset.uploadedByUserId === user.sub;

      if (!isPrivileged && !isOwner) {
        throw new ForbiddenError(
          'No tiene autorización para eliminar un recurso de audio registrado por otro usuario.'
        );
      }

      const deleted = await audioService.deleteAudio(id, user.sub);

      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Activo de audio con ID ${id} no encontrado.`,
        });
      }

      return reply.status(204).send();
    }
  );

  // =========================================================================
  // WS-AUDIO-02, WS-AUDIO-03 & GATE 4 HUMAN REVIEW ENDPOINTS
  // =========================================================================

  // 6. POST /api/v1/audio/songs/draft - Crear contenedor de canción en estado DRAFT para asociar nuevo audio sin inventar notación
  fastify.post(
    '/audio/songs/draft',
    {
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const body = CreateAudioDraftSongBodySchema.parse(request.body);
      const songRepo = new DrizzleSongRepository();
      const emptyTimeline = new Timeline({
        tpqn: CANONICAL_TPQN,
        tempoMap: new TempoMap([]),
        measureCount: 0,
        totalDurationTicks: 0,
      });
      const placeholderCanonical = new CanonicalMusicPayload({
        title: body.title.trim(),
        timeline: emptyTimeline,
        sections: [],
        measures: [],
        instrumentTracks: [],
        metadata: {
          isAudioContainerDraft: true,
          approvalStatus: 'AUDIO_PRESERVED',
          ...(body.artist ? { artist: body.artist.trim() } : {}),
        },
      });
      const created = await songRepo.create({
        title: body.title.trim(),
        artist: body.artist?.trim() ?? null,
        defaultKey: null,
        defaultBpm: null,
        timeSignature: null,
        status: 'DRAFT',
        versionName: 'Contenedor de Audio (Sin Transcribir)',
        versionDescription: 'Canción creada para asociar grabación de audio original (Cero Fabricación).',
        sourceFormat: 'INTERNAL',
        canonicalPayload: CanonicalSerializer.serialize(placeholderCanonical),
      });

      return reply.status(201).send({
        data: created,
      });
    }
  );

  // 7. POST /api/v1/audio/:id/analyze - Ejecutar análisis Python (WS-AUDIO-02) y transcripción a borradores (WS-AUDIO-03)
  fastify.post(
    '/audio/:id/analyze',
    {
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const body = AnalyzeAudioBodySchema.parse(request.body ?? {});
      const user = request.user!;

      const draft = await globalAudioTranscriptionService.analyzeAndTranscribeAudioAsset(
        id,
        {
          id: user.sub,
          role: user.role,
          email: user.email,
        },
        body
      );

      return reply.status(201).send({
        data: draft,
      });
    }
  );

  // 8. GET /api/v1/audio/:id/drafts - Listar borradores de transcripción de un activo de audio
  fastify.get(
    '/audio/:id/drafts',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const user = request.user!;
      const drafts = await globalAudioTranscriptionService.listDraftsByAudioAsset(id, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });

      return reply.status(200).send({
        data: drafts,
      });
    }
  );

  // 9. GET /api/v1/songs/:songId/audio-drafts - Listar borradores derivados de audio para una canción
  fastify.get(
    '/songs/:songId/audio-drafts',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { songId } = SongIdParamSchema.parse(request.params);
      const user = request.user!;
      const drafts = await globalAudioTranscriptionService.listDraftsBySongId(songId, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });

      return reply.status(200).send({
        data: drafts,
      });
    }
  );

  // 10. GET /api/v1/audio/:id/drafts/:proposalId - Obtener borrador de audio específico
  fastify.get(
    '/audio/:id/drafts/:proposalId',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id, proposalId } = AudioDraftParamSchema.parse(request.params);
      const user = request.user!;
      const draft = await globalAudioTranscriptionService.getDraftById(id, proposalId, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });

      return reply.status(200).send({
        data: draft,
      });
    }
  );

  // 11. PATCH /api/v1/audio/:id/drafts/:proposalId - Editar borrador propuesto durante Revisión Humana
  fastify.patch(
    '/audio/:id/drafts/:proposalId',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { id, proposalId } = AudioDraftParamSchema.parse(request.params);
      const body = UpdateAudioDraftBodySchema.parse(request.body ?? {});
      const user = request.user!;

      const updated = await globalAudioTranscriptionService.updateDraft(id, proposalId, body, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });

      return reply.status(200).send({
        data: updated,
      });
    }
  );

  // 12. POST /api/v1/audio/:id/drafts/:proposalId/review - Registrar decisión de revisión (REJECTED / CORRECTION_REQUESTED / APPROVED_FOR_IMPORT)
  fastify.post(
    '/audio/:id/drafts/:proposalId/review',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { id, proposalId } = AudioDraftParamSchema.parse(request.params);
      const body = ReviewAudioDraftBodySchema.parse(request.body);
      const user = request.user!;

      const reviewed = await globalAudioTranscriptionService.reviewDraftDecision(
        id,
        proposalId,
        body.decision,
        {
          id: user.sub,
          role: user.role,
          email: user.email,
        },
        body.notes
      );

      return reply.status(200).send({
        data: reviewed,
      });
    }
  );

  // 13. POST /api/v1/audio/:id/drafts/:proposalId/approve - Aprobar borrador y publicar nueva versión controlada en song_versions
  fastify.post(
    '/audio/:id/drafts/:proposalId/approve',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { id, proposalId } = AudioDraftParamSchema.parse(request.params);
      const body = ApproveAudioDraftBodySchema.parse(request.body ?? {});
      const user = request.user!;

      const result = await globalAudioTranscriptionService.approveAndPublishDraft(
        id,
        proposalId,
        body,
        {
          id: user.sub,
          role: user.role,
          email: user.email,
        }
      );

      return reply.status(201).send({
        data: result,
      });
    }
  );

  // 14. GET /api/v1/audio/:id/drafts/:proposalId/export/:format - Exportar artefacto de un formato objetivo si es generable
  fastify.get(
    '/audio/:id/drafts/:proposalId/export/:format',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { id, proposalId, format } = AudioDraftExportParamSchema.parse(request.params);
      const instrumentQuery = (request.query as Record<string, unknown>)?.['instrument'];
      const parsedInstrument = SupportedInstrumentSchema.safeParse(instrumentQuery);
      const user = request.user!;

      const artifact = await globalAudioTranscriptionService.exportDraftArtifact(
        id,
        proposalId,
        format,
        parsedInstrument.success ? parsedInstrument.data : undefined,
        {
          id: user.sub,
          role: user.role,
          email: user.email,
        }
      );

      return reply.status(200).send({
        data: artifact,
      });
    }
  );
};
