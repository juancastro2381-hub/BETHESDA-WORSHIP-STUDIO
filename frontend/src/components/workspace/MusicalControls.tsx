/**
 * @file MusicalControls.tsx
 * @description Contenedor orquestador de controles musicales interactivos (Fase 1G).
 * Agrupa InstrumentSelector, RepresentationSelector, CapoControl, TranspositionControl y ChordNotationControl.
 */

import React from 'react';
import { type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { type ChordNotationSystem, type ViewRepresentation } from '../../core/projection/types.ts';
import { type InstrumentId } from '../../core/workspace/types.ts';
import { instrumentSupportsCapo } from '../../core/workspace/use-musical-workspace.ts';
import { CapoControl } from './CapoControl.tsx';
import { ChordNotationControl } from './ChordNotationControl.tsx';
import { InstrumentSelector } from './InstrumentSelector.tsx';
import { RepresentationSelector } from './RepresentationSelector.tsx';
import { TranspositionControl } from './TranspositionControl.tsx';

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
}) => {
  return (
    <section className="musical-controls-section" aria-label="Controles de Visualización y Atril">
      <div className="controls-grid">
        <InstrumentSelector
          selectedInstrumentId={selectedInstrumentId}
          availableInstruments={availableInstruments}
          onSelectInstrument={onSelectInstrument}
        />

        <RepresentationSelector
          supportedRepresentations={supportedRepresentations}
          primaryRepresentation={primaryRepresentation}
          secondaryRepresentations={secondaryRepresentations}
          onSelectPrimary={onSelectPrimaryRepresentation}
          onToggleSecondary={onToggleSecondaryRepresentation}
        />

        <div className="controls-subgrid">
          <CapoControl
            capoFret={capoFret}
            instrumentSupportsCapo={instrumentSupportsCapo(instrumentProfile)}
            instrumentName={instrumentProfile.name}
            onSetCapo={onSetCapo}
          />

          <TranspositionControl
            transpositionSemitones={transpositionSemitones}
            onSetTransposition={onSetTransposition}
          />

          <ChordNotationControl
            chordNotationSystem={chordNotationSystem}
            onSetChordNotation={onSetChordNotation}
          />
        </div>
      </div>
    </section>
  );
};
