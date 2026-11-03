/**
 * @file omr-service.ts
 * @description Servicio de aplicación para Reconocimiento Óptico de Música (OMR) y flujo de revisión humana (Fase 1A-R3).
 *
 * Principios y Políticas Mandatorias:
 * 1. La salida de IA es SIEMPRE una propuesta preliminar con isAiDraft: true.
 * 2. CERO invención o sustitución arbitraria de notas (CERO fallback silencioso a Do Mayor / 4/4 / 120 BPM).
 * 3. CERO fabricación de silencios de compás vacío (R3-03): silencios solo si OMR los detecta explícitamente (isRest: true).
 * 4. Persistencia MANDATORIA y confiable en PostgreSQL mediante OmrProposalRepository (CERO swallow de errores DB).
 * 5. PostgreSQL es la ÚNICA fuente de verdad autoritativa (R3-04): CERO fallback a memoria cuando DB retorna null.
 * 6. Integridad atómica en revisión y compromiso canónico en una sola transacción PostgreSQL con ON DELETE RESTRICT (R3-05, R3-06).
 * 7. Trazabilidad inmutable mediante hash SHA-256 e historial de auditoría incondicionalmente inmutable (R3-02).
 * 8. Principales de identidad obligatorios y validados AuthenticatedUser en todas las operaciones (R3-01).
 * 9. Política de archivo unificada y coherente a 15 MB.
 */

import { z } from 'zod';
import { type IOmrProvider, validateOmrFileSignature } from '../domain/omr/omr-provider.ts';
import {
  type OmrProposal,
  type OmrRecognitionInput,
  type OmrMeasureProposal,
  type OmrReviewStatus,
  type OmrNoteDetected,
  type OmrChordDetected,
  type OmrLyricDetected,
  type AuthenticatedUser,
  type OmrAuditEntry,
  type CreateOmrAuditEntryInput,
  MAX_OMR_FILE_SIZE_BYTES,
} from '../domain/omr/types.ts';
import type { ISongRepository, SongWithVersion } from '../repositories/song-repository.ts';
import {
  type IOmrProposalRepository,
  DrizzleOmrProposalRepository,
} from '../repositories/omr-proposal-repository.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { TimeSignature } from '../../../frontend/src/core/canonical-model/time-signature.ts';
import { KeySignatureReference } from '../../../frontend/src/core/canonical-model/key-signature-reference.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { TempoEvent, TempoMap } from '../../../frontend/src/core/canonical-model/tempo-map.ts';
import { ChordEvent } from '../../../frontend/src/core/canonical-model/chord-event.ts';
import { Note, Rest, Voice } from '../../../frontend/src/core/canonical-model/musical-event.ts';
import { LyricSyllable } from '../../../frontend/src/core/canonical-model/lyric-syllable.ts';
import { CANONICAL_TPQN } from '../../../frontend/src/core/canonical-model/types.ts';
import { Chord } from '../../../frontend/src/core/music-theory/chord.ts';
import { MusicalKey } from '../../../frontend/src/core/music-theory/musical-key.ts';
import { type BaseNoteLetter, NoteName } from '../../../frontend/src/core/music-theory/note-name.ts';
import { Pitch } from '../../../frontend/src/core/music-theory/pitch.ts';
import { Accidental } from '../../../frontend/src/core/music-theory/accidental.ts';
import type { CreateSongDTO } from '../domain/types.ts';

// Schema de validación Zod unificado con el límite estricto de 15MB
export const OmrRecognitionInputSchema = z.object({
  filename: z.string().min(1, 'El nombre de archivo es obligatorio'),
  mimeType: z.string().min(1, 'El tipo MIME es obligatorio'),
  fileSizeBytes: z
    .number()
    .int()
    .positive('El tamaño del archivo debe ser mayor a 0 bytes')
    .max(MAX_OMR_FILE_SIZE_BYTES, `El archivo excede el tamaño máximo permitido de 15MB`),
});

// Schema de validación Zod para confirmación al catálogo canónico
export const CommitToSongOverridesSchema = z
  .object({
    title: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    timeSignature: z.string().min(1).optional(),
    bpm: z.number().int().positive().optional(),
  })
  .optional();

/**
 * Validador estricto del principal de autenticación (R3-01).
 * CERO adivinación / CERO fabricación de identidad por defecto.
 */
function assertAuthenticatedUser(user: unknown): asserts user is AuthenticatedUser {
  if (
    !user ||
    typeof user !== 'object' ||
    typeof (user as any).id !== 'string' ||
    !(user as any).id.trim() ||
    typeof (user as any).role !== 'string' ||
    !(user as any).role.trim()
  ) {
    throw new UnauthorizedError('Authentication principal is required');
  }
  const VALID_ROLES = ['ADMIN', 'SUPER_ADMIN', 'WORSHIP_LEADER', 'MUSICIAN'];
  if (!VALID_ROLES.includes((user as any).role)) {
    throw new ForbiddenError(`Rol de usuario '${(user as any).role}' no reconocido o no autorizado.`);
  }
}

const VALID_NOTE_LETTERS: ReadonlySet<string> = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/**
 * Valida de forma estricta la letra base del paso de nota (step) sin ningún fallback silencioso a C (R3.1-03).
 * Acepta únicamente letras A, B, C, D, E, F, G y rechaza vacíos, nulos o caracteres desconocidos.
 */
export function validateAndParseNoteStep(step: unknown): BaseNoteLetter {
  if (typeof step !== 'string') {
    throw new ValidationError('El paso de nota musical (step) debe ser una cadena de texto no vacía.');
  }
  const trimmed = step.trim().toUpperCase();
  if (!trimmed) {
    throw new ValidationError('El paso de nota musical (step) no puede ser una cadena vacía.');
  }
  const firstChar = trimmed[0];
  if (!firstChar || !VALID_NOTE_LETTERS.has(firstChar)) {
    throw new ValidationError(
      `Paso de nota musical inválido: "${step}". Letras base permitidas: A, B, C, D, E, F, G. Se prohíbe la fabricación de notas.`
    );
  }
  return firstChar as BaseNoteLetter;
}

export class OmrService {
  private proposals: Map<string, OmrProposal>;
  private provider: IOmrProvider;
  private songRepo: ISongRepository;
  private omrRepo: IOmrProposalRepository;
  private pendingProposalWrites: Map<string, Promise<void>> = new Map();

  constructor(
    provider: IOmrProvider,
    songRepo: ISongRepository,
    omrRepo?: IOmrProposalRepository
  ) {
    this.proposals = new Map();
    this.provider = provider;
    this.songRepo = songRepo;
    this.omrRepo = omrRepo ?? new DrizzleOmrProposalRepository();
  }

  public setOmrRepository(repo: IOmrProposalRepository): void {
    this.omrRepo = repo;
  }

  /**
   * Procesa un archivo de partitura y genera una propuesta preliminar (AI Draft).
   * Requiere un principal de autenticación explícito (R3-01).
   * La persistencia en PostgreSQL es OBLIGATORIA: si falla, la operación fracasa (R1).
   */
  public async processUpload(
    input: OmrRecognitionInput,
    userOrUserId: AuthenticatedUser | string,
    jobId?: string,
    requestingUser?: AuthenticatedUser
  ): Promise<OmrProposal> {
    let effectiveUser: AuthenticatedUser;
    if (typeof userOrUserId === 'object' && userOrUserId !== null) {
      effectiveUser = userOrUserId as AuthenticatedUser;
    } else {
      effectiveUser = requestingUser as AuthenticatedUser;
    }
    assertAuthenticatedUser(effectiveUser);

    // 1. Validación estricta del input mediante Zod (coherente a 15MB)
    const validationResult = OmrRecognitionInputSchema.safeParse({
      filename: input.filename,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
    });
    if (!validationResult.success) {
      const errMsgs = validationResult.error.errors.map((e) => e.message).join(', ');
      throw new ValidationError(`Validación de entrada OMR fallida: ${errMsgs}`);
    }

    // Validación de coincidencia de buffer y tamaño declarado
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer suministrado para OMR está vacío (0 bytes).');
    }

    if (input.buffer.length !== input.fileSizeBytes) {
      throw new ValidationError(
        `Inconsistencia en metadatos de archivo: el tamaño de buffer real (${input.buffer.length} bytes) no coincide con el tamaño declarado (${input.fileSizeBytes} bytes).`
      );
    }

    if (input.buffer.length > MAX_OMR_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `El archivo para reconocimiento OMR excede el límite máximo permitido de 15 MB.`
      );
    }

    // Validación estricta de firma mágica binaria (magic bytes)
    validateOmrFileSignature(input.buffer, input.mimeType);

    // 2. Ejecutar reconocimiento con el motor/proveedor
    const proposal = await this.provider.recognize(input);
    proposal.userId = effectiveUser.id;
    if (jobId) {
      proposal.jobId = jobId;
    }

    // 3. Evaluar umbrales de confianza musical e integridad de compases (R3-03)
    for (const m of proposal.measures) {
      m.flags = m.flags ?? [];
      if (m.measureConfidence < 0.7) {
        if (!m.flags.includes('LOW_CONFIDENCE')) {
          m.flags.push('LOW_CONFIDENCE');
        }
      }
      if (m.chordsDetected && m.chordsDetected.length > 0) {
        for (const c of m.chordsDetected) {
          try {
            Chord.parse(c.chord);
          } catch {
            const flag = `UNPARSED_CHORD:${c.chord}`;
            if (!m.flags.includes(flag)) {
              m.flags.push(flag);
            }
          }
        }
      }
      if (!m.notesDetected || m.notesDetected.length === 0) {
        // R3-03: Compás sin notas ni silencios explícitos reconocidos
        if (!m.flags.includes('UNRESOLVED_MEASURE_CONTENT')) {
          m.flags.push('UNRESOLVED_MEASURE_CONTENT');
        }
      } else {
        for (const n of m.notesDetected) {
          if (n.isRest) {
            continue; // Silencio explícito reconocido
          }
          try {
            const letter = validateAndParseNoteStep(n.step);
            if (typeof n.alter === 'number') {
              const acc = Accidental.fromSemitones(n.alter);
              new NoteName(letter, acc);
            } else {
              NoteName.parse(n.step);
            }
          } catch {
            const flag = `UNRESOLVED_NOTE_GLYPH:${n.step ?? 'EMPTY'}`;
            if (!m.flags.includes(flag)) {
              m.flags.push(flag);
            }
          }
        }
      }
    }

    // 4. Persistir MANDATORIAMENTE en PostgreSQL (CERO tolerancia a fallos silenciosos)
    await this.omrRepo.saveProposal(proposal, effectiveUser);

    // 5. Solo tras persistencia durable exitosa en BD se indexa en caché L1
    this.proposals.set(proposal.proposalId, proposal);

    return proposal;
  }

  /**
   * Obtiene una propuesta OMR por ID de manera autoritativa asíncrona directamente desde PostgreSQL (R3.1-02).
   * La recuperación síncrona exclusiva de memoria ha sido ELIMINADA para garantizar PostgreSQL como ÚNICA fuente de verdad.
   * Si PostgreSQL retorna null, se desaloja la memoria caché y se lanza NotFoundError.
   * Si la base de datos no está disponible, propaga el error sin retornar datos obsoletos de memoria.
   */
  public async getProposal(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<OmrProposal> {
    return await this.getProposalAsync(proposalId, requestingUser);
  }

  /**
   * Obtiene una propuesta OMR por ID de manera asíncrona con semántica Database-First estricta (R3-04).
   * PostgreSQL es la ÚNICA fuente de verdad autoritativa.
   * Si PostgreSQL retorna null, se desaloja la caché L1 y se lanza NotFoundError (CERO fallback a memoria).
   */
  public async getProposalAsync(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<OmrProposal> {
    assertAuthenticatedUser(requestingUser);

    const pendingWrite = this.pendingProposalWrites.get(proposalId);
    if (pendingWrite) {
      await pendingWrite;
    }

    // 1. Consultar PostgreSQL autoritativo
    const dbProposal = await this.omrRepo.findProposalById(proposalId, requestingUser);
    if (dbProposal) {
      this.proposals.set(dbProposal.proposalId, dbProposal);
      return dbProposal;
    }

    // 2. Strict DB source of truth (R3-04): Desalojar de caché si existiera y lanzar NotFoundError
    this.proposals.delete(proposalId);
    throw new NotFoundError('Propuesta OMR', proposalId);
  }

  /**
   * Aplica revisión humana a una propuesta OMR con confirmación de persistencia obligatoria en PostgreSQL.
   * Requiere AuthenticatedUser explícito (R3-01).
   */
  public async reviewProposal(
    proposalId: string,
    statusOrUserId: string,
    userOrStatus: OmrReviewStatus | AuthenticatedUser,
    reasonOrUser?: string | AuthenticatedUser,
    maybeUser?: AuthenticatedUser
  ): Promise<OmrProposal> {
    let status: OmrReviewStatus;
    let requestingUser: AuthenticatedUser;
    let reason: string | undefined;

    if (statusOrUserId === 'APPROVED_FOR_IMPORT' || statusOrUserId === 'REJECTED') {
      status = statusOrUserId as OmrReviewStatus;
      requestingUser = userOrStatus as AuthenticatedUser;
      reason = typeof reasonOrUser === 'string' ? reasonOrUser : undefined;
    } else {
      status = userOrStatus as OmrReviewStatus;
      reason = typeof reasonOrUser === 'string' ? reasonOrUser : undefined;
      requestingUser = (maybeUser ?? (typeof reasonOrUser === 'object' ? reasonOrUser : undefined)) as AuthenticatedUser;
    }

    assertAuthenticatedUser(requestingUser);

    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      throw new ForbiddenError('No tiene los permisos requeridos (songs:update_draft) para revisar propuestas OMR.');
    }

    // 1. Recuperar propuesta verificando pertenencia autoritativa
    const proposal = await this.getProposalAsync(proposalId, requestingUser);

    // 2. Persistir atómicamente estado y auditoría en BD
    await this.omrRepo.updateProposalStatusAndAudit(proposalId, status, requestingUser, reason);

    // 3. SOLO tras confirmación exitosa de PostgreSQL se actualiza la memoria
    proposal.reviewStatus = status;
    proposal.reviewedAt = new Date().toISOString();
    proposal.reviewedByUserId = requestingUser.id;
    this.proposals.set(proposal.proposalId, proposal);

    return proposal;
  }

  /**
   * Alias de compatibilidad hacia el método autoritativo asíncrono.
   */
  public async reviewProposalAsync(
    proposalId: string,
    statusOrUserId: string,
    userOrStatus: OmrReviewStatus | AuthenticatedUser,
    reasonOrUser?: string | AuthenticatedUser,
    maybeUser?: AuthenticatedUser
  ): Promise<OmrProposal> {
    return await this.reviewProposal(proposalId, statusOrUserId, userOrStatus, reasonOrUser, maybeUser);
  }

  /**
   * Convierte una propuesta OMR aprobada en una canción canónica en PostgreSQL.
   * Ejecuta la creación de canción, versión, actualización de propuesta y auditoría en una
   * ÚNICA transacción atómica en PostgreSQL con ON DELETE RESTRICT (R3-05, R3-06).
   *
   * REGLA ESTRICTA DE INTEGRIDAD MUSICAL (R3-03):
   * Si un compás carece de notas y de silencios explícitos (notesDetected: []), se RECHAZA
   * con ValidationError. CERO invención de silencios de compás vacío.
   */
  public async commitToCanonicalSong(
    proposalId: string,
    userOrUserId: AuthenticatedUser | string,
    overrides?: { title?: string; key?: string; timeSignature?: string; bpm?: number },
    requestingUser?: AuthenticatedUser
  ): Promise<SongWithVersion> {
    let effectiveUser: AuthenticatedUser;
    if (typeof userOrUserId === 'object' && userOrUserId !== null) {
      effectiveUser = userOrUserId as AuthenticatedUser;
    } else {
      effectiveUser = requestingUser as AuthenticatedUser;
    }

    assertAuthenticatedUser(effectiveUser);

    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(effectiveUser.role)) {
      throw new ForbiddenError('No tiene autorización para comprometer propuestas OMR al catálogo canónico.');
    }

    // 1. Validar overrides con Zod
    if (overrides) {
      const validOverrides = CommitToSongOverridesSchema.safeParse(overrides);
      if (!validOverrides.success) {
        throw new ValidationError('Parámetros de anulación de metadatos inválidos.');
      }
    }

    // 2. Obtener propuesta autoritativa
    const proposal = await this.getProposalAsync(proposalId, effectiveUser);

    // Si ya fue comprometida previamente, resolver de forma idempotente determinista (R2-06, R3-05)
    if (proposal.reviewStatus === 'COMMITTED') {
      const title = overrides?.title || proposal.detectedTitle || 'Canción Importada por OMR';
      return await this.omrRepo.commitProposalTransaction(
        proposalId,
        effectiveUser,
        {} as CreateSongDTO,
        title
      );
    }

    if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
      throw new ValidationError(
        'La propuesta de reconocimiento OMR debe ser revisada y aprobada por un humano antes de persistirse en el catálogo canónico.'
      );
    }

    if (!proposal.measures || proposal.measures.length === 0) {
      throw new ValidationError(
        'No se puede comprometer al catálogo canónico una propuesta OMR sin compases reconocidos válidos.'
      );
    }

    // 3. Resolución rigurosa de metadatos (CERO adivinación / CERO fabricación silenciosa)
    const title = overrides?.title || proposal.detectedTitle || 'Canción Importada por OMR';

    const defaultKey = overrides?.key || proposal.detectedKey;
    if (!defaultKey) {
      throw new ValidationError(
        'No se puede comprometer al catálogo canónico una propuesta con tonalidad no resuelta. Se requiere confirmación o anulación explícita de tonalidad.'
      );
    }

    const timeSignature = overrides?.timeSignature || proposal.detectedTimeSignature;
    if (!timeSignature) {
      throw new ValidationError(
        'No se puede comprometer al catálogo canónico una propuesta con métrica no resuelta. Se requiere confirmación o anulación explícita de métrica.'
      );
    }

    const defaultBpm = overrides?.bpm || proposal.detectedBpm;
    if (!defaultBpm || defaultBpm <= 0) {
      throw new ValidationError(
        'No se puede comprometer al catálogo canónico una propuesta con tempo (BPM) no resuelto. Se requiere confirmación o anulación explícita de tempo.'
      );
    }

    // 3.5. Validación estricta de contenido musical no resuelto en compases (R3-03)
    for (const m of proposal.measures) {
      if (!m.notesDetected || m.notesDetected.length === 0) {
        throw new ValidationError(
          `Compás ${m.measureNumber} no contiene notas ni silencios explícitos reconocidos. Se requiere revisión humana.`
        );
      }

      const unresolvedFlags = (m.flags ?? []).filter(
        (f) =>
          f.startsWith('UNRESOLVED_NOTE_GLYPH') ||
          f.startsWith('UNRESOLVED_TIME_SIGNATURE') ||
          f.startsWith('UNRESOLVED_KEY_SIGNATURE') ||
          f.startsWith('UNRESOLVED_MEASURE_CONTENT') ||
          f.startsWith('INCOMPLETE_MEASURE_DURATION') ||
          f.startsWith('CORRUPT_GLYPH') ||
          f === 'LOW_CONFIDENCE'
      );
      if (unresolvedFlags.length > 0) {
        throw new ValidationError(
          `No se puede comprometer al catálogo canónico: el compás ${m.measureNumber} contiene contenido musical no resuelto (${unresolvedFlags.join(', ')}). Debe ser revisado y corregido por un músico humano antes de la importación.`
        );
      }
    }

    // 4. Convertir DIRECTAMENTE los compases validados con fidelidad musical rigurosa (R3-03)
    const canonicalPayload = this.convertProposalToCanonical(
      proposal,
      title,
      defaultKey,
      timeSignature,
      defaultBpm
    );
    const canonicalJSON = CanonicalSerializer.serialize(canonicalPayload);

    const songDto: CreateSongDTO = {
      title,
      defaultKey,
      defaultBpm,
      timeSignature,
      status: 'APPROVED',
      versionName: 'Partitura Escaneada (OMR)',
      versionDescription: `Importado mediante OMR desde ${proposal.sourceFilename} (Hash: ${proposal.sourceHash.substring(0, 8)}). Confianza IA: ${(proposal.overallConfidence * 100).toFixed(1)}%. Compases: ${proposal.measures.length}.`,
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
      metadata: {
        notes: `Reconocido ópticamente y revisado por usuario humano (${effectiveUser.id}). Hash fuente: ${proposal.sourceHash}.`,
      },
    };

    // 5. Ejecutar compromiso atómico en una única transacción PostgreSQL (R3-05, R3-06)
    const created = await this.omrRepo.commitProposalTransaction(
      proposalId,
      effectiveUser,
      songDto,
      title
    );

    // 6. Actualizar estado local sólo tras éxito atómico
    proposal.reviewStatus = 'COMMITTED';
    proposal.canonicalSongId = created.song.id;

    return created;
  }

  /**
   * Modifica un compás de la propuesta OMR con auditoría (R3.1-01 / R3.1-05).
   */
  public async updateMeasure(
    proposalId: string,
    measure: OmrMeasureProposal,
    requestingUser: AuthenticatedUser
  ): Promise<void> {
    assertAuthenticatedUser(requestingUser);
    await this.omrRepo.updateMeasure(proposalId, measure, requestingUser);
    this.proposals.delete(proposalId);
  }

  /**
   * Consulta el historial inmutable de auditoría para una propuesta OMR (R3.1-01).
   */
  public async getAuditHistory(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<OmrAuditEntry[]> {
    assertAuthenticatedUser(requestingUser);
    return await this.omrRepo.getAuditHistory(proposalId, requestingUser);
  }

  /**
   * Registra un evento de auditoría obligatorio vinculado al principal autenticado (R3.1-01).
   */
  public async recordAudit(
    entry: CreateOmrAuditEntryInput | OmrAuditEntry,
    requestingUser: AuthenticatedUser
  ): Promise<void> {
    assertAuthenticatedUser(requestingUser);
    return await this.omrRepo.recordAudit(entry, requestingUser);
  }

  /**
   * Elimina una propuesta OMR si no tiene registros de auditoría restringidos (R3-05).
   */
  public async deleteProposal(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<boolean> {
    assertAuthenticatedUser(requestingUser);
    const result = await this.omrRepo.deleteProposal(proposalId, requestingUser);
    if (result) {
      this.proposals.delete(proposalId);
    }
    return result;
  }

  /**
   * Convierte los compases validados de una propuesta OMR aprobada en CanonicalMusicPayload.
   * Remedia exhaustivamente los defectos musicales: CERO silencios fabricados en compases vacíos (R3-03).
   */
  private convertProposalToCanonical(
    proposal: OmrProposal,
    title: string,
    resolvedKey: string,
    resolvedTimeSig: string,
    resolvedBpm: number
  ): CanonicalMusicPayload {
    // RESOLUCIÓN TONAL INICIAL (CERO fallback ciego a C Major)
    let currentKeySigRef: KeySignatureReference;
    try {
      const parsedKey = MusicalKey.parse(resolvedKey);
      currentKeySigRef = KeySignatureReference.fromMusicalKey(parsedKey);
    } catch {
      throw new ValidationError(`Tonalidad inválida o no reconocida: "${resolvedKey}".`);
    }

    // RESOLUCIÓN MÉTRICA INICIAL (CERO fallback ciego a 4/4)
    let currentTimeSig: TimeSignature;
    try {
      currentTimeSig = TimeSignature.parse(resolvedTimeSig);
    } catch {
      throw new ValidationError(`Métrica inválida o no reconocida: "${resolvedTimeSig}".`);
    }

    const tempoMap = new TempoMap([new TempoEvent(0, resolvedBpm)]);

    const measures: Measure[] = [];
    let currentTick = 0;
    let syllableSeq = 1;

    for (let idx = 0; idx < proposal.measures.length; idx++) {
      const mProp = proposal.measures[idx];
      const measureNum = mProp.measureNumber || idx + 1;
      const measureStartTick = currentTick;

      // 1. Métrica dinámica por compás
      if (mProp.timeSignature) {
        try {
          currentTimeSig = TimeSignature.parse(mProp.timeSignature);
        } catch {
          mProp.flags = mProp.flags ?? [];
          if (!mProp.flags.includes('UNRESOLVED_TIME_SIGNATURE')) {
            mProp.flags.push('UNRESOLVED_TIME_SIGNATURE');
          }
          throw new ValidationError(
            `Métrica de compás inválida o no resuelta en compás ${measureNum}: '${mProp.timeSignature}'. No se permite continuar silenciosamente.`
          );
        }
      }
      const measureDurationTicks = currentTimeSig.calculateMeasureDurationTicks();

      // 2. Tonalidad dinámica por compás
      if (mProp.keySignature) {
        try {
          const parsedKey = MusicalKey.parse(mProp.keySignature);
          currentKeySigRef = KeySignatureReference.fromMusicalKey(parsedKey);
        } catch {
          mProp.flags = mProp.flags ?? [];
          if (!mProp.flags.includes('UNRESOLVED_KEY_SIGNATURE')) {
            mProp.flags.push('UNRESOLVED_KEY_SIGNATURE');
          }
          throw new ValidationError(
            `Tonalidad musical inválida o no resuelta en compás ${measureNum}: '${mProp.keySignature}'. No se permite continuar silenciosamente.`
          );
        }
      }

      // 3. Acordes reconocidos
      const chords: ChordEvent[] = [];
      if (mProp.chordsDetected && mProp.chordsDetected.length > 0) {
        let chordIdx = 1;
        for (const c of mProp.chordsDetected) {
          try {
            const parsed = Chord.parse(c.chord);
            const beatOffset = Math.max(0, (c.beat - 1) * currentTimeSig.beatDurationTicks);
            chords.push(
              new ChordEvent({
                id: `omr_chord_${measureNum}_${chordIdx++}`,
                chord: parsed,
                startTick: measureStartTick + (c.tickOffset ?? beatOffset),
                measureNumber: measureNum,
                voice: 1,
              })
            );
          } catch (err) {
            mProp.flags = mProp.flags ?? [];
            const flag = `UNPARSED_CHORD:${c.chord}`;
            if (!mProp.flags.includes(flag)) {
              mProp.flags.push(flag);
            }
          }
        }
      }

      // 4. Notas y silencios reconocidos (R3-03: CERO silencios fabricados si notesDetected está vacío)
      if (!mProp.notesDetected || mProp.notesDetected.length === 0) {
        mProp.flags = mProp.flags ?? [];
        if (!mProp.flags.includes('UNRESOLVED_MEASURE_CONTENT')) {
          mProp.flags.push('UNRESOLVED_MEASURE_CONTENT');
        }
        throw new ValidationError(
          `Compás ${measureNum} no contiene notas ni silencios explícitos reconocidos. Se requiere revisión humana.`
        );
      }

      const events: (Note | Rest)[] = [];
      let eventTick = measureStartTick;
      let totalEventTicks = 0;
      let eventIdx = 1;

      for (const n of mProp.notesDetected) {
        const durationTicks = this.parseDurationTicks(n.duration, currentTimeSig.beatDurationTicks);
        totalEventTicks += durationTicks;

        if (n.isRest) {
          // Silencio explícito detectado por OMR (R3-03)
          events.push(
            new Rest({
              id: `omr_rest_${measureNum}_${eventIdx++}`,
              startTick: eventTick,
              durationTicks,
              voice: 1,
              staff: 1,
            })
          );
        } else {
          // Nota detectada
          let noteName: NoteName;
          try {
            const letter = validateAndParseNoteStep(n.step);
            if (typeof n.alter === 'number') {
              const acc = Accidental.fromSemitones(n.alter);
              noteName = new NoteName(letter, acc);
            } else {
              noteName = NoteName.parse(n.step);
            }
          } catch {
            mProp.flags = mProp.flags ?? [];
            const flag = `UNRESOLVED_NOTE_GLYPH:${n.step ?? 'EMPTY'}`;
            if (!mProp.flags.includes(flag)) {
              mProp.flags.push(flag);
            }
            throw new ValidationError(
              `Compás ${measureNum} contiene nota o glifo no resoluble: '${n.step}'. No se puede convertir en silencio ni fabricar notas.`
            );
          }

          const pitch = new Pitch(noteName, n.octave);
          events.push(
            new Note({
              id: `omr_note_${measureNum}_${eventIdx++}`,
              pitch,
              startTick: eventTick,
              durationTicks,
              voice: 1,
              staff: 1,
            })
          );
        }

        eventTick += durationTicks;
      }

      // R3-03: Validación estricta de completitud métrica del compás
      if (totalEventTicks !== measureDurationTicks) {
        mProp.flags = mProp.flags ?? [];
        if (!mProp.flags.includes('INCOMPLETE_MEASURE_DURATION')) {
          mProp.flags.push('INCOMPLETE_MEASURE_DURATION');
        }
        throw new ValidationError(
          `El compás ${measureNum} tiene una duración acumulada de ${totalEventTicks} ticks, distinta a los ${measureDurationTicks} ticks requeridos por la métrica. Se requiere revisión humana.`
        );
      }

      const voice = new Voice(1, events);

      // 5. Lírica reconocida (CERO apilamiento a tick 0)
      const lyrics: LyricSyllable[] = [];
      if (mProp.lyricsDetected && mProp.lyricsDetected.length > 0) {
        const lyricCount = mProp.lyricsDetected.length;
        const noteEvents = events.filter((e): e is Note => e instanceof Note);
        for (let lIdx = 0; lIdx < lyricCount; lIdx++) {
          const l = mProp.lyricsDetected[lIdx]!;

          let syllableOffset = 0;
          if (typeof l.tickOffset === 'number') {
            syllableOffset = l.tickOffset;
          } else if (typeof l.beat === 'number') {
            syllableOffset = Math.max(0, (l.beat - 1) * currentTimeSig.beatDurationTicks);
          } else if (noteEvents.length > 0 && lIdx < noteEvents.length) {
            syllableOffset = noteEvents[lIdx]!.startTick - measureStartTick;
          } else {
            syllableOffset = Math.round((lIdx / lyricCount) * measureDurationTicks);
          }

          lyrics.push(
            new LyricSyllable({
              id: `omr_syl_${measureNum}_${syllableSeq}`,
              text: l.text,
              measureNumber: measureNum,
              tickOffset: syllableOffset,
              sequenceNumber: syllableSeq++,
              isHyphenated: l.text.endsWith('-'),
            })
          );
        }
      }

      measures.push(
        new Measure({
          number: measureNum,
          startTick: measureStartTick,
          durationTicks: measureDurationTicks,
          timeSignature: currentTimeSig,
          keySignature: currentKeySigRef,
          voices: [voice],
          chords,
          lyrics,
        })
      );

      currentTick += measureDurationTicks;
    }

    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      tempoMap,
      measureCount: measures.length,
      totalDurationTicks: Math.max(currentTimeSig.calculateMeasureDurationTicks(), currentTick),
    });

    return new CanonicalMusicPayload({
      title,
      timeline,
      measures,
    });
  }

  /**
   * Mapea descripciones textuales de duración a ticks canónicos (TPQN 480).
   * REGLA: Si la duración no es reconocida, RECHAZA la adivinación musical con ValidationError.
   */
  private parseDurationTicks(durationStr: string, _beatDurationTicks: number): number {
    const d = (durationStr || '').toLowerCase().trim();
    switch (d) {
      case 'maxima':
        return 15360;
      case 'long':
        return 7680;
      case 'breve':
        return 3840;
      case 'dotted-whole':
        return 2880;
      case 'whole':
        return 1920;
      case 'dotted-half':
        return 1440;
      case 'half':
        return 960;
      case 'dotted-quarter':
        return 720;
      case 'quarter':
        return 480;
      case 'triplet-half':
        return 640;
      case 'dotted-eighth':
        return 360;
      case 'triplet-quarter':
        return 320;
      case 'eighth':
        return 240;
      case 'dotted-sixteenth':
      case 'dotted-16th':
        return 180;
      case 'triplet-eighth':
        return 160;
      case 'sixteenth':
      case '16th':
        return 120;
      case 'triplet-sixteenth':
        return 80;
      case 'thirty-second':
      case '32nd':
        return 60;
      case 'sixty-fourth':
      case '64th':
        return 30;
      default: {
        const numeric = parseInt(d, 10);
        if (!isNaN(numeric) && numeric > 0) {
          return numeric;
        }
        throw new ValidationError(
          `Duración de nota no reconocida en OMR: "${durationStr}". Se rechaza la adivinación musical.`
        );
      }
    }
  }

  /**
   * Reset para entornos de prueba
   */
  public clearProposals(): void {
    this.proposals.clear();
  }
}
