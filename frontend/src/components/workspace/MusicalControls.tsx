/**
 * @file MusicalControls.tsx
 * @description Contenedor orquestador de controles musicales interactivos (Fase 1G).
 * Agrupa InstrumentSelector, RepresentationSelector, CapoControl, TranspositionControl y ChordNotationControl.
 */

import React from 'react';
import { type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { type ChordNotationSystem, type ViewRepresentation } from '../../core/projection/types.ts';
import { type InstrumentId } from '../../core/workspace/types.ts';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { type UserViewPreferenceData } from '../../core/api/preference-types.ts';
import { instrumentSupportsCapo } from '../../core/workspace/use-musical-workspace.ts';
import { CapoControl } from './CapoControl.tsx';
import { ChordNotationControl } from './ChordNotationControl.tsx';
import { InstrumentSelector } from './InstrumentSelector.tsx';
import { TranspositionControl } from './TranspositionControl.tsx';
import { ReadingFormatSelector, type ReadingFormatId } from './ReadingFormatSelector.tsx';
import { type StandFormatCapabilityDescriptor } from '../../core/workspace/stand-format-capabilities.ts';

const SECONDARY_OVERLAY_META: Partial<Record<ViewRepresentation, { label: string; desc: string }>> = {
  CHORDS: { label: 'Acordes', desc: 'Mostrar cifrado armónico sobre la vista actual' },
  LYRICS: { label: 'Letra', desc: 'Mostrar texto lírico alineado' },
  SECTION_MARKERS: { label: 'Secciones', desc: 'Mostrar Verso, Coro, Puente, Intro' },
};

export interface MusicalControlsProps {
  readonly selectedInstrumentId: InstrumentId;
  readonly availableInstruments: readonly InstrumentProfile[];
  readonly instrumentProfile: InstrumentProfile;
  readonly supportedRepresentations: readonly ViewRepresentation[];
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly capoFret: number;
  readonly transpositionSemitones: number;
  readonly chordNotationSystem: ChordNotationSystem;
  readonly onSelectInstrument: (id: InstrumentId) => void;
  readonly onSelectPrimaryRepresentation: (representation: ViewRepresentation) => void;
  readonly onToggleSecondaryRepresentation: (representation: ViewRepresentation) => void;
  readonly onSetCapo: (fret: number) => void;
  readonly onSetTransposition: (semitones: number) => void;
  readonly onSetChordNotation: (system: ChordNotationSystem) => void;
  // WP-03 / Priority 1: Formatos de lectura y persistencia
  readonly activeSong?: CanonicalMusicPayload | undefined;
  readonly userPreferences?: UserViewPreferenceData | null | undefined;
  readonly isAuthenticated?: boolean | undefined;
  readonly onSelectReadingFormat?: ((primary: ViewRepresentation, secondary: ViewRepresentation[]) => void) | undefined;
  readonly onSavePreference?: ((primary: ViewRepresentation, secondary: ViewRepresentation[]) => Promise<void>) | undefined;
  readonly serverFormatCapabilities?: Partial<Record<ReadingFormatId, StandFormatCapabilityDescriptor>> | null | undefined;
  readonly songStatus?: 'DRAFT' | 'APPROVED' | 'ARCHIVED' | undefined;
  readonly onOpenCompletionWorkflow?: ((formatId: ReadingFormatId) => void) | undefined;
}

export const MusicalControls: React.FC<MusicalControlsProps> = ({
  selectedInstrumentId,
  availableInstruments,
  instrumentProfile,
  supportedRepresentations,
  primaryRepresentation,
  secondaryRepresentations,
  capoFret,
  transpositionSemitones,
  chordNotationSystem,
  onSelectInstrument,
  onSelectPrimaryRepresentation,
  onToggleSecondaryRepresentation,
  onSetCapo,
  onSetTransposition,
  onSetChordNotation,
  activeSong,
  userPreferences,
  isAuthenticated,
  onSelectReadingFormat,
  onSavePreference,
  serverFormatCapabilities,
  songStatus,
  onOpenCompletionWorkflow,
}) => {
  const totalNotesCount = activeSong ? activeSong.getAllNotes().length : 0;
  const totalChordsCount = activeSong ? activeSong.getAllChords().length : 0;
  const totalLyricsCount = activeSong ? activeSong.getAllLyrics().length : 0;
  const hasSectionMarkers = Boolean(activeSong && activeSong.sections.length > 0);
  const isHarmonicChordOnlyLeadSheet = Boolean(
    activeSong &&
      activeSong.measures.length > 0 &&
      totalChordsCount > 0 &&
      totalNotesCount === 0 &&
      totalLyricsCount === 0
  );

  // Capas secundarias contextuales: solo capas de superposición válidas para formato, instrumento y contenido real
  const contextualSecondaryLayers: ViewRepresentation[] = (
    ['CHORDS', 'LYRICS', 'SECTION_MARKERS'] as ViewRepresentation[]
  ).filter((rep) => {
    if (rep === primaryRepresentation) return false;
    if (!supportedRepresentations.includes(rep)) return false;
    if (!activeSong) return false;
    if (rep === 'CHORDS') {
      return totalChordsCount > 0;
    }
    if (rep === 'LYRICS') {
      const lyricsAllowed = serverFormatCapabilities?.LYRICS_ONLY
        ? serverFormatCapabilities.LYRICS_ONLY.isAvailable
        : true;
      return totalLyricsCount > 0 && lyricsAllowed;
    }
    if (rep === 'SECTION_MARKERS') {
      return hasSectionMarkers;
    }
    return false;
  });

  const supportsCapo = instrumentSupportsCapo(instrumentProfile);
  const supportsChords = instrumentProfile.isRepresentationSupported('CHORDS');

  return (
    <section className="musical-controls-section" aria-label="Controles de Visualización y Atril">
      {activeSong && onSelectReadingFormat && (
        <div className="reading-format-container">
          <ReadingFormatSelector
            song={activeSong}
            instrumentProfile={instrumentProfile}
            primaryRepresentation={primaryRepresentation}
            secondaryRepresentations={secondaryRepresentations}
            userPreferences={userPreferences ?? null}
            isAuthenticated={Boolean(isAuthenticated)}
            onSelectFormat={onSelectReadingFormat}
            onSavePreference={onSavePreference}
            serverFormatCapabilities={serverFormatCapabilities}
            evaluationOptions={{ songStatus, capoFret }}
            onOpenCompletionWorkflow={onOpenCompletionWorkflow}
          />

          {contextualSecondaryLayers.length > 0 && (
            <div className="contextual-secondary-layers" role="group" aria-label="Capas secundarias del atril">
              <span className="secondary-layers-label">Capas adicionales:</span>
              <div className="secondary-layers-chips">
                {contextualSecondaryLayers.map((rep) => {
                  const isSelected = secondaryRepresentations.includes(rep);
                  const meta = SECONDARY_OVERLAY_META[rep];
                  return (
                    <button
                      key={`overlay-${rep}`}
                      type="button"
                      aria-pressed={isSelected}
                      className={`pill-btn secondary-layer-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => onToggleSecondaryRepresentation(rep)}
                      title={meta?.desc}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {meta?.label ?? rep}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isHarmonicChordOnlyLeadSheet && activeSong && (
            <div
              role="note"
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'rgba(59, 130, 246, 0.14)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                color: '#bfdbfe',
                fontSize: '0.8rem',
              }}
            >
              🎸 Vista Activa: Guion Armónico / Lead Sheet de Acordes ({totalChordsCount} acordes en{' '}
              {activeSong.measures.length} compases, 0 notas melódicas). Las opciones «Partitura»,
              «Cifrado con Letra», «Letra Sola» y «Tablatura» permanecen deshabilitadas hasta que
              exista su contenido requerido (Principio de Cero Fabricación).
            </div>
          )}
        </div>
      )}

      <div className="unified-adaptation-toolbar" aria-label="Instrumento y adaptaciones musicales">
        <InstrumentSelector
          selectedInstrumentId={selectedInstrumentId}
          availableInstruments={availableInstruments}
          onSelectInstrument={onSelectInstrument}
        />

        <div className="adaptation-controls-group">
          {supportsCapo && (
            <CapoControl
              capoFret={capoFret}
              instrumentSupportsCapo={supportsCapo}
              instrumentName={instrumentProfile.name}
              onSetCapo={onSetCapo}
            />
          )}

          <TranspositionControl
            transpositionSemitones={transpositionSemitones}
            onSetTransposition={onSetTransposition}
          />

          {supportsChords && (
            <ChordNotationControl
              chordNotationSystem={chordNotationSystem}
              onSetChordNotation={onSetChordNotation}
            />
          )}
        </div>
      </div>
    </section>
  );
};
