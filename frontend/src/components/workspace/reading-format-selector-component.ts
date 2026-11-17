/**
 * @file reading-format-selector-component.ts
 * @description Componente accesible de selección de formatos de lectura musical, visualización de
 * disponibilidad inteligente, estado de preferencia vs disponibilidad real, y acciones contextuales
 * para completar contenido musical faltante (Scope 1C Integration).
 *
 * Implementado en TypeScript puro con React.createElement para compatibilidad directa con
 * react-dom/server y ejecución bajo node --test / tsx.
 */

import React, { useState } from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { type ViewRepresentation } from '../../core/projection/types.ts';
import { type UserViewPreferenceData } from '../../core/api/preference-types.ts';
import {
  StandFormatCapabilityResolver,
  type LeadSheetCompletionState,
  type MusicalContentEvidenceStatus,
  type StandCapabilityEvaluationOptions,
  type StandFormatApprovalStatus,
  type StandFormatAvailabilityStatus,
  type StandFormatCapabilityDescriptor,
  type TablatureFeasibilitySummary,
} from '../../core/workspace/stand-format-capabilities.ts';

export type ReadingFormatId = 'STAFF_NOTATION' | 'CHORD_CHART' | 'LYRICS_ONLY' | 'TABLATURE';

export interface ReadingFormatSelectorProps {
  readonly song: CanonicalMusicPayload;
  readonly instrumentProfile: InstrumentProfile;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly userPreferences: UserViewPreferenceData | null;
  readonly isAuthenticated: boolean;
  readonly onSelectFormat: (primary: ViewRepresentation, secondary: ViewRepresentation[]) => void;
  readonly onSavePreference?: ((primary: ViewRepresentation, secondary: ViewRepresentation[]) => Promise<void>) | undefined;
  readonly serverFormatCapabilities?: Partial<Record<ReadingFormatId, StandFormatCapabilityDescriptor>> | null | undefined;
  readonly evaluationOptions?: StandCapabilityEvaluationOptions | undefined;
  readonly onOpenCompletionWorkflow?: ((formatId: ReadingFormatId) => void) | undefined;
}

export interface FormatDefinition {
  readonly id: ReadingFormatId;
  readonly canonicalFormat?: 'PARTITURE' | 'CHORDS_WITH_LYRICS' | 'LYRICS_ONLY' | 'TABLATURE';
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly isAvailable: boolean;
  readonly unavailabilityReason?: string;
  readonly primary: ViewRepresentation;
  readonly secondary: ViewRepresentation[];
  readonly availabilityStatus?: StandFormatAvailabilityStatus;
  readonly requiredContent?: readonly string[];
  readonly missingContent?: readonly string[];
  readonly validationErrors?: readonly string[];
  readonly validationWarnings?: readonly string[];
  readonly evidenceStatus?: MusicalContentEvidenceStatus;
  readonly reviewRequired?: boolean;
  readonly approvalStatus?: StandFormatApprovalStatus;
  readonly approvalScope?: string;
  readonly shortRestrictionExplanation?: string;
  readonly nextRecommendedAction?: string;
  readonly leadSheetState?: LeadSheetCompletionState;
  readonly tablatureSummary?: TablatureFeasibilitySummary;
}

function getAvailabilityBadgeLabel(status: StandFormatAvailabilityStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'APROBADO';
    case 'AVAILABLE':
      return 'DISPONIBLE';
    case 'REVIEW_REQUIRED':
      return 'REVISIÓN REQUERIDA';
    case 'INCOMPLETE':
      return 'INCOMPLETO';
    case 'VALIDATION_REQUIRED':
      return 'VALIDACIÓN REQUERIDA';
    case 'BLOCKED':
      return 'BLOQUEADO';
    case 'MISSING_CONTENT':
    default:
      return 'CONTENIDO FALTANTE';
  }
}

function getEvidenceBadgeLabel(ev: MusicalContentEvidenceStatus): string {
  switch (ev) {
    case 'HUMAN_VERIFIED':
      return 'Verificado por humano';
    case 'IMPORTED':
      return 'Importado';
    case 'MANUALLY_ENTERED':
      return 'Ingresado manualmente';
    case 'DETECTED':
      return 'Detectado';
    case 'ESTIMATED':
      return 'Estimado';
    case 'AMBIGUOUS':
      return 'Ambiguo';
    case 'MIXED':
      return 'Mixto';
    case 'MISSING':
    default:
      return 'Sin contenido';
  }
}

function formatPreferredRepLabel(rep: ViewRepresentation | string): string {
  switch (rep) {
    case 'STANDARD_NOTATION':
    case 'GRAND_STAFF':
      return 'Partitura';
    case 'CHORDS':
      return 'Cifrado con Letra / Acordes';
    case 'LYRICS':
      return 'Letra Sola';
    case 'TABLATURE':
      return 'Tablatura';
    default:
      return String(rep);
  }
}

function mapPreferenceRepToFormatId(rep: string): ReadingFormatId | null {
  if (rep === 'STANDARD_NOTATION' || rep === 'GRAND_STAFF') return 'STAFF_NOTATION';
  if (rep === 'CHORDS') return 'CHORD_CHART';
  if (rep === 'LYRICS') return 'LYRICS_ONLY';
  if (rep === 'TABLATURE') return 'TABLATURE';
  return null;
}

/**
 * Calcula deterministamente las definiciones y disponibilidad de formatos para una canción e instrumento dados,
 * integrando las evaluaciones autoritativas del backend cuando están disponibles.
 */
export function computeFormatDefinitions(
  song: CanonicalMusicPayload,
  instrumentProfile: InstrumentProfile,
  options?: {
    evaluationOptions?: StandCapabilityEvaluationOptions | undefined;
    serverCapabilities?: Partial<Record<ReadingFormatId, StandFormatCapabilityDescriptor>> | null | undefined;
  }
): FormatDefinition[] {
  const localEvaluations = StandFormatCapabilityResolver.evaluateAll(
    song,
    instrumentProfile,
    options?.evaluationOptions
  );

  // Inspección del contenido canónico de la canción (CERO invención de contenido)
  // Se utiliza getAllNotes() para que los silencios (Rest) NUNCA cuenten como notas (F-03).
  const totalNotes = song.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
  const totalChords = song.measures.reduce((acc, m) => acc + m.chords.length, 0);
  const totalLyrics = song.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

  const hasNotes = totalNotes > 0;
  const hasChords = totalChords > 0;
  const hasLyrics = totalLyrics > 0;

  // 1. Partitura / Pentagrama
  const isGrandStaff = instrumentProfile.isRepresentationSupported('GRAND_STAFF');
  const staffRep: ViewRepresentation = isGrandStaff ? 'GRAND_STAFF' : 'STANDARD_NOTATION';
  const staffSupportedByInstrument = instrumentProfile.isRepresentationSupported(staffRep);
  const staffEval = options?.serverCapabilities?.STAFF_NOTATION ?? localEvaluations.STAFF_NOTATION;
  const staffAvailable = options?.serverCapabilities?.STAFF_NOTATION
    ? staffEval.isAvailable && staffSupportedByInstrument
    : staffSupportedByInstrument && hasNotes && staffEval.isAvailable;

  let staffUnavailability = '';
  if (!hasNotes) {
    staffUnavailability = 'La canción no contiene notas melódicas (Lead Sheet Puro).';
  } else if (!staffSupportedByInstrument) {
    staffUnavailability = `El instrumento "${instrumentProfile.name}" no utiliza notación en pentagrama.`;
  } else if (!staffAvailable) {
    staffUnavailability = staffEval.blockingReason || 'La partitura requiere revisión o validación antes de mostrarse.';
  }

  // 2. Cifrado con Letra
  const chordsSupportedByInstrument = instrumentProfile.isRepresentationSupported('CHORDS');
  const lyricsSupportedByInstrument = instrumentProfile.isRepresentationSupported('LYRICS');
  const chordChartEval = options?.serverCapabilities?.CHORD_CHART ?? localEvaluations.CHORD_CHART;
  const chordChartAvailable = options?.serverCapabilities?.CHORD_CHART
    ? chordChartEval.isAvailable && chordsSupportedByInstrument && lyricsSupportedByInstrument
    : chordsSupportedByInstrument && lyricsSupportedByInstrument && hasChords && hasLyrics && chordChartEval.isAvailable;

  let chordChartUnavailability = '';
  if (!hasChords && !hasLyrics) {
    chordChartUnavailability = 'La canción no contiene acordes de cifrado ni texto lírico.';
  } else if (!hasChords) {
    chordChartUnavailability = 'La canción no contiene acordes de cifrado armónico.';
  } else if (!hasLyrics) {
    chordChartUnavailability = 'La canción no contiene texto lírico para acompañar el cifrado.';
  } else if (!chordsSupportedByInstrument) {
    chordChartUnavailability = `El instrumento "${instrumentProfile.name}" no soporta cifrado.`;
  } else if (!lyricsSupportedByInstrument) {
    chordChartUnavailability = `El instrumento "${instrumentProfile.name}" no soporta capa de letra.`;
  } else if (!chordChartAvailable) {
    chordChartUnavailability = chordChartEval.blockingReason || 'El cifrado con letra requiere alineación o revisión.';
  }

  // 3. Letra Sola
  const lyricsEval = options?.serverCapabilities?.LYRICS_ONLY ?? localEvaluations.LYRICS_ONLY;
  const lyricsAvailable = options?.serverCapabilities?.LYRICS_ONLY
    ? lyricsEval.isAvailable && lyricsSupportedByInstrument
    : lyricsSupportedByInstrument && hasLyrics && lyricsEval.isAvailable;

  let lyricsUnavailability = '';
  if (!hasLyrics && !lyricsEval.missingContent.length && lyricsSupportedByInstrument) {
    lyricsUnavailability = 'La canción no contiene texto lírico.';
  } else if (!hasLyrics) {
    lyricsUnavailability = 'La canción no contiene texto lírico.';
  } else if (!lyricsSupportedByInstrument) {
    lyricsUnavailability = `El instrumento "${instrumentProfile.name}" no tiene habilitada capa de letra.`;
  } else if (!lyricsAvailable) {
    lyricsUnavailability = lyricsEval.blockingReason || 'La letra requiere verificación humana.';
  }

  // 4. Tablatura
  const tabSupportedByInstrument =
    instrumentProfile.tuning !== undefined && instrumentProfile.isRepresentationSupported('TABLATURE');
  const tabEval = options?.serverCapabilities?.TABLATURE ?? localEvaluations.TABLATURE;
  const tabAvailable = options?.serverCapabilities?.TABLATURE
    ? tabEval.isAvailable && tabSupportedByInstrument
    : tabSupportedByInstrument && hasNotes && tabEval.isAvailable;

  let tabUnavailability = '';
  if (instrumentProfile.tuning === undefined) {
    tabUnavailability = 'No aplicable: requiere instrumento de cuerda (Guitarra o Bajo).';
  } else if (!hasNotes) {
    tabUnavailability = 'Sin notas melódicas para calcular digitación en trastes.';
  } else if (!tabSupportedByInstrument) {
    tabUnavailability = 'Tablatura no soportada en el perfil del instrumento.';
  } else if (!tabAvailable) {
    tabUnavailability = tabEval.blockingReason || 'La tablatura requiere revisión de afinación o posiciones.';
  }

  return [
    {
      id: 'STAFF_NOTATION',
      canonicalFormat: 'PARTITURE',
      label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
      icon: '𝄞',
      description: 'Notación tradicional con compases y notas',
      isAvailable: staffAvailable,
      unavailabilityReason: staffUnavailability,
      primary: staffRep,
      secondary: [],
      availabilityStatus: staffEval.availabilityStatus,
      requiredContent: staffEval.requiredContent,
      missingContent: staffEval.missingContent,
      validationErrors: staffEval.validationErrors,
      validationWarnings: staffEval.validationWarnings,
      evidenceStatus: staffEval.evidenceStatus,
      reviewRequired: staffEval.reviewRequired,
      approvalStatus: staffEval.approvalStatus,
      approvalScope: staffEval.approvalScope,
      shortRestrictionExplanation:
        staffEval.shortRestrictionExplanation || staffUnavailability,
      nextRecommendedAction: staffEval.nextRecommendedAction,
    },
    {
      id: 'CHORD_CHART',
      canonicalFormat: 'CHORDS_WITH_LYRICS',
      label: 'Cifrado con Letra',
      icon: '𝄢',
      description: 'Acordes sobre el texto lírico (Lead Sheet)',
      isAvailable: chordChartAvailable,
      unavailabilityReason: chordChartUnavailability,
      primary: 'CHORDS',
      secondary: ['LYRICS', 'SECTION_MARKERS'],
      availabilityStatus: chordChartEval.availabilityStatus,
      requiredContent: chordChartEval.requiredContent,
      missingContent: chordChartEval.missingContent,
      validationErrors: chordChartEval.validationErrors,
      validationWarnings: chordChartEval.validationWarnings,
      evidenceStatus: chordChartEval.evidenceStatus,
      reviewRequired: chordChartEval.reviewRequired,
      approvalStatus: chordChartEval.approvalStatus,
      approvalScope: chordChartEval.approvalScope,
      shortRestrictionExplanation:
        chordChartEval.shortRestrictionExplanation || chordChartUnavailability,
      nextRecommendedAction: chordChartEval.nextRecommendedAction,
      ...(chordChartEval.leadSheetState ? { leadSheetState: chordChartEval.leadSheetState } : {}),
    },
    {
      id: 'LYRICS_ONLY',
      canonicalFormat: 'LYRICS_ONLY',
      label: 'Letra Sola',
      icon: '📝',
      description: 'Texto lírico completo sin acordes ni pentagramas',
      isAvailable: lyricsAvailable,
      unavailabilityReason: lyricsUnavailability,
      primary: 'LYRICS',
      secondary: ['SECTION_MARKERS'],
      availabilityStatus: lyricsEval.availabilityStatus,
      requiredContent: lyricsEval.requiredContent,
      missingContent: lyricsEval.missingContent,
      validationErrors: lyricsEval.validationErrors,
      validationWarnings: lyricsEval.validationWarnings,
      evidenceStatus: lyricsEval.evidenceStatus,
      reviewRequired: lyricsEval.reviewRequired,
      approvalStatus: lyricsEval.approvalStatus,
      approvalScope: lyricsEval.approvalScope,
      shortRestrictionExplanation:
        lyricsEval.shortRestrictionExplanation || lyricsUnavailability,
      nextRecommendedAction: lyricsEval.nextRecommendedAction,
    },
    {
      id: 'TABLATURE',
      canonicalFormat: 'TABLATURE',
      label: 'Tablatura',
      icon: '🎸',
      description: 'Diagrama con cuerdas y trastes reales',
      isAvailable: tabAvailable,
      unavailabilityReason: tabUnavailability,
      primary: 'TABLATURE',
      secondary: hasChords ? ['CHORDS'] : [],
      availabilityStatus: tabEval.availabilityStatus,
      requiredContent: tabEval.requiredContent,
      missingContent: tabEval.missingContent,
      validationErrors: tabEval.validationErrors,
      validationWarnings: tabEval.validationWarnings,
      evidenceStatus: tabEval.evidenceStatus,
      reviewRequired: tabEval.reviewRequired,
      approvalStatus: tabEval.approvalStatus,
      approvalScope: tabEval.approvalScope,
      shortRestrictionExplanation:
        tabEval.shortRestrictionExplanation || tabUnavailability,
      nextRecommendedAction: tabEval.nextRecommendedAction,
      ...(tabEval.tablatureSummary ? { tablatureSummary: tabEval.tablatureSummary } : {}),
    },
  ];
}

export const ReadingFormatSelector: React.FC<ReadingFormatSelectorProps> = ({
  song,
  instrumentProfile,
  primaryRepresentation,
  secondaryRepresentations,
  userPreferences,
  isAuthenticated,
  onSelectFormat,
  onSavePreference,
  serverFormatCapabilities,
  evaluationOptions,
  onOpenCompletionWorkflow,
}) => {
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const formats = computeFormatDefinitions(song, instrumentProfile, {
    evaluationOptions,
    serverCapabilities: serverFormatCapabilities,
  });

  // Detección de cuál formato coincide con la selección actual
  const currentFormatId: ReadingFormatId | 'CUSTOM' = (() => {
    if (primaryRepresentation === 'STANDARD_NOTATION' || primaryRepresentation === 'GRAND_STAFF') {
      return 'STAFF_NOTATION';
    }
    if (primaryRepresentation === 'CHORDS') {
      return 'CHORD_CHART';
    }
    if (primaryRepresentation === 'LYRICS' && !secondaryRepresentations.includes('CHORDS')) {
      return 'LYRICS_ONLY';
    }
    if (primaryRepresentation === 'TABLATURE') {
      return 'TABLATURE';
    }
    return 'CUSTOM';
  })();

  const isCurrentMatchingSavedPreference = Boolean(
    userPreferences &&
      userPreferences.primaryRepresentation === primaryRepresentation &&
      userPreferences.instrumentId === instrumentProfile.id
  );

  // Estado separado de Formato Preferido vs Disponibilidad Actual
  const savedPreferredFormatId = userPreferences
    ? mapPreferenceRepToFormatId(userPreferences.primaryRepresentation)
    : null;
  const savedPreferredDef = savedPreferredFormatId
    ? formats.find((f) => f.id === savedPreferredFormatId) ?? null
    : null;
  const isPreferredCurrentlyUnavailable = Boolean(savedPreferredDef && !savedPreferredDef.isAvailable);

  const handleSelect = (fmt: FormatDefinition) => {
    if (!fmt.isAvailable) return;
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);
    onSelectFormat(fmt.primary, fmt.secondary);
  };

  const handleSavePreferenceClick = async () => {
    if (!onSavePreference) return;
    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    try {
      await onSavePreference(primaryRepresentation, [...secondaryRepresentations]);
      setSaveSuccessMessage('¡Vista guardada como preferida para tu usuario!');
    } catch (err: any) {
      setSaveErrorMessage(err.message || 'Error al guardar preferencia de vista.');
    } finally {
      setIsSaving(false);
    }
  };

  const incompleteFormats = formats.filter((f) => !f.isAvailable || f.reviewRequired);

  return React.createElement(
    'div',
    { className: 'reading-format-selector-card control-card', 'aria-label': 'Formatos de Lectura Musical' },
    React.createElement(
      'div',
      { className: 'format-selector-header' },
      React.createElement(
        'label',
        { className: 'control-card-label', id: 'reading-format-label' },
        'Formato de Lectura de Atril (Selección del Músico):'
      ),
      isAuthenticated && onSavePreference
        ? React.createElement(
            'div',
            { className: 'preference-save-wrapper' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: `btn-save-preference ${isCurrentMatchingSavedPreference ? 'is-preferred' : ''}`,
                onClick: handleSavePreferenceClick,
                disabled: isSaving || isCurrentMatchingSavedPreference,
                title: isCurrentMatchingSavedPreference
                  ? 'Esta vista es tu preferencia actual guardada en el servidor'
                  : 'Guardar la vista actual como tu preferencia por defecto',
                'aria-label': 'Guardar vista actual como preferencia del músico',
              },
              isSaving
                ? [
                    React.createElement('span', { key: 'spinner', className: 'auth-spinner-sm', 'aria-hidden': 'true' }),
                    React.createElement('span', { key: 'txt' }, 'Guardando...'),
                  ]
                : isCurrentMatchingSavedPreference
                ? [
                    React.createElement('span', { key: 'star', 'aria-hidden': 'true' }, '★'),
                    React.createElement('span', { key: 'txt' }, 'Vista Preferida Guardada'),
                  ]
                : [
                    React.createElement('span', { key: 'star', 'aria-hidden': 'true' }, '☆'),
                    React.createElement('span', { key: 'txt' }, 'Guardar como Preferida'),
                  ]
            )
          )
        : null
    ),
    isPreferredCurrentlyUnavailable && savedPreferredDef
      ? React.createElement(
          'div',
          { className: 'preferred-vs-available-banner', role: 'status' },
          React.createElement(
            'div',
            { className: 'preferred-vs-available-text' },
            React.createElement('strong', null, '★ Formato preferido conservado: '),
            `${savedPreferredDef.label} (${formatPreferredRepLabel(userPreferences!.primaryRepresentation)}) no se sobrescribió, pero no puede mostrarse en esta canción. `,
            React.createElement('strong', null, 'Vista activa compatible: '),
            `${formatPreferredRepLabel(primaryRepresentation)}. `,
            React.createElement('span', { className: 'preferred-reason-detail' }, savedPreferredDef.shortRestrictionExplanation)
          ),
          onOpenCompletionWorkflow
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'btn-complete-preferred-format',
                  onClick: () => onOpenCompletionWorkflow(savedPreferredDef.id),
                },
                `➕ ${savedPreferredDef.nextRecommendedAction}`
              )
            : null
        )
      : null,
    saveSuccessMessage
      ? React.createElement(
          'div',
          { className: 'format-feedback success', role: 'status' },
          React.createElement('span', null, '✓'),
          React.createElement('span', null, saveSuccessMessage)
        )
      : null,
    saveErrorMessage
      ? React.createElement(
          'div',
          { className: 'format-feedback error', role: 'alert' },
          React.createElement('span', null, '⚠️'),
          React.createElement('span', null, saveErrorMessage)
        )
      : null,
    React.createElement(
      'div',
      {
        className: 'reading-format-buttons',
        role: 'radiogroup',
        'aria-labelledby': 'reading-format-label',
      },
      formats.map((fmt) => {
        const isSelected = currentFormatId === fmt.id;
        const availabilityStatus: StandFormatAvailabilityStatus =
          fmt.availabilityStatus ?? (fmt.isAvailable ? 'AVAILABLE' : 'MISSING_CONTENT');
        const evidenceStatus: MusicalContentEvidenceStatus = fmt.evidenceStatus ?? 'MISSING';
        const missingContent = fmt.missingContent ?? [];
        const nextRecommendedAction = fmt.nextRecommendedAction ?? '';
        return React.createElement(
          'button',
          {
            key: fmt.id,
            type: 'button',
            role: 'radio',
            'aria-checked': isSelected,
            disabled: !fmt.isAvailable,
            className: `btn-reading-format ${isSelected ? 'active' : ''} ${
              !fmt.isAvailable ? 'disabled-unavailable' : ''
            }`,
            onClick: () => handleSelect(fmt),
            title: fmt.isAvailable ? fmt.description : fmt.unavailabilityReason,
            'aria-describedby': !fmt.isAvailable ? `fmt-unavail-${fmt.id}` : undefined,
          },
          React.createElement(
            'div',
            { className: 'fmt-top' },
            React.createElement('span', { className: 'fmt-icon', 'aria-hidden': 'true' }, fmt.icon),
            React.createElement('span', { className: 'fmt-label' }, fmt.label),
            React.createElement(
              'span',
              {
                className: `fmt-status-pill status-${availabilityStatus.toLowerCase()}`,
              },
              getAvailabilityBadgeLabel(availabilityStatus)
            ),
            isSelected ? React.createElement('span', { className: 'fmt-check', 'aria-hidden': 'true' }, '✓') : null
          ),
          React.createElement('div', { className: 'fmt-desc' }, fmt.description),
          React.createElement(
            'div',
            { className: 'fmt-evidence-meta' },
            `Evidencia: ${getEvidenceBadgeLabel(evidenceStatus)}`,
            fmt.approvalStatus === 'PENDING_REVIEW'
              ? ' • Pendiente de aprobación'
              : fmt.approvalStatus === 'APPROVED'
              ? ' • Publicado'
              : ''
          ),
          !fmt.isAvailable
            ? React.createElement(
                'div',
                { id: `fmt-unavail-${fmt.id}`, className: 'fmt-unavail-badge' },
                `🚫 ${fmt.unavailabilityReason}`,
                missingContent.length > 0
                  ? React.createElement(
                      'div',
                      { className: 'fmt-missing-hint' },
                      `Falta: ${missingContent[0]} • Acción: ${nextRecommendedAction}`
                    )
                  : null
              )
            : null
        );
      })
    ),
    onOpenCompletionWorkflow && incompleteFormats.length > 0
      ? React.createElement(
          'div',
          {
            className: 'reading-format-completion-actions',
            'aria-label': 'Asistentes para completar información musical faltante',
          },
          React.createElement(
            'div',
            { className: 'completion-actions-header' },
            '🧩 Completar información musical faltante para habilitar más formatos (sin fabricación artificial):'
          ),
          React.createElement(
            'div',
            { className: 'completion-actions-grid' },
            incompleteFormats.map((fmt) => {
              const nextAction = fmt.nextRecommendedAction ?? 'Completar información';
              return React.createElement(
                'button',
                {
                  key: `complete-${fmt.id}`,
                  type: 'button',
                  className: `btn-complete-format-action ${!fmt.isAvailable ? 'is-missing' : 'is-review'}`,
                  onClick: () => onOpenCompletionWorkflow(fmt.id),
                },
                React.createElement('span', { className: 'complete-btn-title' }, `${fmt.icon} ${fmt.label}`),
                React.createElement(
                  'span',
                  { className: 'complete-btn-cta' },
                  fmt.reviewRequired && fmt.isAvailable
                    ? `📝 ${nextAction}`
                    : `➕ ${nextAction}`
                )
              );
            })
          )
        )
      : null
  );
};
