/**
 * @file format-capabilities.ts
 * @description Evaluador de capacidades de formato y compatibilidad de conversión (Fase 2A / UX Correction / R2.1).
 *
 * Determina qué formatos de destino son viables, cuáles están diferidos (Fase 2B),
 * cuáles no están soportados y cuáles están estrictamente bloqueados por el Principio de CERO Fabricación.
 * Implementa una política de validación FAIL-CLOSED: formatos desconocidos o no verificados son rechazados.
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import {
  type ConversionSourceCategory,
  type ConversionTargetFormat,
  type FormatCapabilityInfo,
  type SourceCapabilitySummary,
} from './types.ts';
import { hasAudioExtension, inspectAudioSignature } from './audio-signature.ts';

export class FormatCapabilitiesEvaluator {
  /**
   * Detecta la categoría de fuente a partir de inspección de Magic Bytes, estructura de contenido
   * y extensión de archivo, garantizando detección fidedigna y prevención de extensiones falsificadas (CR-07 / R2.1).
   * Principio Fail-Closed: Entradas no reconocidas jamás caen por defecto en WRITTEN_NOTES.
   */
  public static detectSourceCategory(
    filename: string,
    content?: string | Uint8Array
  ): ConversionSourceCategory {
    const lowerName = filename ? filename.toLowerCase().trim() : '';

    const hasBinaryContent = content instanceof Uint8Array && content.length > 0;
    const isBufferBinary =
      hasBinaryContent &&
      content.some((b) => b === 0x00 || (b < 0x09 && b !== 0x0a && b !== 0x0d));

    // 1. Verificación primaria por Magic Bytes (si se suministra buffer binario)
    if (content instanceof Uint8Array && content.length >= 4) {
      // 1.1 MIDI Header 'MThd' (0x4D 0x54 0x68 0x64)
      if (
        content[0] === 0x4d &&
        content[1] === 0x54 &&
        content[2] === 0x68 &&
        content[3] === 0x64
      ) {
        return 'STRUCTURED_MIDI';
      }

      // 1.2 PDF Header '%PDF' (0x25 0x50 0x44 0x46)
      if (
        content[0] === 0x25 &&
        content[1] === 0x50 &&
        content[2] === 0x44 &&
        content[3] === 0x46
      ) {
        return 'PDF_SCORE';
      }

      // 1.3 PNG Header (0x89 0x50 0x4E 0x47)
      if (
        content[0] === 0x89 &&
        content[1] === 0x50 &&
        content[2] === 0x4e &&
        content[3] === 0x47
      ) {
        return 'IMAGE_SCORE';
      }

      // 1.4 JPEG Header (0xFF 0xD8 0xFF)
      if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
        return 'IMAGE_SCORE';
      }

      // 1.5 TIFF Header ('II*\0' o 'MM\0*')
      if (
        (content[0] === 0x49 && content[1] === 0x49 && content[2] === 0x2a && content[3] === 0x00) ||
        (content[0] === 0x4d && content[1] === 0x4d && content[2] === 0x00 && content[3] === 0x2a)
      ) {
        return 'IMAGE_SCORE';
      }

      // 1.6 RIFF Container: WebP (el audio WAV se valida en 1.7 mediante inspección estructural)
      if (
        content.length >= 12 &&
        content[0] === 0x52 &&
        content[1] === 0x49 &&
        content[2] === 0x46 &&
        content[3] === 0x46
      ) {
        const subType = String.fromCharCode(content[8]!, content[9]!, content[10]!, content[11]!);
        if (subType === 'WEBP') return 'IMAGE_SCORE';
      }

      // 1.7 Audio (WS-AUDIO-01): inspección estructural de firmas binarias (MP3 con/sin ID3, WAV, FLAC, OGG, M4A/AAC).
      // Una cabecera "ID3" aislada o una extensión .mp3 NO bastan para clasificar como audio.
      if (inspectAudioSignature(content).valid) {
        return 'AUDIO_RECORDING';
      }

      // Si es un buffer binario (con bytes nulos o de control) que no coincidió con ninguna firma reconocida:
      if (isBufferBinary) {
        return 'UNKNOWN_UNSUPPORTED';
      }
    }


    // 2. Verificación por estructura de texto
    const textContent =
      typeof content === 'string'
        ? content
        : content instanceof Uint8Array && !isBufferBinary
        ? new TextDecoder('utf-8', { fatal: false }).decode(content.slice(0, 8192))
        : null;

    if (textContent !== null) {
      const trimmed = textContent.trim();

      // 2.1 Archivos XML / MusicXML
      if (trimmed.startsWith('<')) {
        if (
          trimmed.includes('<score-partwise') ||
          trimmed.includes('<score-timewise') ||
          (trimmed.includes('<?xml') && (trimmed.includes('score') || trimmed.includes('part-list')))
        ) {
          return 'STRUCTURED_MUSICXML';
        }
        // Archivo XML arbitrario o no musical (ej. HTML o catálogo XML no MusicXML)
        return 'UNKNOWN_UNSUPPORTED';
      }

      // 2.2 ChordPro (directivas {title:...} o acordes [A-G])
      if (
        lowerName.endsWith('.cho') ||
        lowerName.endsWith('.crd') ||
        /\{(title|key|tempo|start_of_chorus|soc|sov|start_of_verse|artist):/i.test(trimmed) ||
        /\[[A-G][b#]?[^\]]*\]/.test(trimmed)
      ) {
        return 'STRUCTURED_CHORDPRO';
      }

      // 2.3 JSON canónico de notas escritas
      if (lowerName.endsWith('.json') || (trimmed.startsWith('{') && trimmed.includes('"'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (
            parsed &&
            typeof parsed === 'object' &&
            ((parsed.version && parsed.timeline) ||
              (parsed.title && Array.isArray(parsed.measures)) ||
              Array.isArray(parsed.tracks))
          ) {
            return 'WRITTEN_NOTES';
          }
          // JSON arbitrario sin estructura musical canónica
          return 'UNKNOWN_UNSUPPORTED';
        } catch {
          // JSON malformado
          return 'UNKNOWN_UNSUPPORTED';
        }
      }

      // 2.4 Tablatura ASCII
      if (lowerName.endsWith('.tab') || /\|[-0-9pbrh\/]{4,}\|/.test(trimmed)) {
        return 'TABLATURE_ASCII';
      }

      // 2.5 Letra TXT
      if (lowerName.endsWith('.txt')) {
        if (trimmed.length > 0) {
          return 'TXT_LYRICS';
        }
        return 'UNKNOWN_UNSUPPORTED';
      }
    }

    // 3. Verificación por extensión de archivo soportada
    if (lowerName.endsWith('.mid') || lowerName.endsWith('.midi')) {
      return 'STRUCTURED_MIDI';
    }
    if (
      lowerName.endsWith('.musicxml') ||
      lowerName.endsWith('.mxl') ||
      lowerName.endsWith('.xml')
    ) {
      return 'STRUCTURED_MUSICXML';
    }
    if (
      lowerName.endsWith('.cho') ||
      lowerName.endsWith('.crd') ||
      lowerName.endsWith('.pro') ||
      lowerName.endsWith('.chopro') ||
      lowerName.endsWith('.chordpro')
    ) {
      return 'STRUCTURED_CHORDPRO';
    }
    if (lowerName.endsWith('.pdf')) {
      return 'PDF_SCORE';
    }
    if (
      lowerName.endsWith('.png') ||
      lowerName.endsWith('.jpg') ||
      lowerName.endsWith('.jpeg') ||
      lowerName.endsWith('.webp') ||
      lowerName.endsWith('.tiff')
    ) {
      return 'IMAGE_SCORE';
    }
    if (
      lowerName.endsWith('.mp3') ||
      lowerName.endsWith('.wav') ||
      lowerName.endsWith('.m4a') ||
      lowerName.endsWith('.ogg') ||
      lowerName.endsWith('.flac') ||
      lowerName.endsWith('.aac')
    ) {
      return 'AUDIO_RECORDING';
    }
    if (
      lowerName.endsWith('.mp4') ||
      lowerName.endsWith('.mov') ||
      lowerName.endsWith('.webm') ||
      lowerName.endsWith('.mkv')
    ) {
      return 'VIDEO_REFERENCE';
    }
    if (lowerName.endsWith('.tab')) {
      return 'TABLATURE_ASCII';
    }
    if (lowerName.endsWith('.txt')) {
      return 'TXT_LYRICS';
    }

    // 4. Default: FAIL-CLOSED (Jamás asumir WRITTEN_NOTES para formatos desconocidos o no soportados)
    return 'UNKNOWN_UNSUPPORTED';
  }

  /**
   * Resumen de alto nivel del estado de soporte y capacidades de la fuente musical.
   */
  public static getSourceCapabilitySummary(
    sourceCategory: ConversionSourceCategory,
    _filename?: string
  ): SourceCapabilitySummary {
    switch (sourceCategory) {
      case 'STRUCTURED_MUSICXML':
        return {
          category: 'STRUCTURED_MUSICXML',
          label: 'Partitura MusicXML 4.0',
          state: 'SUPPORTED',
          description: 'Partitura digital completa con notas, compases, armonía y texto vocal.',
          canConvert: true,
        };
      case 'STRUCTURED_MIDI':
        return {
          category: 'STRUCTURED_MIDI',
          label: 'Secuencia MIDI Estándar (SMF 1)',
          state: 'SUPPORTED',
          description: 'Eventos de notas polifónicas, tempos, divisiones de tiempo y métrica.',
          canConvert: true,
        };
      case 'STRUCTURED_CHORDPRO':
        return {
          category: 'STRUCTURED_CHORDPRO',
          label: 'Cifrado Armónico ChordPro',
          state: 'SUPPORTED',
          description: 'Cifrado de acordes y texto lírico estructurado.',
          canConvert: true,
          advisoryNotice:
            'Conversión a formatos de texto y lead sheet disponible. La exportación a MIDI melódico está bloqueada por Cero Fabricación (la fuente no contiene notas melódicas).',
        };
      case 'TXT_LYRICS':
        return {
          category: 'TXT_LYRICS',
          label: 'Solo Letra / Texto Plano',
          state: 'PARTIALLY_SUPPORTED',
          description: 'Texto lírico vocal sin armonía ni notas melódicas.',
          canConvert: true,
          advisoryNotice:
            'Archivo de solo letra reconocido. Conversión a texto y borrador ChordPro disponible. Conversión a MIDI bloqueada por Cero Fabricación.',
        };
      case 'PDF_SCORE':
        return {
          category: 'PDF_SCORE',
          label: 'Partitura en Documento PDF',
          state: 'PARTIALLY_SUPPORTED',
          description: 'Documento visual preservado de forma íntegra en el almacenamiento duradero.',
          canConvert: false,
          advisoryNotice:
            'Documento PDF reconocido y preservado de forma íntegra. Puede visualizarlo en el atril digital. La digitalización óptica de partituras (OMR) para convertir a notas editables está planificada para la Fase 2B.',
        };
      case 'IMAGE_SCORE':
        return {
          category: 'IMAGE_SCORE',
          label: 'Partitura en Imagen (PNG, JPG, WEBP, TIFF)',
          state: 'PARTIALLY_SUPPORTED',
          description: 'Imagen gráfica de partitura preservada de forma inmutable.',
          canConvert: false,
          advisoryNotice:
            'Partitura en imagen reconocida y preservada. Puede visualizarla en el atril digital. El reconocimiento óptico de partituras (OMR) está planificado para la Fase 2B.',
        };
      case 'AUDIO_RECORDING':
        return {
          category: 'AUDIO_RECORDING',
          label: 'Grabación de Audio (MP3, WAV, M4A, FLAC, OGG)',
          state: 'PARTIALLY_SUPPORTED',
          description: 'Archivo sonoro validado por su firma binaria y preservable con verificación criptográfica SHA-256.',
          canConvert: false,
          canPreserve: true,
          advisoryNotice:
            'Audio reconocido por su firma binaria. Puede preservar el original de forma duradera en el servidor (verificado con SHA-256) y reproducirlo en el atril digital. La conversión automática de audio a partituras está planificada para la Fase 2B (WS-AUDIO): acordes/ChordPro (WS-AUDIO-02) y MIDI/MusicXML/Tablatura (WS-AUDIO-03) están autorizados en principio y se habilitarán solo tras aprobar su puerta de aceptación; todo resultado será un borrador con revisión humana obligatoria.',
        };
      case 'VIDEO_REFERENCE':
        return {
          category: 'VIDEO_REFERENCE',
          label: 'Video de Referencia',
          state: 'PARTIALLY_SUPPORTED',
          description: 'Archivo multimedia o referencia audiovisual.',
          canConvert: false,
          advisoryNotice:
            'Video reconocido. La extracción de audio y transcripción está diferida para fases posteriores.',
        };
      case 'TABLATURE_ASCII':
        return {
          category: 'TABLATURE_ASCII',
          label: 'Tablatura en Texto ASCII (.tab)',
          state: 'SUPPORTED',
          description: 'Tablatura textual estándar para guitarra y bajo.',
          canConvert: true,
          advisoryNotice:
            'Tablatura ASCII reconocida. Conversión a tablatura canónica, cifrado y texto disponible. Exportación a MIDI bloqueada si no posee timing explícito (Cero Fabricación).',
        };
      case 'WRITTEN_NOTES':
        return {
          category: 'WRITTEN_NOTES',
          label: 'Notas Escritas / JSON Canónico',
          state: 'SUPPORTED',
          description: 'Estructura canónica de eventos musicales y notas.',
          canConvert: true,
        };
      case 'UNKNOWN_UNSUPPORTED':
      default:
        return {
          category: 'UNKNOWN_UNSUPPORTED',
          label: 'Formato No Reconocido / No Soportado',
          state: 'NOT_SUPPORTED',
          description: 'El archivo suministrado no corresponde a un formato musical admitido.',
          canConvert: false,
          advisoryNotice:
            'Formato no reconocido o no soportado. Por favor suministre una partitura MusicXML (.musicxml), secuencia MIDI (.mid), cifrado ChordPro (.cho), archivo de texto de letra (.txt) o un documento visual (PDF/Imagen).',
        };
    }
  }

  /**
   * Obtiene la matriz completa de capacidades para una categoría de origen dada,
   * ajustada de forma dinámica según el contenido del payload canónico si se provee.
   */
  public static getFormatCapabilities(
    sourceCategory: ConversionSourceCategory,
    payload?: CanonicalMusicPayload
  ): FormatCapabilityInfo[] {
    const isAudioOrVideo =
      sourceCategory === 'AUDIO_RECORDING' || sourceCategory === 'VIDEO_REFERENCE';
    const isPdfOrImage =
      sourceCategory === 'PDF_SCORE' || sourceCategory === 'IMAGE_SCORE';
    const isTablature = sourceCategory === 'TABLATURE_ASCII';
    const isUnknown = sourceCategory === 'UNKNOWN_UNSUPPORTED';

    // Formato base: MusicXML
    const musicXmlCap: FormatCapabilityInfo = {
      format: 'MUSIC_XML',
      label: 'MusicXML 4.0',
      extension: '.musicxml',
      mimeType: 'application/vnd.recordare.musicxml+xml',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Partitura estándar MusicXML 4.0 con pentagramas, notas, compases y acordes.',
    };

    // Formato base: MIDI
    const midiCap: FormatCapabilityInfo = {
      format: 'MIDI',
      label: 'MIDI Estándar (SMF 1)',
      extension: '.mid',
      mimeType: 'audio/midi',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Archivo MIDI estándar a 480 ticks/negra para secuenciadores y DAWs.',
    };

    // Formato base: ChordPro
    const chordProCap: FormatCapabilityInfo = {
      format: 'CHORD_PRO',
      label: 'ChordPro / Cifrado',
      extension: '.cho',
      mimeType: 'text/plain',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Cifrado armónico con letra integrada [Acorde] y directivas de estructura.',
    };

    // Formato base: Lyrics Only
    const lyricsCap: FormatCapabilityInfo = {
      format: 'LYRICS_ONLY',
      label: 'Solo Letra (TXT)',
      extension: '.txt',
      mimeType: 'text/plain',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Texto limpio de la letra organizado por secciones sin marcado técnico.',
    };

    // Formato base: Engraved PDF (Diferido Fase 2B)
    const pdfCap: FormatCapabilityInfo = {
      format: 'ENGRAVED_PDF',
      label: 'Partitura Grabada (PDF)',
      extension: '.pdf',
      mimeType: 'application/pdf',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Partitura visual grabada en PDF con tipografía profesional (Bravura).',
      blockingReason:
        'El grabado visual a PDF mediante headless Chromium o VexFlow server-side está planificado para Fase 2B. En Fase 2A utilice exportación MusicXML para abrir e imprimir en software de notación.',
    };

    // Formato base: Tablatura (Diferido Fase 2B)
    const tabCap: FormatCapabilityInfo = {
      format: 'TABLATURE',
      label: 'Tablatura (Guitarra/Bajo)',
      extension: '.tab',
      mimeType: 'text/plain',
      isAvailable: false,
      capabilityState: 'PLANNED_PHASE_2B',
      statusBadge: 'DEFERRED_PHASE',
      description: 'Generación de digitaciones automáticas en tablatura de 6 o 4 cuerdas.',
      blockingReason:
        'El cálculo polifónico de digitaciones óptimas de tablatura está planificado para Fase 2B.',
    };

    // 0. Formatos Desconocidos / No Soportados (FAIL-CLOSED)
    if (isUnknown) {
      const unsupportedReason =
        'El archivo de origen no corresponde a un formato musical admitido. Bethesda Worship Studio admite MusicXML (.musicxml), MIDI (.mid), ChordPro (.cho), solo letra (.txt) y documentos visuales (PDF/Imágenes).';
      musicXmlCap.blockingReason = unsupportedReason;
      musicXmlCap.capabilityState = 'NOT_SUPPORTED';
      midiCap.blockingReason = unsupportedReason;
      midiCap.capabilityState = 'NOT_SUPPORTED';
      chordProCap.blockingReason = unsupportedReason;
      chordProCap.capabilityState = 'NOT_SUPPORTED';
      lyricsCap.blockingReason = unsupportedReason;
      lyricsCap.capabilityState = 'NOT_SUPPORTED';
      pdfCap.blockingReason = unsupportedReason;
      pdfCap.capabilityState = 'NOT_SUPPORTED';
      tabCap.blockingReason = unsupportedReason;
      tabCap.capabilityState = 'NOT_SUPPORTED';
      return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
    }

    // 1. Fuentes de Audio o Video: la conversión audio→notación NO está implementada (WS-AUDIO-02/03 pendientes de compuerta).
    if (isAudioOrVideo) {
      const isAudio = sourceCategory === 'AUDIO_RECORDING';
      const audioReason = isAudio
        ? 'La transcripción automática de audio a partituras está planificada para la Fase 2B (WS-AUDIO): acordes/ChordPro (WS-AUDIO-02) y MIDI/MusicXML/Tablatura (WS-AUDIO-03) están autorizados en principio y se habilitarán solo tras aprobar su puerta de aceptación. Todo resultado será un borrador con revisión humana obligatoria. Use «Preservar audio» para guardar y reproducir el original en el atril.'
        : 'La extracción de audio y transcripción desde video está diferida para la Fase 2B.';
      const plannedState = 'PLANNED_PHASE_2B';
      musicXmlCap.blockingReason = audioReason;
      musicXmlCap.capabilityState = plannedState;
      midiCap.blockingReason = audioReason;
      midiCap.capabilityState = plannedState;
      chordProCap.blockingReason = audioReason;
      chordProCap.capabilityState = plannedState;
      lyricsCap.blockingReason = audioReason;
      lyricsCap.capabilityState = plannedState;
      if (isAudio) {
        tabCap.blockingReason = audioReason;
        tabCap.capabilityState = plannedState;
      }
      return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
    }

    // 2. Fuentes de Partitura en PDF o Imagen (OMR Planificado Fase 2B)
    if (isPdfOrImage) {
      const omrReason =
        'El reconocimiento óptico de partituras (OMR con Audiveris / oemer) está planificado para Fase 2B para garantizar precisión profesional sin alucinación de notas.';
      musicXmlCap.blockingReason = omrReason;
      musicXmlCap.capabilityState = 'PLANNED_PHASE_2B';
      midiCap.blockingReason = omrReason;
      midiCap.capabilityState = 'PLANNED_PHASE_2B';
      chordProCap.blockingReason = omrReason;
      chordProCap.capabilityState = 'PLANNED_PHASE_2B';
      lyricsCap.blockingReason = omrReason;
      lyricsCap.capabilityState = 'PLANNED_PHASE_2B';
      pdfCap.blockingReason = omrReason;
      tabCap.blockingReason = omrReason;
      return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
    }

    // 3. Fuentes Estructuradas (MusicXML, MIDI, ChordPro, TXT Lyrics, Notas escritas, Tablatura)
    if (sourceCategory === 'STRUCTURED_MUSICXML') {
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'NATIVE';
      musicXmlCap.capabilityState = 'SUPPORTED';

      midiCap.isAvailable = true;
      midiCap.statusBadge = 'CONVERTED';
      midiCap.capabilityState = 'SUPPORTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';
      chordProCap.capabilityState = 'SUPPORTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
      lyricsCap.capabilityState = 'SUPPORTED';

      tabCap.isAvailable = true;
      tabCap.statusBadge = 'CONVERTED';
      tabCap.capabilityState = 'SUPPORTED';
    } else if (sourceCategory === 'STRUCTURED_MIDI') {
      midiCap.isAvailable = true;
      midiCap.statusBadge = 'NATIVE';
      midiCap.capabilityState = 'SUPPORTED';

      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';
      musicXmlCap.capabilityState = 'SUPPORTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';
      chordProCap.capabilityState = 'SUPPORTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
      lyricsCap.capabilityState = 'SUPPORTED';

      tabCap.isAvailable = true;
      tabCap.statusBadge = 'CONVERTED';
      tabCap.capabilityState = 'SUPPORTED';
    } else if (sourceCategory === 'STRUCTURED_CHORDPRO') {
      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'NATIVE';
      chordProCap.capabilityState = 'SUPPORTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
      lyricsCap.capabilityState = 'SUPPORTED';

      // MusicXML es viable como lead sheet (compases, acordes y letra, sin notas inventadas)
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';
      musicXmlCap.capabilityState = 'SUPPORTED';

      // MIDI está BLOQUEADO por CERO-FABRICACIÓN si la fuente es sólo cifrado
      midiCap.isAvailable = false;
      midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
      midiCap.capabilityState = 'NOT_SUPPORTED';
      midiCap.blockingReason =
        'No es posible generar MIDI melódico desde un cifrado ChordPro sin notas, pues violaría el principio de CERO invención de melodía.';

      tabCap.isAvailable = false;
      tabCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
      tabCap.capabilityState = 'NOT_SUPPORTED';
      tabCap.blockingReason =
        'Un archivo ChordPro sin notas melódicas no puede convertirse a tablatura melódica sin violar Cero Fabricación.';
    } else if (sourceCategory === 'TXT_LYRICS') {
      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'NATIVE';
      lyricsCap.capabilityState = 'SUPPORTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';
      chordProCap.capabilityState = 'SUPPORTED';

      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';
      musicXmlCap.capabilityState = 'PARTIALLY_SUPPORTED';

      midiCap.isAvailable = false;
      midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
      midiCap.capabilityState = 'NOT_SUPPORTED';
      midiCap.blockingReason =
        'Un archivo de solo letra no contiene notas melódicas ni acordes. No se generará un archivo MIDI con melodías inventadas.';

      tabCap.isAvailable = false;
      tabCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
      tabCap.capabilityState = 'NOT_SUPPORTED';
      tabCap.blockingReason =
        'Un archivo de solo letra no contiene notas ni digitaciones para tablatura.';
    } else if (sourceCategory === 'WRITTEN_NOTES') {
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';
      musicXmlCap.capabilityState = 'SUPPORTED';

      midiCap.isAvailable = true;
      midiCap.statusBadge = 'CONVERTED';
      midiCap.capabilityState = 'SUPPORTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';
      chordProCap.capabilityState = 'SUPPORTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
      lyricsCap.capabilityState = 'SUPPORTED';

      tabCap.isAvailable = true;
      tabCap.statusBadge = 'CONVERTED';
      tabCap.capabilityState = 'SUPPORTED';
    } else if (sourceCategory === 'TABLATURE_ASCII') {
      tabCap.isAvailable = true;
      tabCap.statusBadge = 'NATIVE';
      tabCap.capabilityState = 'SUPPORTED';
      tabCap.blockingReason = undefined;

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';
      chordProCap.capabilityState = 'SUPPORTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
      lyricsCap.capabilityState = 'SUPPORTED';

      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';
      musicXmlCap.capabilityState = 'SUPPORTED';

      const allNotes = payload?.getAllNotes() ?? [];
      const hasTiming =
        allNotes.length > 0 &&
        allNotes.every((n) => n.startTick !== null && n.durationTicks !== null) &&
        (payload?.metadata as Record<string, unknown> | undefined)?.rhythmicProvenance !== 'NONE' &&
        (payload?.metadata as Record<string, unknown> | undefined)?.rhythmicProvenance !== 'PARTIALLY_MEASURED';

      if (hasTiming) {
        midiCap.isAvailable = true;
        midiCap.statusBadge = 'CONVERTED';
        midiCap.capabilityState = 'SUPPORTED';
      } else {
        midiCap.isAvailable = false;
        midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        midiCap.capabilityState = 'NOT_SUPPORTED';
        midiCap.blockingReason =
          'No es posible exportar a MIDI desde una tablatura sin ritmo explícito (CERO fabricación de duraciones).';
      }
    }

    // 5. Ajustes Dinámicos según Contenido Real del Payload Canónico (si está disponible)
    if (payload) {
      const notes = payload.getAllNotes();
      const chords = payload.getAllChords();
      const lyrics = payload.getAllLyrics();

      // Si no hay notas melódicas, el formato MIDI se bloquea por cero fabricación
      if (notes.length === 0) {
        midiCap.isAvailable = false;
        midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        midiCap.capabilityState = 'NOT_SUPPORTED';
        midiCap.blockingReason =
          'El documento canónico no contiene notas melódicas. No se generará un archivo MIDI con notas inventadas.';
      }

      // Si no hay letra, el formato de solo letra se bloquea
      if (lyrics.length === 0) {
        lyricsCap.isAvailable = false;
        lyricsCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        lyricsCap.capabilityState = 'NOT_SUPPORTED';
        lyricsCap.blockingReason =
          'El documento canónico no contiene texto lírico vocal (obra instrumental).';
      }

      // Si no hay acordes ni letra, ChordPro avisa
      if (chords.length === 0 && lyrics.length === 0) {
        chordProCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        chordProCap.capabilityState = 'NOT_SUPPORTED';
        chordProCap.isAvailable = false;
        chordProCap.blockingReason =
          'La obra es puramente melódica instrumental sin cifrado ni letra.';
      }
    }

    return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
  }

  /**
   * Obtiene los formatos de destino permitidos y disponibles para una categoría dada.
   */
  public static getAvailableTargets(
    sourceCategory: ConversionSourceCategory,
    payload?: CanonicalMusicPayload
  ): ConversionTargetFormat[] {
    return this.getFormatCapabilities(sourceCategory, payload)
      .filter((cap) => cap.isAvailable)
      .map((cap) => cap.format);
  }
}
