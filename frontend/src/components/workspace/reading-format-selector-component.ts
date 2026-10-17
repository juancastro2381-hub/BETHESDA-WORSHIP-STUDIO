/**
 * @file reading-format-selector-component.ts
 * @description Componente accesible de selección de formatos de lectura musical y persistencia de vista preferida.
 *
 * Implementado en TypeScript puro con React.createElement para permitir:
 * 1. Renderizado y verificación en pruebas unitarias y de integración de Node.js (react-dom/server renderToStaticMarkup).
 * 2. Cero dependencias adicionales de frameworks de testing de componentes.
 * 3. Ejecución directa bajo node --test --experimental-strip-types sin fallar por sintaxis JSX.
 */

import React, { useState } from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { type ViewRepresentation } from '../../core/projection/types.ts';
import { type UserViewPreferenceData } from '../../core/api/preference-types.ts';

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
}

export interface FormatDefinition {
  readonly id: ReadingFormatId;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly isAvailable: boolean;
  readonly unavailabilityReason?: string;
  readonly primary: ViewRepresentation;
  readonly secondary: ViewRepresentation[];
}

/**
 * Calcula deterministamente las definiciones y disponibilidad de formatos para una canción e instrumento dados.
 */
export function computeFormatDefinitions(
  song: CanonicalMusicPayload,
  instrumentProfile: InstrumentProfile
): FormatDefinition[] {
  // Inspección del contenido canónico de la canción (CERO invención de contenido)
  // Se utiliza getAllNotes() para que los silencios (Rest) NUNCA cuenten como notas (F-03).
  const totalNotes = song.measures.reduce(
    (acc, m) => acc + m.getAllNotes().length,
    0
  );
  const totalChords = song.measures.reduce((acc, m) => acc + m.chords.length, 0);
  const totalLyrics = song.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

  const hasNotes = totalNotes > 0;
  const hasChords = totalChords > 0;
  const hasLyrics = totalLyrics > 0;

  // 1. Partitura / Pentagrama
  const isGrandStaff = instrumentProfile.isRepresentationSupported('GRAND_STAFF');
  const staffRep: ViewRepresentation = isGrandStaff ? 'GRAND_STAFF' : 'STANDARD_NOTATION';
  const staffSupportedByInstrument = instrumentProfile.isRepresentationSupported(staffRep);
  const staffAvailable = staffSupportedByInstrument && hasNotes;
  let staffUnavailability = '';
  if (!hasNotes) {
    staffUnavailability = 'La canción no contiene notas melódicas (Lead Sheet Puro).';
  } else if (!staffSupportedByInstrument) {
    staffUnavailability = `El instrumento "${instrumentProfile.name}" no utiliza notación en pentagrama.`;
  }

  // 2. Cifrado con Letra (requiere tanto acordes armónicos como texto lírico, F-02)
  const chordsSupportedByInstrument = instrumentProfile.isRepresentationSupported('CHORDS');
  const lyricsSupportedByInstrument = instrumentProfile.isRepresentationSupported('LYRICS');
  const chordChartAvailable =
    chordsSupportedByInstrument && lyricsSupportedByInstrument && hasChords && hasLyrics;
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
  }

  // 3. Letra Sola
  const lyricsAvailable = lyricsSupportedByInstrument && hasLyrics;
  let lyricsUnavailability = '';
  if (!hasLyrics) {
    lyricsUnavailability = 'La canción no contiene texto lírico.';
  } else if (!lyricsSupportedByInstrument) {
    lyricsUnavailability = `El instrumento "${instrumentProfile.name}" no tiene habilitada capa de letra.`;
  }

  // 4. Tablatura
  const tabSupportedByInstrument =
    instrumentProfile.tuning !== undefined && instrumentProfile.isRepresentationSupported('TABLATURE');
  const tabAvailable = tabSupportedByInstrument && hasNotes;
  let tabUnavailability = '';
  if (instrumentProfile.tuning === undefined) {
    tabUnavailability = 'No aplicable: requiere instrumento de cuerda (Guitarra o Bajo).';
  } else if (!hasNotes) {
    tabUnavailability = 'Sin notas melódicas para calcular digitación en trastes.';
  } else if (!tabSupportedByInstrument) {
    tabUnavailability = 'Tablatura no soportada en el perfil del instrumento.';
  }

  return [
    {
      id: 'STAFF_NOTATION',
      label: isGrandStaff ? 'Gran Pentagrama' : 'Partitura',
      icon: '𝄞',
      description: 'Notación tradicional con compases y notas',
      isAvailable: staffAvailable,
      unavailabilityReason: staffUnavailability,
      primary: staffRep,
      secondary: [],
    },
    {
      id: 'CHORD_CHART',
      label: 'Cifrado con Letra',
      icon: '𝄢',
      description: 'Acordes sobre el texto lírico (Lead Sheet)',
      isAvailable: chordChartAvailable,
      unavailabilityReason: chordChartUnavailability,
      primary: 'CHORDS',
      secondary: ['LYRICS', 'SECTION_MARKERS'],
    },
    {
      id: 'LYRICS_ONLY',
      label: 'Letra Sola',
      icon: '📝',
      description: 'Texto lírico completo sin acordes ni pentagramas',
      isAvailable: lyricsAvailable,
      unavailabilityReason: lyricsUnavailability,
      primary: 'LYRICS',
      secondary: ['SECTION_MARKERS'],
    },
    {
      id: 'TABLATURE',
      label: 'Tablatura',
      icon: '🎸',
      description: 'Diagrama con cuerdas y trastes reales',
      isAvailable: tabAvailable,
      unavailabilityReason: tabUnavailability,
      primary: 'TABLATURE',
      secondary: hasChords ? ['CHORDS'] : [],
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
}) => {
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const formats = computeFormatDefinitions(song, instrumentProfile);

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

  // Comprobar si la selección actual coincide con la preferencia guardada en PostgreSQL
  const isCurrentMatchingSavedPreference = Boolean(
    userPreferences &&
      userPreferences.primaryRepresentation === primaryRepresentation &&
      userPreferences.instrumentId === instrumentProfile.id
  );

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

  // Renderizado mediante React.createElement (idéntico al DOM original)
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
            isSelected ? React.createElement('span', { className: 'fmt-check', 'aria-hidden': 'true' }, '✓') : null
          ),
          React.createElement('div', { className: 'fmt-desc' }, fmt.description),
          !fmt.isAvailable
            ? React.createElement(
                'div',
                { id: `fmt-unavail-${fmt.id}`, className: 'fmt-unavail-badge' },
                `🚫 ${fmt.unavailabilityReason}`
              )
            : null
        );
      })
    )
  );
};
