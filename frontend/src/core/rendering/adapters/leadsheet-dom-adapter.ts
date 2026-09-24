/**
 * @file leadsheet-dom-adapter.ts
 * @description Adaptador aislado para LeadSheetDOM (Fase 1E & 1F).
 *
 * Responsabilidades:
 * - Renderizar vistas de atril de cifrado armónico y letras (Lead Sheet / Guion de Acordes)
 * - Renderizado en DOM real del navegador con tipografía semántica y estilos CSS responsivos
 * - Soporte estricto contra XSS (uso exclusivo de document.createElement y textContent, CERO innerHTML inseguro)
 * - Invariante estricto no negociable:
 *   "Para contenido originado en ChordPro sin melodía: CERO NOTAS MELÓDICAS DEBEN SEGUIR SIENDO CERO NOTAS.
 *    El visualizador jamás debe inventar notas."
 */

import { type DerivedMusicalView } from '../../projection/derived-musical-view.ts';
import { type ViewRepresentation } from '../../projection/types.ts';
import { BaseMusicRenderer } from '../renderer-contract.ts';
import { type RendererCapabilities, type RendererId } from '../types.ts';

export interface LeadSheetTokenData {
  chord?: string | undefined;
  syllable?: string | undefined;
  isHyphenated: boolean;
  tickOffset: number;
}

export interface LeadSheetMeasureData {
  measureNumber: number;
  timeSignature: string;
  chords: {
    startTick: number;
    symbol: string;
    soundingSymbol: string;
    fingeringSymbol: string;
  }[];
  tokens: LeadSheetTokenData[];
}

export interface LeadSheetSectionData {
  id: string;
  label: string;
  type: string;
  startMeasure: number;
  endMeasure: number;
  measures: LeadSheetMeasureData[];
}

export interface LeadSheetData {
  title: string;
  concertKey: string;
  displayKey: string;
  capo: number;
  totalMelodyNotes: number;
  sections: LeadSheetSectionData[];
}

export class LeadSheetDomAdapter extends BaseMusicRenderer<LeadSheetData> {
  public readonly id: RendererId = 'LEADSHEET_DOM';
  public readonly name = 'LeadSheet DOM Engine Adapter';

  private resizeObserver?: ResizeObserver | undefined;

  public readonly capabilities: RendererCapabilities = {
    rendererId: 'LEADSHEET_DOM',
    name: 'LeadSheetDOM',
    supportedRepresentations: [
      'CHORDS',
      'LYRICS',
      'SECTION_MARKERS',
    ],
    supportsPolyphony: false,
    supportsTablature: false,
    supportsGrandStaff: false,
    supportsLyrics: true,
    supportsChords: true,
    supportsPercussion: false,
    canRender: (requested: readonly ViewRepresentation[]): boolean => {
      if (
        requested.includes('TABLATURE') ||
        requested.includes('GRAND_STAFF') ||
        requested.includes('PERCUSSION_NOTATION') ||
        requested.includes('STANDARD_NOTATION')
      ) {
        return false;
      }
      return requested.every((rep) =>
        ['CHORDS', 'LYRICS', 'SECTION_MARKERS'].includes(rep)
      );
    },
  };

  public override dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    const container = this.getContainerElement();
    if (container) {
      container.replaceChildren();
    }
    super.dispose();
  }

  protected convertViewToData(view: DerivedMusicalView): LeadSheetData {
    this.clearDiagnostics();

    // Invariante: contar notas derivadas; no inventar ninguna
    const totalMelodyNotes = view.getAllNotes().length;

    // Si la vista contiene 0 notas de melodía, verificar que continúen siendo 0
    if (totalMelodyNotes === 0) {
      this.addDiagnostic(
        'INFO',
        'ZERO_MELODY_NOTES_PRESERVED',
        'La vista derivada no contiene notas melódicas (Lead Sheet puro). Preservado conteo 0 sin invención.'
      );
    }

    const measuresData: LeadSheetMeasureData[] = view.measures.map((measure) => {
      const timeSigStr = `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`;

      const chordsData = measure.chords.map((c) => ({
        startTick: c.startTick,
        symbol: c.displayString,
        soundingSymbol: c.soundingDisplayString,
        fingeringSymbol: c.fingeringChord.toString(view.viewPreference.chordNotationSystem),
      }));

      // Alinear acordes con sílabas
      const tokens: LeadSheetTokenData[] = [];

      for (const lyr of measure.lyrics) {
        const chordAtTick = chordsData.find((c) => c.startTick === lyr.tickOffset);
        tokens.push({
          chord: chordAtTick?.symbol,
          syllable: lyr.text,
          isHyphenated: lyr.isHyphenated,
          tickOffset: lyr.tickOffset,
        });
      }

      for (const ch of chordsData) {
        if (!tokens.some((t) => t.tickOffset === ch.startTick)) {
          tokens.push({
            chord: ch.symbol,
            isHyphenated: false,
            tickOffset: ch.startTick,
          });
        }
      }

      tokens.sort((a, b) => a.tickOffset - b.tickOffset);

      return {
        measureNumber: measure.measureNumber,
        timeSignature: timeSigStr,
        chords: chordsData,
        tokens,
      };
    });

    // Mapear secciones
    const sectionsData: LeadSheetSectionData[] = [];
    if (view.sections.length > 0) {
      for (const sec of view.sections) {
        const secMeasures = measuresData.filter(
          (m) => m.measureNumber >= sec.startMeasure && m.measureNumber <= sec.endMeasure
        );
        sectionsData.push({
          id: sec.id,
          label: sec.label,
          type: sec.type,
          startMeasure: sec.startMeasure,
          endMeasure: sec.endMeasure,
          measures: secMeasures,
        });
      }
    } else {
      sectionsData.push({
        id: 'default-section',
        label: 'Canción Completa',
        type: 'CUSTOM',
        startMeasure: 1,
        endMeasure: measuresData.length,
        measures: measuresData,
      });
    }

    const data: LeadSheetData = {
      title: view.songTitle,
      concertKey: view.concertKey.toString(),
      displayKey: view.viewPreference.capoFret > 0
        ? view.measures[0]?.chords[0]?.fingeringChord.root.toString() ?? view.concertKey.toString()
        : view.concertKey.toString(),
      capo: view.capoFret,
      totalMelodyNotes,
      sections: sectionsData,
    };

    // Renderizado en DOM real si se provee un contenedor de navegador válido
    const container = this.getContainerElement();
    if (container && typeof document !== 'undefined') {
      this.renderToBrowserDom(container, data);
    }

    return data;
  }

  /**
   * Construye el árbol DOM real de forma segura y libre de XSS (sin innerHTML).
   */
  private renderToBrowserDom(container: HTMLElement, data: LeadSheetData): void {
    container.replaceChildren();

    const wrapper = document.createElement('div');
    wrapper.className = 'bethesda-leadsheet-wrapper';

    // 1. Cabecera con metadatos
    const header = document.createElement('header');
    header.className = 'bethesda-leadsheet-header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'bethesda-leadsheet-title';
    titleEl.textContent = data.title;
    header.appendChild(titleEl);

    const metaRow = document.createElement('div');
    metaRow.className = 'bethesda-leadsheet-meta';

    const keyBadge = document.createElement('span');
    keyBadge.className = 'bethesda-badge badge-key';
    keyBadge.textContent = `Tono: ${data.concertKey}`;
    metaRow.appendChild(keyBadge);

    if (data.capo > 0) {
      const capoBadge = document.createElement('span');
      capoBadge.className = 'bethesda-badge badge-capo';
      capoBadge.textContent = `Capo ${data.capo} (Digita: ${data.displayKey})`;
      metaRow.appendChild(capoBadge);
    }

    if (data.totalMelodyNotes === 0) {
      const melodyBadge = document.createElement('span');
      melodyBadge.className = 'bethesda-badge badge-melody';
      melodyBadge.textContent = 'Lead Sheet Puro (Sin notas melódicas)';
      metaRow.appendChild(melodyBadge);
    }

    header.appendChild(metaRow);
    wrapper.appendChild(header);

    // 2. Secciones y compases
    const content = document.createElement('div');
    content.className = 'bethesda-leadsheet-content';

    for (const sec of data.sections) {
      const secEl = document.createElement('section');
      secEl.className = 'bethesda-leadsheet-section';

      const secTitle = document.createElement('h3');
      secTitle.className = 'bethesda-section-title';
      secTitle.textContent = sec.label;
      secEl.appendChild(secTitle);

      const grid = document.createElement('div');
      grid.className = 'bethesda-measures-grid';

      for (const m of sec.measures) {
        const card = document.createElement('div');
        card.className = 'bethesda-measure-card';
        card.setAttribute('data-measure', String(m.measureNumber));

        const cardHeader = document.createElement('div');
        cardHeader.className = 'bethesda-measure-header';

        const numSpan = document.createElement('span');
        numSpan.className = 'bethesda-measure-num';
        numSpan.textContent = `c. ${m.measureNumber}`;
        cardHeader.appendChild(numSpan);

        const meterSpan = document.createElement('span');
        meterSpan.className = 'bethesda-measure-meter';
        meterSpan.textContent = m.timeSignature;
        cardHeader.appendChild(meterSpan);

        card.appendChild(cardHeader);

        const tokensRow = document.createElement('div');
        tokensRow.className = 'bethesda-tokens-row';

        for (const token of m.tokens) {
          const tokenCol = document.createElement('div');
          tokenCol.className = 'bethesda-token-col';

          if (token.chord) {
            const chordSpan = document.createElement('span');
            chordSpan.className = 'bethesda-chord-symbol';
            chordSpan.textContent = token.chord;
            tokenCol.appendChild(chordSpan);
          }

          if (token.syllable) {
            const lyricSpan = document.createElement('span');
            lyricSpan.className = 'bethesda-lyric-syllable';
            lyricSpan.textContent = token.isHyphenated ? `${token.syllable}-` : token.syllable;
            tokenCol.appendChild(lyricSpan);
          }

          tokensRow.appendChild(tokenCol);
        }

        card.appendChild(tokensRow);
        grid.appendChild(card);
      }

      secEl.appendChild(grid);
      content.appendChild(secEl);
    }

    wrapper.appendChild(content);
    container.appendChild(wrapper);

    // Configurar ResizeObserver si está disponible y no se ha configurado
    if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // Adaptación responsiva de ancho
      });
      this.resizeObserver.observe(container);
    }
  }

  private getContainerElement(): HTMLElement | null {
    if (!this._target?.container) return null;
    if (typeof HTMLElement !== 'undefined' && this._target.container instanceof HTMLElement) {
      return this._target.container;
    }
    return null;
  }
}
