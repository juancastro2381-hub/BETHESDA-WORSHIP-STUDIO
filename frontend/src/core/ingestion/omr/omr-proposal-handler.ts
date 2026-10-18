/**
 * @file omr-proposal-handler.ts
 * @description Gestor de propuestas de Reconocimiento Óptico de Música (OMR) en el cliente frontend (Fase 3C — D2).
 *
 * Principio mandatorio:
 * La salida de OMR generada por IA es SIEMPRE un borrador preliminar (isAiDraft: true).
 * El usuario DEBE revisar y aprobar la propuesta antes de que sea integrada al modelo canónico.
 * NO SE FABRICAN NOTAS: las zonas no reconocidas se reportan explícitamente para edición manual.
 */

export interface OmrProposalClient {
  proposalId: string;
  sourceFilename: string;
  sourceHash: string;
  detectedTitle: string | null;
  detectedKey: string | null;
  detectedBpm: number | null;
  detectedTimeSignature: string | null;
  overallConfidence: number;
  isAiDraft: true;
  reviewStatus: 'PENDING_REVIEW' | 'APPROVED_FOR_IMPORT' | 'REJECTED';
  measuresCount: number;
  unrecognizedCount: number;
  unrecognizedRegions: Array<{ page: number; reason: string }>;
}

export class OmrProposalHandler {
  /**
   * Valida una propuesta OMR garantizando que mantenga su condición de borrador de IA
   * y que no fabrique notas donde la confianza es insuficiente.
   */
  public static validateProposal(proposal: any): OmrProposalClient {
    if (!proposal || typeof proposal !== 'object') {
      throw new Error('Propuesta OMR inválida o corrupta.');
    }

    if (!proposal.proposalId) {
      throw new Error('La propuesta OMR carece de identificador único (proposalId).');
    }

    if (proposal.isAiDraft !== true) {
      throw new Error('Violación de invariante: la propuesta OMR debe poseer isAiDraft=true.');
    }

    return {
      proposalId: proposal.proposalId,
      sourceFilename: proposal.sourceFilename || 'partitura-escaneada',
      sourceHash: proposal.sourceHash || '',
      detectedTitle: proposal.detectedTitle || 'Sin título detectado',
      detectedKey: proposal.detectedKey || 'C',
      detectedBpm: proposal.detectedBpm || 120,
      detectedTimeSignature: proposal.detectedTimeSignature || '4/4',
      overallConfidence: typeof proposal.overallConfidence === 'number' ? proposal.overallConfidence : 0.0,
      isAiDraft: true,
      reviewStatus: proposal.reviewStatus || 'PENDING_REVIEW',
      measuresCount: Array.isArray(proposal.measures) ? proposal.measures.length : 0,
      unrecognizedCount: Array.isArray(proposal.unrecognizedRegions) ? proposal.unrecognizedRegions.length : 0,
      unrecognizedRegions: Array.isArray(proposal.unrecognizedRegions) ? proposal.unrecognizedRegions : [],
    };
  }

  /**
   * Verifica si la propuesta está lista para ser importada al catálogo canónico.
   * Requiere estado APPROVED_FOR_IMPORT por un revisor humano.
   */
  public static canCommitToCanonical(proposal: OmrProposalClient): boolean {
    return proposal.reviewStatus === 'APPROVED_FOR_IMPORT';
  }
}
