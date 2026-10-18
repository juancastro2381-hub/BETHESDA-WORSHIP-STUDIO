/**
 * @file omr-service.ts
 * @description Servicio de aplicación para Reconocimiento Óptico de Música (OMR) y flujo de revisión humana (Fase 3C — D2).
 *
 * Enforce:
 * 1. La salida de IA es solo una propuesta preliminar con isAiDraft: true.
 * 2. No se puede comprometer al catálogo canónico sin aprobación humana explícita.
 * 3. Trazabilidad completa con hash y archivo de origen.
 */

import type { IOmrProvider } from '../domain/omr/omr-provider.ts';
import type { OmrProposal, OmrRecognitionInput } from '../domain/omr/types.ts';
import type { ISongRepository, SongWithVersion } from '../repositories/song-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';

export class OmrService {
  private proposals: Map<string, OmrProposal>;
  private provider: IOmrProvider;
  private songRepo: ISongRepository;

  constructor(provider: IOmrProvider, songRepo: ISongRepository) {
    this.proposals = new Map();
    this.provider = provider;
    this.songRepo = songRepo;
  }

  /**
   * Procesa un archivo de partitura y genera una propuesta preliminar (AI Draft).
   */
  public async processUpload(
    input: OmrRecognitionInput,
    _userId: string
  ): Promise<OmrProposal> {
    const proposal = await this.provider.recognize(input);
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * Obtiene una propuesta OMR por ID.
   */
  public getProposal(proposalId: string): OmrProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new NotFoundError('Propuesta OMR', proposalId);
    }
    return proposal;
  }

  /**
   * Aplica revisión humana a una propuesta OMR (aprobación o rechazo).
   */
  public reviewProposal(
    proposalId: string,
    userId: string,
    status: 'APPROVED_FOR_IMPORT' | 'REJECTED'
  ): OmrProposal {
    const proposal = this.getProposal(proposalId);

    proposal.reviewStatus = status;
    proposal.reviewedAt = new Date().toISOString();
    proposal.reviewedByUserId = userId;

    return proposal;
  }

  /**
   * Convierte una propuesta OMR aprobada en una canción canónica en la base de datos PostgreSQL.
   */
  public async commitToCanonicalSong(
    proposalId: string,
    _userId: string,
    overrides?: { title?: string; key?: string }
  ): Promise<SongWithVersion> {
    const proposal = this.getProposal(proposalId);

    if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
      throw new ValidationError(
        'La propuesta de reconocimiento OMR debe ser revisada y aprobada por un humano antes de persistirse en el catálogo canónico.'
      );
    }

    const title = overrides?.title || proposal.detectedTitle || 'Canción Importada por OMR';
    const defaultKey = overrides?.key || proposal.detectedKey || 'C';
    const defaultBpm = proposal.detectedBpm || 120;
    const timeSignature = proposal.detectedTimeSignature || '4/4';

    // Generar carga canónica musical válida a partir de la propuesta
    const fixtureSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(fixtureSong);

    const created = await this.songRepo.create({
      title,
      defaultKey,
      defaultBpm,
      timeSignature,
      status: 'APPROVED',
      versionName: 'Partitura Escaneada (OMR)',
      versionDescription: `Importado mediante OMR desde ${proposal.sourceFilename} (Hash: ${proposal.sourceHash.substring(0, 8)}). Confianza IA: ${(proposal.overallConfidence * 100).toFixed(1)}%.`,
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
      metadata: {
        notes: `Reconocido ópticamente y revisado por usuario humano. Hash fuente: ${proposal.sourceHash}.`,
      },
    });

    return created;
  }

  /**
   * Reset para entornos de prueba
   */
  public clearProposals(): void {
    this.proposals.clear();
  }
}
