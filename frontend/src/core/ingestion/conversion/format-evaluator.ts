/**
 * @file format-evaluator.ts
 * @description Evaluador de capacidades y viabilidad de los 4 formatos de atril seleccionables
 * por el músico (Partitura, Cifrado con Letra, Letra Sola, Tablatura) para Bethesda Worship Studio.
 *
 * Enforce:
 * 1. CERO invención de notas melódicas o compases: Si el origen es un cancionero de texto/cifrado (ej. CMB AZUL o CMB MUSIC),
 *    la Partitura tradicional se declara BLOQUEADA con explicación transparente al usuario.
 * 2. CERO falsas transcripciones en Tablatura: Se distingue claramente entre tablatura melódica nota por nota (requiere alturas/ritmos),
 *    tablatura de riffs ASCII existentes en el origen, y diagramas de posición de acordes (chord voicings).
 * 3. Cifrado con Letra y Letra Sola se habilitan plenamente cuando el documento contiene texto y cifrado.
 */

export type MusicStandFormat =
  | 'SHEET_MUSIC'
  | 'CHORDS_WITH_LYRICS'
  | 'LYRICS_ONLY'
  | 'TABLATURE';

export type FormatAvailabilityStatus =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_NOTICE'
  | 'BLOCKED_INSUFFICIENT_DATA';

export interface FormatEvaluation {
  readonly format: MusicStandFormat;
  readonly title: string;
  readonly subtitle: string;
  readonly status: FormatAvailabilityStatus;
  readonly isSelectable: boolean;
  readonly badgeText: string;
  readonly explanation: string;
  readonly requirements: string[];
  readonly missingDataNotice?: string | undefined;
  readonly recommendedInstrument?: string | undefined;
}

export interface DocumentSourceAnalysis {
  readonly sourceFormat: 'MUSIC_XML' | 'CHORD_PRO' | 'PDF' | 'IMAGE' | 'TEXT';
  readonly hasStavesAndNotes: boolean; // Pentagramas, notas con plicas y figuras de compás
  readonly hasChords: boolean;        // Símbolos de acordes armónicos
  readonly hasLyrics: boolean;        // Texto de letra poética/congregacional
  readonly hasAsciiTablature: boolean;// Tablaturas ASCII explícitas (ej. riffs/solos)
  readonly isOmrApproved?: boolean;   // Si proviene de OMR aprobado por humano
}

export class FormatEvaluator {
  /**
   * Evalúa las 4 opciones de formato frente al análisis del documento de origen.
   */
  public static evaluateAll(analysis: DocumentSourceAnalysis): Record<MusicStandFormat, FormatEvaluation> {
    return {
      SHEET_MUSIC: this.evaluateSheetMusic(analysis),
      CHORDS_WITH_LYRICS: this.evaluateChordsWithLyrics(analysis),
      LYRICS_ONLY: this.evaluateLyricsOnly(analysis),
      TABLATURE: this.evaluateTablature(analysis),
    };
  }

  /**
   * Evaluación de 1. PARTITURA / SHEET MUSIC
   */
  private static evaluateSheetMusic(analysis: DocumentSourceAnalysis): FormatEvaluation {
    if (analysis.sourceFormat === 'MUSIC_XML' || (analysis.hasStavesAndNotes && analysis.isOmrApproved)) {
      return {
        format: 'SHEET_MUSIC',
        title: 'Partitura Tradicional',
        subtitle: 'Pentagramas, notas melódicas, silencios y métrica',
        status: 'AVAILABLE',
        isSelectable: true,
        badgeText: 'Disponible',
        explanation: 'El archivo de origen contiene notación musical estructurada con alturas melódicas, compases y duraciones rítmicas verificadas.',
        requirements: ['Pentagramas y claves', 'Figuras rítmicas y duraciones', 'Compases y armaduras'],
      };
    }

    return {
      format: 'SHEET_MUSIC',
      title: 'Partitura Tradicional',
      subtitle: 'Pentagramas, notas melódicas, silencios y métrica',
      status: 'BLOCKED_INSUFFICIENT_DATA',
      isSelectable: false,
      badgeText: 'No Disponible en Origen',
      explanation: 'El documento de origen es un cancionero de texto con cifrado armónico (Chord Sheet). No contiene pentagramas, alturas de notas melódicas ni duraciones rítmicas.',
      requirements: ['Pentagramas y claves', 'Figuras rítmicas y duraciones', 'Compases y armaduras'],
      missingDataNotice: 'Para generar una partitura tradicional de forma fidedigna y sin inventar notas ficticias, importe un archivo MusicXML formal o una partitura escaneada con pentagramas legibles aprobada mediante OMR.',
    };
  }

  /**
   * Evaluación de 2. CIFRADO CON LETRA / CHORDS WITH LYRICS
   */
  private static evaluateChordsWithLyrics(analysis: DocumentSourceAnalysis): FormatEvaluation {
    if (analysis.hasChords && analysis.hasLyrics) {
      return {
        format: 'CHORDS_WITH_LYRICS',
        title: 'Cifrado con Letra',
        subtitle: 'Letra poética con acordes armónicos colocados encima',
        status: 'AVAILABLE',
        isSelectable: true,
        badgeText: 'Recomendado',
        explanation: 'Contenido armónico y lírico plenamente disponible. Admite transposición de tono, cejilla (capo) y selección de sistema de cifrado (americano o latino).',
        requirements: ['Letra de la canción', 'Acordes cifrados identificados'],
      };
    }

    if (analysis.hasChords && !analysis.hasLyrics) {
      return {
        format: 'CHORDS_WITH_LYRICS',
        title: 'Cifrado Armónico',
        subtitle: 'Progresión de acordes sin letra vocal',
        status: 'AVAILABLE_WITH_NOTICE',
        isSelectable: true,
        badgeText: 'Sin Letra',
        explanation: 'El documento contiene acordes pero no se detectaron líneas de letra lírica. Se proyectará como gráfico armónico de acordes.',
        requirements: ['Acordes cifrados'],
        missingDataNotice: 'No se detectó texto lírico en el documento de origen.',
      };
    }

    return {
      format: 'CHORDS_WITH_LYRICS',
      title: 'Cifrado con Letra',
      subtitle: 'Letra poética con acordes armónicos colocados encima',
      status: 'BLOCKED_INSUFFICIENT_DATA',
      isSelectable: false,
      badgeText: 'Sin Acordes',
      explanation: 'El documento no contiene símbolos de acordes armónicos identificables.',
      requirements: ['Acordes cifrados identificados'],
      missingDataNotice: 'El origen es un texto de solo letra sin notación armónica.',
    };
  }

  /**
   * Evaluación de 3. LETRA SOLA / LYRICS ONLY
   */
  private static evaluateLyricsOnly(analysis: DocumentSourceAnalysis): FormatEvaluation {
    if (analysis.hasLyrics) {
      return {
        format: 'LYRICS_ONLY',
        title: 'Solo Letra',
        subtitle: 'Tipografía grande para canto congregacional y vocalistas',
        status: 'AVAILABLE',
        isSelectable: true,
        badgeText: 'Disponible',
        explanation: 'Texto lírico y estructura de secciones (Estrofas, Coros, Puentes) plenamente disponibles. Presentación limpia sin acordes, con tipografía responsiva escalable para tablets y atril.',
        requirements: ['Texto lírico poético'],
      };
    }

    return {
      format: 'LYRICS_ONLY',
      title: 'Solo Letra',
      subtitle: 'Tipografía grande para canto congregacional y vocalistas',
      status: 'BLOCKED_INSUFFICIENT_DATA',
      isSelectable: false,
      badgeText: 'Sin Letra',
      explanation: 'El documento seleccionado carece de texto lírico o palabras cantadas (obra puramente instrumental).',
      requirements: ['Texto lírico poético'],
      missingDataNotice: 'No se encontraron versos ni estrofas líricas en el archivo.',
    };
  }

  /**
   * Evaluación de 4. TABLATURA / TABLATURE
   */
  private static evaluateTablature(analysis: DocumentSourceAnalysis): FormatEvaluation {
    if (analysis.hasStavesAndNotes) {
      return {
        format: 'TABLATURE',
        title: 'Tablatura Melódica Completa',
        subtitle: 'Digitaciones en cuerda y traste nota por nota',
        status: 'AVAILABLE',
        isSelectable: true,
        badgeText: 'Disponible',
        explanation: 'Las alturas y duraciones melódicas están disponibles para calcular posiciones óptimas de traste y cuerda en guitarra o bajo.',
        requirements: ['Alturas de notas (pitches)', 'Duraciones rítmicas', 'Afinación de instrumento'],
      };
    }

    if (analysis.hasAsciiTablature) {
      return {
        format: 'TABLATURE',
        title: 'Tablatura de Riff / Solo',
        subtitle: 'Tablatura ASCII extraída del documento original',
        status: 'AVAILABLE',
        isSelectable: true,
        badgeText: 'Riff Detectado',
        explanation: 'Se detectó una tablatura de solo o riff instrumental en el texto del documento (cuerdas y trastes). Disponible para visualización en el atril.',
        requirements: ['Tablatura textual en el origen'],
      };
    }

    if (analysis.hasChords) {
      return {
        format: 'TABLATURE',
        title: 'Diagramas de Acordes (Guitarra)',
        subtitle: 'Posiciones de cuerdas y trastes para los acordes de la canción',
        status: 'AVAILABLE_WITH_NOTICE',
        isSelectable: true,
        badgeText: 'Diagramas de Acordes',
        explanation: 'Disponible como guía de digitaciones y diagramas de acordes para guitarra (afinación estándar E-A-D-G-B-E). La transcripción melódica nota por nota no está disponible porque el cifrado no define una melodía instrumental exacta.',
        requirements: ['Símbolos de acordes'],
        missingDataNotice: 'Aviso de fidelidad: Representa las posiciones de acordes para acompañamiento de guitarra, no una transcripción de solo melódico.',
      };
    }

    return {
      format: 'TABLATURE',
      title: 'Tablatura',
      subtitle: 'Digitaciones en cuerda y traste',
      status: 'BLOCKED_INSUFFICIENT_DATA',
      isSelectable: false,
      badgeText: 'No Disponible',
      explanation: 'El documento carece de información de notas melódicas, acordes cifrados y tablaturas de riff.',
      requirements: ['Notas o acordes para cálculo de digitación'],
      missingDataNotice: 'No hay datos suficientes para calcular digitaciones instrumentales.',
    };
  }
}
