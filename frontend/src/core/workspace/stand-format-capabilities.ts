/**
 * @file stand-format-capabilities.ts
 * @description Evaluador centralizado y autoritativo de disponibilidad y completitud de contenido
 * para los 4 formatos del Atril Digital (PARTITURE, CHORDS_WITH_LYRICS, LYRICS_ONLY, TABLATURE).
 *
 * Compartido entre backend (fuente autoritativa) y frontend (proyección fiel sin fabricación).
 * Principio rector: CERO FABRICACIÓN DE CONTENIDO MUSICAL.
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { type ChordEvidenceStatus } from '../canonical-model/chord-event.ts';
import { type Note } from '../canonical-model/musical-event.ts';
import { type InstrumentProfile } from '../projection/instrument-profile.ts';
import { TablatureCalculator } from '../projection/tablature-calculator.ts';

export type StandReadingFormatId = 'STAFF_NOTATION' | 'CHORD_CHART' | 'LYRICS_ONLY' | 'TABLATURE';
export type CanonicalStandFormatName = 'PARTITURE' | 'CHORDS_WITH_LYRICS' | 'LYRICS_ONLY' | 'TABLATURE';

export type StandFormatAvailabilityStatus =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'MISSING_CONTENT'
  | 'INCOMPLETE'
  | 'VALIDATION_REQUIRED'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED'
  | 'APPROVED';

export type MusicalContentEvidenceStatus =
  | ChordEvidenceStatus
  | 'IMPORTED'
  | 'MANUALLY_ENTERED'
  | 'MIXED'
  | 'MISSING';

export type StandFormatApprovalStatus =
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'DRAFT'
  | 'NOT_APPLICABLE'
  | 'REJECTED';

export type LeadSheetCompletionState =
  | 'MISSING_BOTH'
  | 'CHORDS_AVAILABLE_LYRICS_MISSING'
  | 'LYRICS_AVAILABLE_CHORDS_MISSING'
  | 'LYRICS_AVAILABLE_NOT_ALIGNED'
  | 'LYRICS_ALIGNED_AWAITING_REVIEW'
  | 'LYRICS_VERIFIED'
  | 'COMPLETE_AND_APPROVED';

export interface TablatureNoteCandidateInfo {
  readonly noteId: string;
  readonly measureNumber: number;
  readonly pitch: string;
  readonly midiNumber: number;
  readonly selectedString: number | null;
  readonly selectedFret: number | null;
  readonly isHumanOverride: boolean;
  readonly isAmbiguous: boolean;
  readonly isOutOfRange: boolean;
  readonly candidates: ReadonlyArray<{ readonly stringNumber: number; readonly fret: number }>;
}

export interface TablatureFeasibilitySummary {
  readonly tuningName: string | null;
  readonly stringCount: number;
  readonly capoFret: number;
  readonly maxFret: number;
  readonly totalNotes: number;
  readonly playableCount: number;
  readonly outOfRangeCount: number;
  readonly ambiguousCount: number;
  readonly largeLeapCount: number;
  readonly humanVerifiedPositionsCount: number;
  readonly noteCandidates: readonly TablatureNoteCandidateInfo[];
}

export interface StandFormatCapabilityDescriptor {
  readonly format: StandReadingFormatId;
  readonly canonicalFormat: CanonicalStandFormatName;
  readonly label: string;
  readonly availabilityStatus: StandFormatAvailabilityStatus;
  readonly isAvailable: boolean;
  readonly requiredContent: readonly string[];
  readonly missingContent: readonly string[];
  readonly validationErrors: readonly string[];
  readonly validationWarnings: readonly string[];
  readonly evidenceStatus: MusicalContentEvidenceStatus;
  readonly reviewRequired: boolean;
  readonly approvalStatus: StandFormatApprovalStatus;
  readonly approvalScope: string;
  readonly blockingReason: string;
  readonly shortRestrictionExplanation: string;
  readonly nextRecommendedAction: string;
  readonly leadSheetState?: LeadSheetCompletionState;
  readonly tablatureSummary?: TablatureFeasibilitySummary;
}

export interface StandCapabilityEvaluationOptions {
  readonly songStatus?: 'DRAFT' | 'APPROVED' | 'ARCHIVED' | undefined;
  readonly capoFret?: number | undefined;
  readonly pendingProposalFormats?: readonly StandReadingFormatId[] | undefined;
  readonly rejectedProposalFormats?: readonly StandReadingFormatId[] | undefined;
  readonly approvalMetadata?:
    | {
        readonly approvedFormats?: readonly string[];
        readonly blockedFormats?: ReadonlyArray<{ readonly format: string; readonly reason: string }>;
        readonly approvalScope?: string;
      }
    | null
    | undefined;
}

export interface SongContentSummary {
  readonly measureCount: number;
  readonly noteCount: number;
  readonly timedNoteCount: number;
  readonly restCount: number;
  readonly chordCount: number;
  readonly lyricSyllableCount: number;
  readonly measuresWithLyrics: number;
  readonly lyricCoverageRatio: number;
  readonly hasUnalignedLyrics: boolean;
  readonly detectedChordCount: number;
  readonly estimatedChordCount: number;
  readonly ambiguousChordCount: number;
  readonly humanVerifiedChordCount: number;
}

export function extractValidatedTablatureOverride(
  note: Note,
  instrumentProfile: InstrumentProfile,
  capoFret = 0
): { stringNumber: number; fret: number } | null {
  const tuning = instrumentProfile.tuning;
  if (!tuning) return null;
  const tabMeta = note.notationMetadata?.['tablature'] as Record<string, unknown> | undefined;
  if (!tabMeta) return null;

  const stringNumber = tabMeta['stringNumber'];
  const fret = tabMeta['fret'];
  if (
    typeof stringNumber !== 'number' ||
    typeof fret !== 'number' ||
    !Number.isInteger(stringNumber) ||
    !Number.isInteger(fret)
  ) {
    return null;
  }
  if (stringNumber < 1 || stringNumber > tuning.stringPitches.length) return null;
  if (fret < 0 || fret > 24) return null;

  const openPitch = tuning.stringPitches[stringNumber - 1];
  if (!openPitch) return null;
  if (openPitch.midiNumber + capoFret + fret !== note.pitch.midiNumber) {
    return null;
  }

  return { stringNumber, fret };
}

export class StandFormatCapabilityResolver {
  public static summarizeContent(song: CanonicalMusicPayload): SongContentSummary {
    const allNotes = song.getAllNotes();
    const timedNoteCount = allNotes.filter(
      (n) => n.startTick !== null && n.durationTicks !== null && n.durationTicks > 0
    ).length;
    const allRests = song.getAllRests();
    const allChords = song.getAllChords();
    const allLyrics = song.getAllLyrics();
    const measuresWithLyrics = song.measures.filter((m) => m.lyrics.length > 0).length;
    const lyricCoverageRatio = song.measures.length > 0 ? measuresWithLyrics / song.measures.length : 0;
    const meta = (song.metadata ?? {}) as Record<string, unknown>;
    const unalignedLyrics = Array.isArray(meta['unalignedLyrics']) ? meta['unalignedLyrics'] : [];
    const hasUnalignedLyrics =
      unalignedLyrics.length > 0 || meta['lyricAlignmentStatus'] === 'UNALIGNED';

    let detectedChordCount = 0;
    let estimatedChordCount = 0;
    let ambiguousChordCount = 0;
    let humanVerifiedChordCount = 0;
    for (const c of allChords) {
      if (c.evidenceStatus === 'HUMAN_VERIFIED') humanVerifiedChordCount += 1;
      else if (c.evidenceStatus === 'DETECTED') detectedChordCount += 1;
      else if (c.evidenceStatus === 'AMBIGUOUS') ambiguousChordCount += 1;
      else if (c.evidenceStatus === 'ESTIMATED') estimatedChordCount += 1;
    }

    return {
      measureCount: song.measures.length,
      noteCount: allNotes.length,
      timedNoteCount,
      restCount: allRests.length,
      chordCount: allChords.length,
      lyricSyllableCount: allLyrics.length,
      measuresWithLyrics,
      lyricCoverageRatio,
      hasUnalignedLyrics,
      detectedChordCount,
      estimatedChordCount,
      ambiguousChordCount,
      humanVerifiedChordCount,
    };
  }

  public static evaluateAll(
    song: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    options: StandCapabilityEvaluationOptions = {}
  ): Record<StandReadingFormatId, StandFormatCapabilityDescriptor> {
    const summary = this.summarizeContent(song);
    return {
      STAFF_NOTATION: this.evaluatePartiture(song, instrumentProfile, summary, options),
      CHORD_CHART: this.evaluateChordsWithLyrics(song, instrumentProfile, summary, options),
      LYRICS_ONLY: this.evaluateLyricsOnly(song, instrumentProfile, summary, options),
      TABLATURE: this.evaluateTablature(song, instrumentProfile, summary, options),
    };
  }

  private static resolveBaseEvidence(
    meta: Record<string, unknown>,
    defaultWhenPresent: MusicalContentEvidenceStatus
  ): MusicalContentEvidenceStatus {
    const raw = meta['evidenceStatus'];
    if (
      raw === 'DETECTED' ||
      raw === 'IMPORTED' ||
      raw === 'ESTIMATED' ||
      raw === 'AMBIGUOUS' ||
      raw === 'MANUALLY_ENTERED' ||
      raw === 'HUMAN_VERIFIED'
    ) {
      return raw;
    }
    if (meta['isAudioDerived'] === true) return 'DETECTED';
    if (meta['sourceProvenance'] === 'MANUAL' || meta['contentOrigin'] === 'MANUALLY_ENTERED') {
      return 'MANUALLY_ENTERED';
    }
    return defaultWhenPresent;
  }

  private static evaluatePartiture(
    song: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    summary: SongContentSummary,
    options: StandCapabilityEvaluationOptions
  ): StandFormatCapabilityDescriptor {
    const meta = (song.metadata ?? {}) as Record<string, unknown>;
    const isGrandStaff = instrumentProfile.isRepresentationSupported('GRAND_STAFF');
    const targetRep = isGrandStaff ? 'GRAND_STAFF' : 'STANDARD_NOTATION';
    const supportedByInstrument = instrumentProfile.isRepresentationSupported(targetRep);
    const hasPending = Boolean(options.pendingProposalFormats?.includes('STAFF_NOTATION'));
    const hasRejected = Boolean(options.rejectedProposalFormats?.includes('STAFF_NOTATION'));
    const isApproved =
      options.songStatus === 'APPROVED' ||
      meta['approvalStatus'] === 'APPROVED' ||
      meta['partitureApprovalStatus'] === 'APPROVED';
    const isDraft =
      options.songStatus === 'DRAFT' ||
      meta['approvalStatus'] === 'DRAFT_REVIEW_REQUIRED' ||
      meta['isAiDraft'] === true;

    const approvalStatus: StandFormatApprovalStatus = hasRejected
      ? 'REJECTED'
      : isApproved
      ? 'APPROVED'
      : hasPending || isDraft
      ? 'PENDING_REVIEW'
      : 'NOT_APPLICABLE';

    const requiredContent = [
      'Notas melódicas reales con altura (pitch) definida (los silencios no bastan)',
      'Duración rítmica y posición temporal en compases válidos',
      'Perfil de instrumento compatible con notación en pentagrama',
    ];

    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];
    const missingContent: string[] = [];

    if (!supportedByInstrument) {
      validationErrors.push(
        `El instrumento "${instrumentProfile.name}" no utiliza notación melódica en pentagrama estándar.`
      );
      return {
        format: 'STAFF_NOTATION',
        canonicalFormat: 'PARTITURE',
        label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
        availabilityStatus: 'BLOCKED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Instrumento compatible con pentagrama'],
        validationErrors,
        validationWarnings,
        evidenceStatus: summary.noteCount > 0 ? this.resolveBaseEvidence(meta, 'IMPORTED') : 'MISSING',
        reviewRequired: false,
        approvalStatus,
        approvalScope: String(options.approvalMetadata?.approvalScope ?? 'MELODIC_NOT_SUPPORTED'),
        blockingReason: `El instrumento "${instrumentProfile.name}" no utiliza notación en pentagrama.`,
        shortRestrictionExplanation: `${instrumentProfile.name} no emplea pentagrama melódico.`,
        nextRecommendedAction: 'Cambiar a un instrumento melódico o armónico compatible',
      };
    }

    if (summary.noteCount === 0) {
      missingContent.push(
        'Eventos de notas melódicas (un cifrado de acordes por sí solo no genera una partitura)'
      );
      const isChordOnly = summary.chordCount > 0;
      const blockingReason = isChordOnly
        ? 'Faltan notas melódicas reales; la obra solo contiene cifrado de acordes.'
        : 'La canción no contiene notas melódicas ni compases con melodía.';
      return {
        format: 'STAFF_NOTATION',
        canonicalFormat: 'PARTITURE',
        label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
        availabilityStatus: hasPending ? 'REVIEW_REQUIRED' : 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent,
        validationErrors: [blockingReason],
        validationWarnings,
        evidenceStatus: 'MISSING',
        reviewRequired: hasPending,
        approvalStatus,
        approvalScope: String(
          options.approvalMetadata?.approvalScope ??
            (isChordOnly ? 'HARMONIC_LEAD_SHEET_ONLY' : 'EMPTY')
        ),
        blockingReason,
        shortRestrictionExplanation: isChordOnly
          ? 'Faltan notas melódicas (solo hay acordes armónicos).'
          : 'Faltan notas melódicas.',
        nextRecommendedAction: 'Importar MusicXML / MIDI o transcribir notas melódicas',
      };
    }

    const untimedNotes = summary.noteCount - summary.timedNoteCount;
    if (untimedNotes > 0) {
      missingContent.push(
        `Duración y posición temporal válida para ${untimedNotes} nota(s) sin ritmo definido`
      );
      validationErrors.push(
        `${untimedNotes} nota(s) carecen de duración rítmica o tick inicial; no se inventa subdivisión.`
      );
      return {
        format: 'STAFF_NOTATION',
        canonicalFormat: 'PARTITURE',
        label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
        availabilityStatus: 'INCOMPLETE',
        isAvailable: false,
        requiredContent,
        missingContent,
        validationErrors,
        validationWarnings,
        evidenceStatus: this.resolveBaseEvidence(meta, 'IMPORTED'),
        reviewRequired: true,
        approvalStatus: isApproved ? 'PENDING_REVIEW' : approvalStatus,
        approvalScope: 'PARTITURE_TIMING_INCOMPLETE',
        blockingReason:
          'Existen notas sin duración rítmica o ubicación temporal completa dentro del compás.',
        shortRestrictionExplanation: 'Notas melódicas con duración rítmica incompleta.',
        nextRecommendedAction: 'Completar duraciones en MusicXML o editor de notas',
      };
    }

    const isAmbiguousNotes = meta['noteExtractionStatus'] === 'AMBIGUOUS';
    if (isAmbiguousNotes && !isApproved) {
      validationWarnings.push(
        'La evidencia de notas melódicas es ambigua y requiere revisión y confirmación humana.'
      );
      return {
        format: 'STAFF_NOTATION',
        canonicalFormat: 'PARTITURE',
        label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
        availabilityStatus: 'REVIEW_REQUIRED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Confirmación humana de alturas y ritmo detectados'],
        validationErrors,
        validationWarnings,
        evidenceStatus: 'AMBIGUOUS',
        reviewRequired: true,
        approvalStatus: 'PENDING_REVIEW',
        approvalScope: 'MELODIC_REVIEW_REQUIRED',
        blockingReason:
          'Las notas melódicas provienen de una extracción ambigua y requieren verificación humana antes de habilitarse.',
        shortRestrictionExplanation: 'Notas melódicas pendientes de verificación humana.',
        nextRecommendedAction: 'Revisar y confirmar las notas en el asistente de partitura',
      };
    }

    const evidenceStatus =
      meta['partitureEvidenceStatus'] === 'MANUALLY_ENTERED'
        ? 'MANUALLY_ENTERED'
        : isApproved
        ? 'HUMAN_VERIFIED'
        : this.resolveBaseEvidence(meta, 'IMPORTED');

    const reviewRequired = !isApproved && (isDraft || hasPending || evidenceStatus === 'ESTIMATED');
    const availabilityStatus: StandFormatAvailabilityStatus = isApproved
      ? 'APPROVED'
      : reviewRequired
      ? 'REVIEW_REQUIRED'
      : 'AVAILABLE';

    return {
      format: 'STAFF_NOTATION',
      canonicalFormat: 'PARTITURE',
      label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
      availabilityStatus,
      isAvailable: true,
      requiredContent,
      missingContent: [],
      validationErrors: [],
      validationWarnings: reviewRequired
        ? ['Contenido melódico validado en borrador; requiere aprobación humana para publicación oficial.']
        : [],
      evidenceStatus,
      reviewRequired,
      approvalStatus: isApproved ? 'APPROVED' : reviewRequired ? 'PENDING_REVIEW' : 'NOT_APPLICABLE',
      approvalScope: isApproved ? 'MELODIC_AND_HARMONIC' : 'MELODIC_DRAFT_PREVIEW',
      blockingReason: '',
      shortRestrictionExplanation: '',
      nextRecommendedAction: reviewRequired
        ? 'Aprobar y publicar versión oficial para el atril'
        : 'Partitura lista para lectura',
    };
  }

  private static evaluateChordsWithLyrics(
    song: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    summary: SongContentSummary,
    options: StandCapabilityEvaluationOptions
  ): StandFormatCapabilityDescriptor {
    const meta = (song.metadata ?? {}) as Record<string, unknown>;
    const chordsSupported = instrumentProfile.isRepresentationSupported('CHORDS');
    const lyricsSupported = instrumentProfile.isRepresentationSupported('LYRICS');
    const hasPending = Boolean(options.pendingProposalFormats?.includes('CHORD_CHART'));
    const hasRejected = Boolean(options.rejectedProposalFormats?.includes('CHORD_CHART'));
    const isApproved =
      options.songStatus === 'APPROVED' || meta['approvalStatus'] === 'APPROVED';
    const isDraft =
      options.songStatus === 'DRAFT' ||
      meta['approvalStatus'] === 'DRAFT_REVIEW_REQUIRED' ||
      meta['isAiDraft'] === true;

    const approvalStatus: StandFormatApprovalStatus = hasRejected
      ? 'REJECTED'
      : isApproved
      ? 'APPROVED'
      : hasPending || isDraft
      ? 'PENDING_REVIEW'
      : 'NOT_APPLICABLE';

    const requiredContent = [
      'Progresión válida de acordes armónicos',
      'Letra de la canción verificada',
      'Alineación confiable entre acordes y texto lírico por compás o sílaba',
    ];

    if (!chordsSupported || !lyricsSupported) {
      const reason = !chordsSupported
        ? `El instrumento "${instrumentProfile.name}" no soporta cifrado armónico.`
        : `El instrumento "${instrumentProfile.name}" no tiene habilitada capa de letra.`;
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'BLOCKED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Compatibilidad del instrumento con acordes y letra'],
        validationErrors: [reason],
        validationWarnings: [],
        evidenceStatus: summary.chordCount > 0 || summary.lyricSyllableCount > 0 ? 'IMPORTED' : 'MISSING',
        reviewRequired: false,
        approvalStatus,
        approvalScope: 'INSTRUMENT_UNSUPPORTED',
        blockingReason: reason,
        shortRestrictionExplanation: reason,
        nextRecommendedAction: 'Seleccionar un perfil de instrumento con soporte de cifrado y letra',
        leadSheetState: 'MISSING_BOTH',
      };
    }

    const chordEvidence: MusicalContentEvidenceStatus =
      summary.chordCount === 0
        ? 'MISSING'
        : summary.humanVerifiedChordCount === summary.chordCount
        ? 'HUMAN_VERIFIED'
        : summary.ambiguousChordCount > 0
        ? 'AMBIGUOUS'
        : summary.estimatedChordCount > 0
        ? 'ESTIMATED'
        : summary.detectedChordCount > 0
        ? 'DETECTED'
        : this.resolveBaseEvidence(meta, 'IMPORTED');

    const unalignedLyricsCount = Array.isArray(meta['unalignedLyrics'])
      ? (meta['unalignedLyrics'] as unknown[]).length
      : 0;

    if (summary.chordCount > 0 && summary.lyricSyllableCount === 0 && !summary.hasUnalignedLyrics) {
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Letra verificada alineada sobre los acordes'],
        validationErrors: ['La canción contiene acordes pero no tiene letra asociada ni alineada.'],
        validationWarnings: [],
        evidenceStatus: chordEvidence,
        reviewRequired: hasPending || isDraft,
        approvalStatus,
        approvalScope: 'HARMONIC_LEAD_SHEET_ONLY',
        blockingReason: 'Progresión de acordes disponible. Faltan las letras verificadas.',
        shortRestrictionExplanation: 'Acordes disponibles. Falta la letra.',
        nextRecommendedAction: 'Agregar o importar letra y alinearla con los acordes',
        leadSheetState: 'CHORDS_AVAILABLE_LYRICS_MISSING',
      };
    }

    if (summary.chordCount > 0 && summary.hasUnalignedLyrics) {
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'INCOMPLETE',
        isAvailable: false,
        requiredContent,
        missingContent: [
          `Alineación entre ${unalignedLyricsCount || 'las'} líneas de letra y los ${summary.chordCount} acordes`,
        ],
        validationErrors: [
          'Existe letra ingresada, pero aún no ha sido alineada con la línea de tiempo de acordes.',
        ],
        validationWarnings: [],
        evidenceStatus: chordEvidence,
        reviewRequired: true,
        approvalStatus: 'PENDING_REVIEW',
        approvalScope: 'LYRICS_UNALIGNED',
        blockingReason:
          'Letra disponible sin alinear con los acordes. Realice la alineación antes de habilitar el Lead Sheet.',
        shortRestrictionExplanation: 'Letra sin alinear con los acordes.',
        nextRecommendedAction: 'Alinear letra con compases y acordes',
        leadSheetState: 'LYRICS_AVAILABLE_NOT_ALIGNED',
      };
    }

    if (summary.chordCount === 0 && (summary.lyricSyllableCount > 0 || unalignedLyricsCount > 0)) {
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Progresión de acordes armónicos sobre los versos'],
        validationErrors: ['La canción tiene letra pero carece de acordes de cifrado armónico.'],
        validationWarnings: [],
        evidenceStatus: 'IMPORTED',
        reviewRequired: hasPending || isDraft,
        approvalStatus,
        approvalScope: 'LYRICS_ONLY',
        blockingReason: 'Letra disponible, pero faltan los acordes armónicos.',
        shortRestrictionExplanation: 'Letra disponible. Faltan acordes.',
        nextRecommendedAction: 'Importar ChordPro o ingresar acordes por compás',
        leadSheetState: 'LYRICS_AVAILABLE_CHORDS_MISSING',
      };
    }

    if (summary.chordCount === 0 && summary.lyricSyllableCount === 0) {
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Acordes armónicos', 'Letra verificada y alineación'],
        validationErrors: ['La canción no contiene acordes de cifrado ni texto lírico.'],
        validationWarnings: [],
        evidenceStatus: 'MISSING',
        reviewRequired: hasPending,
        approvalStatus,
        approvalScope: 'EMPTY',
        blockingReason: 'La canción no contiene acordes de cifrado ni letra.',
        shortRestrictionExplanation: 'Faltan acordes y letra.',
        nextRecommendedAction: 'Importar ChordPro o completar acordes y letra',
        leadSheetState: 'MISSING_BOTH',
      };
    }

    if (meta['lyricsSource'] === 'UNVERIFIED_AUDIO_SPEECH' && !isApproved) {
      return {
        format: 'CHORD_CHART',
        canonicalFormat: 'CHORDS_WITH_LYRICS',
        label: 'Cifrado con Letra',
        availabilityStatus: 'REVIEW_REQUIRED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Verificación humana de letra transcrita'],
        validationErrors: [
          'La letra proviene de una transcripción no verificada y requiere confirmación humana.',
        ],
        validationWarnings: [],
        evidenceStatus: 'AMBIGUOUS',
        reviewRequired: true,
        approvalStatus: 'PENDING_REVIEW',
        approvalScope: 'UNVERIFIED_LYRICS_BLOCKED',
        blockingReason:
          'El reconocimiento automático de voz no constituye letra verificada. Revise y confirme manualmente.',
        shortRestrictionExplanation: 'Letra pendiente de verificación humana.',
        nextRecommendedAction: 'Revisar y verificar la letra antes de habilitar',
        leadSheetState: 'LYRICS_ALIGNED_AWAITING_REVIEW',
      };
    }

    const isPartialLyrics = summary.measureCount >= 16 && summary.lyricCoverageRatio < 0.25;
    const reviewRequired =
      isPartialLyrics ||
      (!isApproved && (isDraft || hasPending || meta['lyricAlignmentStatus'] === 'ALIGNED_PENDING_REVIEW'));
    const leadSheetState: LeadSheetCompletionState = isPartialLyrics
      ? 'LYRICS_ALIGNED_AWAITING_REVIEW'
      : isApproved
      ? 'COMPLETE_AND_APPROVED'
      : reviewRequired
      ? 'LYRICS_ALIGNED_AWAITING_REVIEW'
      : 'LYRICS_VERIFIED';

    return {
      format: 'CHORD_CHART',
      canonicalFormat: 'CHORDS_WITH_LYRICS',
      label: 'Cifrado con Letra',
      availabilityStatus: isPartialLyrics
        ? 'PARTIAL'
        : isApproved
        ? 'APPROVED'
        : reviewRequired
        ? 'REVIEW_REQUIRED'
        : 'AVAILABLE',
      isAvailable: true,
      requiredContent,
      missingContent: isPartialLyrics
        ? [`Letra completa (solo ${summary.measuresWithLyrics} de ${summary.measureCount} compases contienen texto lírico)`]
        : [],
      validationErrors: [],
      validationWarnings: isPartialLyrics
        ? [
            `Cobertura lírica parcial (${summary.measuresWithLyrics}/${summary.measureCount} compases). No debe considerarse letra completa hasta cubrir las secciones faltantes.`,
          ]
        : reviewRequired
        ? ['Lead Sheet alineado en revisión; requiere aprobación humana para publicación oficial.']
        : [],
      evidenceStatus: isApproved && chordEvidence === 'IMPORTED' ? 'HUMAN_VERIFIED' : chordEvidence,
      reviewRequired,
      approvalStatus: isPartialLyrics
        ? 'PENDING_REVIEW'
        : isApproved
        ? 'APPROVED'
        : reviewRequired
        ? 'PENDING_REVIEW'
        : 'NOT_APPLICABLE',
      approvalScope: isPartialLyrics
        ? 'PARTIAL_LYRICS_COVERAGE'
        : isApproved
        ? 'COMPLETE_AND_APPROVED'
        : 'LEAD_SHEET_DRAFT',
      blockingReason: '',
      shortRestrictionExplanation: isPartialLyrics
        ? `Letra parcial (${summary.measuresWithLyrics}/${summary.measureCount} compases).`
        : '',
      nextRecommendedAction: isPartialLyrics
        ? 'Completar y alinear las secciones faltantes de letra'
        : reviewRequired
        ? 'Aprobar publicación oficial del Lead Sheet'
        : 'Lead Sheet disponible para lectura',
      leadSheetState,
    };
  }

  private static evaluateLyricsOnly(
    song: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    summary: SongContentSummary,
    options: StandCapabilityEvaluationOptions
  ): StandFormatCapabilityDescriptor {
    const meta = (song.metadata ?? {}) as Record<string, unknown>;
    const lyricsSupported = instrumentProfile.isRepresentationSupported('LYRICS');
    const hasPending = Boolean(options.pendingProposalFormats?.includes('LYRICS_ONLY'));
    const hasRejected = Boolean(options.rejectedProposalFormats?.includes('LYRICS_ONLY'));
    const isApproved =
      options.songStatus === 'APPROVED' || meta['approvalStatus'] === 'APPROVED';
    const isDraft =
      options.songStatus === 'DRAFT' ||
      meta['approvalStatus'] === 'DRAFT_REVIEW_REQUIRED' ||
      meta['isAiDraft'] === true;

    const approvalStatus: StandFormatApprovalStatus = hasRejected
      ? 'REJECTED'
      : isApproved
      ? 'APPROVED'
      : hasPending || isDraft
      ? 'PENDING_REVIEW'
      : 'NOT_APPLICABLE';

    const requiredContent = [
      'Texto lírico real de la canción ingresado o importado desde fuente autorizada',
      'Verificación humana (las transcripciones de voz automáticas no se asumen válidas)',
    ];

    if (!lyricsSupported) {
      const reason = `El instrumento "${instrumentProfile.name}" no tiene habilitada capa de letra.`;
      return {
        format: 'LYRICS_ONLY',
        canonicalFormat: 'LYRICS_ONLY',
        label: 'Letra Sola',
        availabilityStatus: 'BLOCKED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Perfil con visualización de letra habilitada'],
        validationErrors: [reason],
        validationWarnings: [],
        evidenceStatus: summary.lyricSyllableCount > 0 ? 'IMPORTED' : 'MISSING',
        reviewRequired: false,
        approvalStatus,
        approvalScope: 'INSTRUMENT_UNSUPPORTED',
        blockingReason: reason,
        shortRestrictionExplanation: reason,
        nextRecommendedAction: 'Seleccionar un instrumento con capa de letra habilitada',
      };
    }

    if (summary.lyricSyllableCount === 0 && !summary.hasUnalignedLyrics) {
      return {
        format: 'LYRICS_ONLY',
        canonicalFormat: 'LYRICS_ONLY',
        label: 'Letra Sola',
        availabilityStatus: hasPending ? 'REVIEW_REQUIRED' : 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Letra verificada de la canción'],
        validationErrors: ['La canción no contiene texto lírico.'],
        validationWarnings: [],
        evidenceStatus: 'MISSING',
        reviewRequired: hasPending,
        approvalStatus,
        approvalScope: 'NO_LYRICS',
        blockingReason: 'No hay letra verificada disponible para esta canción.',
        shortRestrictionExplanation: 'No hay letra verificada disponible.',
        nextRecommendedAction: 'Agregar o importar letra de la canción',
      };
    }

    if (meta['lyricsSource'] === 'UNVERIFIED_AUDIO_SPEECH' && meta['lyricsVerifiedByHuman'] !== true && !isApproved) {
      return {
        format: 'LYRICS_ONLY',
        canonicalFormat: 'LYRICS_ONLY',
        label: 'Letra Sola',
        availabilityStatus: 'REVIEW_REQUIRED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Confirmación humana explícita de la letra'],
        validationErrors: [
          'El texto detectado desde voz/audio no constituye letra verificada sin revisión humana.',
        ],
        validationWarnings: [],
        evidenceStatus: 'AMBIGUOUS',
        reviewRequired: true,
        approvalStatus: 'PENDING_REVIEW',
        approvalScope: 'LYRICS_REVIEW_REQUIRED',
        blockingReason:
          'Se requiere revisión y confirmación humana antes de habilitar Letra Sola.',
        shortRestrictionExplanation: 'Letra requiere verificación humana.',
        nextRecommendedAction: 'Verificar y corregir el texto lírico en el asistente',
      };
    }

    const isPartialLyrics = summary.measureCount >= 16 && summary.lyricCoverageRatio < 0.25;
    const reviewRequired =
      isPartialLyrics || !isApproved && (isDraft || hasPending || meta['lyricsVerifiedByHuman'] === false);
    const evidenceStatus: MusicalContentEvidenceStatus = isApproved || meta['lyricsVerifiedByHuman'] === true
      ? 'HUMAN_VERIFIED'
      : this.resolveBaseEvidence(meta, 'IMPORTED');

    return {
      format: 'LYRICS_ONLY',
      canonicalFormat: 'LYRICS_ONLY',
      label: 'Letra Sola',
      availabilityStatus: isPartialLyrics
        ? 'PARTIAL'
        : isApproved
        ? 'APPROVED'
        : reviewRequired
        ? 'REVIEW_REQUIRED'
        : 'AVAILABLE',
      isAvailable: true,
      requiredContent,
      missingContent: isPartialLyrics
        ? [`Letra completa (${summary.measuresWithLyrics}/${summary.measureCount} compases cubiertos)`]
        : [],
      validationErrors: [],
      validationWarnings: isPartialLyrics
        ? [`Solo ${summary.measuresWithLyrics} de ${summary.measureCount} compases tienen letra; revise si faltan estrofas o coros.`]
        : reviewRequired
        ? ['Letra en borrador pendiente de aprobación para versión canónica oficial.']
        : [],
      evidenceStatus,
      reviewRequired,
      approvalStatus: isPartialLyrics
        ? 'PENDING_REVIEW'
        : isApproved
        ? 'APPROVED'
        : reviewRequired
        ? 'PENDING_REVIEW'
        : 'NOT_APPLICABLE',
      approvalScope: isPartialLyrics ? 'PARTIAL_LYRICS' : isApproved ? 'LYRICS_APPROVED' : 'LYRICS_DRAFT',
      blockingReason: '',
      shortRestrictionExplanation: isPartialLyrics
        ? `Letra parcial (${summary.measuresWithLyrics}/${summary.measureCount} compases).`
        : '',
      nextRecommendedAction: isPartialLyrics
        ? 'Completar las secciones faltantes de letra'
        : reviewRequired
        ? 'Aprobar publicación oficial de la letra'
        : 'Letra lista para lectura',
    };
  }

  private static evaluateTablature(
    song: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    summary: SongContentSummary,
    options: StandCapabilityEvaluationOptions
  ): StandFormatCapabilityDescriptor {
    const meta = (song.metadata ?? {}) as Record<string, unknown>;
    const capoFret = options.capoFret ?? 0;
    const hasPending = Boolean(options.pendingProposalFormats?.includes('TABLATURE'));
    const hasRejected = Boolean(options.rejectedProposalFormats?.includes('TABLATURE'));
    const isApproved =
      options.songStatus === 'APPROVED' || meta['approvalStatus'] === 'APPROVED';
    const isDraft =
      options.songStatus === 'DRAFT' ||
      meta['approvalStatus'] === 'DRAFT_REVIEW_REQUIRED' ||
      meta['isAiDraft'] === true;

    const approvalStatus: StandFormatApprovalStatus = hasRejected
      ? 'REJECTED'
      : isApproved
      ? 'APPROVED'
      : hasPending || isDraft
      ? 'PENDING_REVIEW'
      : 'NOT_APPLICABLE';

    const requiredContent = [
      'Eventos de notas reales verificadas (un acorde por sí solo no define digitación única)',
      'Instrumento de cuerda compatible con número de cuerdas y afinación válidos (p. ej. Guitarra 6 cuerdas o Bajo 4 cuerdas)',
      'Validación de rango de trastes y revisión humana cuando haya posiciones ambiguas',
    ];

    if (instrumentProfile.tuning === undefined || !instrumentProfile.isRepresentationSupported('TABLATURE')) {
      const reason =
        instrumentProfile.tuning === undefined
          ? 'Falta configuración de instrumento de cuerda con afinación definida (ej. Guitarra Acústica, Eléctrica o Bajo).'
          : `El perfil "${instrumentProfile.name}" no soporta tablatura de trastes.`;
      return {
        format: 'TABLATURE',
        canonicalFormat: 'TABLATURE',
        label: 'Tablatura',
        availabilityStatus: 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Instrumento de cuerda y afinación válida'],
        validationErrors: [reason],
        validationWarnings: [],
        evidenceStatus: summary.noteCount > 0 ? this.resolveBaseEvidence(meta, 'IMPORTED') : 'MISSING',
        reviewRequired: false,
        approvalStatus,
        approvalScope: 'MISSING_INSTRUMENT_TUNING',
        blockingReason: reason,
        shortRestrictionExplanation: 'Falta instrumento de cuerda con afinación válida.',
        nextRecommendedAction: 'Seleccionar Guitarra o Bajo con afinación configurada',
      };
    }

    if (summary.noteCount === 0) {
      const hasChordsOnly = summary.chordCount > 0;
      const reason = hasChordsOnly
        ? 'Un símbolo de acorde por sí solo no determina una digitación única de tablatura; se requieren notas melódicas verificadas.'
        : 'Sin eventos de notas verificadas para calcular digitación en cuerdas y trastes.';
      return {
        format: 'TABLATURE',
        canonicalFormat: 'TABLATURE',
        label: 'Tablatura',
        availabilityStatus: hasPending ? 'REVIEW_REQUIRED' : 'MISSING_CONTENT',
        isAvailable: false,
        requiredContent,
        missingContent: ['Eventos de notas melódicas para el cálculo de trastes'],
        validationErrors: [reason],
        validationWarnings: [],
        evidenceStatus: 'MISSING',
        reviewRequired: hasPending,
        approvalStatus,
        approvalScope: 'TABLATURE_NO_NOTES',
        blockingReason: reason,
        shortRestrictionExplanation: hasChordsOnly
          ? 'Acordes insuficientes: faltan notas verificadas.'
          : 'Faltan eventos de notas verificadas.',
        nextRecommendedAction: 'Completar notas e instrumento en el asistente de Tablatura',
        tablatureSummary: {
          tuningName: instrumentProfile.tuning.name,
          stringCount: instrumentProfile.tuning.stringPitches.length,
          capoFret,
          maxFret: 24,
          totalNotes: 0,
          playableCount: 0,
          outOfRangeCount: 0,
          ambiguousCount: 0,
          largeLeapCount: 0,
          humanVerifiedPositionsCount: 0,
          noteCandidates: [],
        },
      };
    }

    const noteCandidates: TablatureNoteCandidateInfo[] = [];
    let playableCount = 0;
    let outOfRangeCount = 0;
    let ambiguousCount = 0;
    let largeLeapCount = 0;
    let humanVerifiedPositionsCount = 0;

    for (const measure of song.measures) {
      let prevFret: number | null = null;
      for (const note of measure.getAllNotes()) {
        const candidates = TablatureCalculator.findCandidates(
          note.pitch,
          instrumentProfile.tuning,
          capoFret
        );
        const override = extractValidatedTablatureOverride(note, instrumentProfile, capoFret);
        const calculated = override
          ? null
          : TablatureCalculator.calculatePosition(
              note.pitch,
              instrumentProfile.tuning,
              capoFret,
              note.durationTicks,
              note.voice
            );

        const selectedString = override?.stringNumber ?? calculated?.stringNumber ?? null;
        const selectedFret = override?.fret ?? calculated?.fret ?? null;
        const isOutOfRange = candidates.length === 0;
        const isAmbiguous = candidates.length > 1 && !override;

        if (isOutOfRange) outOfRangeCount += 1;
        else playableCount += 1;
        if (isAmbiguous) ambiguousCount += 1;
        if (override) humanVerifiedPositionsCount += 1;

        if (selectedFret !== null && prevFret !== null && Math.abs(selectedFret - prevFret) > 5) {
          largeLeapCount += 1;
        }
        if (selectedFret !== null) prevFret = selectedFret;

        noteCandidates.push({
          noteId: note.id,
          measureNumber: measure.number,
          pitch: note.pitch.toString(),
          midiNumber: note.pitch.midiNumber,
          selectedString,
          selectedFret,
          isHumanOverride: Boolean(override),
          isAmbiguous,
          isOutOfRange,
          candidates,
        });
      }
    }

    const tablatureSummary: TablatureFeasibilitySummary = {
      tuningName: instrumentProfile.tuning.name,
      stringCount: instrumentProfile.tuning.stringPitches.length,
      capoFret,
      maxFret: 24,
      totalNotes: summary.noteCount,
      playableCount,
      outOfRangeCount,
      ambiguousCount,
      largeLeapCount,
      humanVerifiedPositionsCount,
      noteCandidates,
    };

    const validationWarnings: string[] = [];
    const validationErrors: string[] = [];

    if (playableCount === 0 && outOfRangeCount > 0) {
      validationErrors.push(
        `Ninguna de las ${outOfRangeCount} nota(s) cabe en el registro de ${instrumentProfile.tuning.name} (con capo ${capoFret}).`
      );
      return {
        format: 'TABLATURE',
        canonicalFormat: 'TABLATURE',
        label: 'Tablatura',
        availabilityStatus: 'BLOCKED',
        isAvailable: false,
        requiredContent,
        missingContent: ['Instrumento o afinación compatible con el registro melódico'],
        validationErrors,
        validationWarnings,
        evidenceStatus: this.resolveBaseEvidence(meta, 'IMPORTED'),
        reviewRequired: true,
        approvalStatus,
        approvalScope: 'OUT_OF_TUNING_RANGE',
        blockingReason: validationErrors[0]!,
        shortRestrictionExplanation: 'Notas fuera del registro del instrumento actual.',
        nextRecommendedAction: 'Revisar afinación, transposición o elegir otro instrumento',
        tablatureSummary,
      };
    }

    if (outOfRangeCount > 0) {
      validationWarnings.push(
        `${outOfRangeCount} nota(s) quedan fuera del diapasón (${instrumentProfile.tuning.name}, capo ${capoFret}).`
      );
    }
    if (ambiguousCount > 0 && meta['tablatureVerified'] !== true) {
      validationWarnings.push(
        `${ambiguousCount} nota(s) admiten múltiples digitaciones posibles en el mástil; se recomienda revisión humana.`
      );
    }
    if (largeLeapCount > 0) {
      validationWarnings.push(
        `Se detectaron ${largeLeapCount} salto(s) amplios de posición (> 5 trastes) entre notas consecutivas.`
      );
    }

    const reviewRequired =
      !isApproved &&
      (isDraft ||
        hasPending ||
        (ambiguousCount > 0 && meta['tablatureVerified'] !== true && (isDraft || hasPending)));

    const evidenceStatus: MusicalContentEvidenceStatus =
      humanVerifiedPositionsCount === summary.noteCount && summary.noteCount > 0
        ? 'HUMAN_VERIFIED'
        : this.resolveBaseEvidence(meta, 'IMPORTED');

    return {
      format: 'TABLATURE',
      canonicalFormat: 'TABLATURE',
      label: 'Tablatura',
      availabilityStatus: isApproved
        ? 'APPROVED'
        : reviewRequired
        ? 'REVIEW_REQUIRED'
        : 'AVAILABLE',
      isAvailable: true,
      requiredContent,
      missingContent: [],
      validationErrors,
      validationWarnings,
      evidenceStatus,
      reviewRequired,
      approvalStatus: isApproved ? 'APPROVED' : reviewRequired ? 'PENDING_REVIEW' : 'NOT_APPLICABLE',
      approvalScope: isApproved ? 'TABLATURE_APPROVED' : 'TABLATURE_PREVIEW',
      blockingReason: '',
      shortRestrictionExplanation: '',
      nextRecommendedAction:
        ambiguousCount > 0
          ? 'Revisar y ajustar digitación cuerda/traste en el asistente'
          : 'Tablatura lista para lectura',
      tablatureSummary,
    };
  }
}
