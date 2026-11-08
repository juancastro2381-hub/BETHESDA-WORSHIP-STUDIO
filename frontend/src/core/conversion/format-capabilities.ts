/**
 * @file format-capabilities.ts
 * @description Evaluador de capacidades de formato y compatibilidad de conversión (Fase 2A).
 *
 * Determina qué formatos de destino son viables, cuáles están diferidos (Fase 2B)
 * y cuáles están estrictamente bloqueados por el Principio de CERO Fabricación.
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import {
  type ConversionSourceCategory,
  type ConversionTargetFormat,
  type FormatCapabilityInfo,
} from './types.ts';

export class FormatCapabilitiesEvaluator {
  /**
   * Detecta la categoría de fuente a partir de inspección de Magic Bytes, estructura de contenido
   * y extensión de archivo, garantizando detección fidedigna y prevención de extensiones falsificadas (CR-07).
   */
  public static detectSourceCategory(
    filename: string,
    content?: string | Uint8Array
  ): ConversionSourceCategory {
    const lowerName = filename.toLowerCase().trim();

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

      // 1.6 RIFF Container: WAV ('WAVE') o WebP ('WEBP')
      if (
        content.length >= 12 &&
        content[0] === 0x52 &&
        content[1] === 0x49 &&
        content[2] === 0x46 &&
        content[3] === 0x46
      ) {
        const subType = String.fromCharCode(content[8]!, content[9]!, content[10]!, content[11]!);
        if (subType === 'WAVE') return 'AUDIO_RECORDING';
        if (subType === 'WEBP') return 'IMAGE_SCORE';
      }

      // 1.7 Audio OGG ('OggS') o FLAC ('fLaC') o ID3 (MP3)
      if (
        content[0] === 0x4f &&
        content[1] === 0x67 &&
        content[2] === 0x67 &&
        content[3] === 0x53
      ) {
        return 'AUDIO_RECORDING';
      }
      if (
        content[0] === 0x66 &&
        content[1] === 0x4c &&
        content[2] === 0x61 &&
        content[3] === 0x43
      ) {
        return 'AUDIO_RECORDING';
      }
      if (content[0] === 0x49 && content[1] === 0x44 && content[2] === 0x33) {
        return 'AUDIO_RECORDING';
      }
    }

    // 2. Verificación por estructura de texto
    const textContent =
      typeof content === 'string'
        ? content
        : content instanceof Uint8Array
        ? new TextDecoder('utf-8', { fatal: false }).decode(content.slice(0, 4096))
        : null;

    if (textContent) {
      const trimmed = textContent.trim();
      if (
        trimmed.startsWith('<?xml') &&
        (trimmed.includes('<score-partwise') || trimmed.includes('<score-timewise>'))
      ) {
        return 'STRUCTURED_MUSICXML';
      }
      if (
        /\{(title|key|tempo|start_of_chorus|soc|sov|start_of_verse):/i.test(trimmed) ||
        /\[[A-G][b#]?[^\]]*\]/.test(trimmed)
      ) {
        return 'STRUCTURED_CHORDPRO';
      }
      if (trimmed.startsWith('{') && trimmed.includes('"version"') && trimmed.includes('"timeline"')) {
        return 'WRITTEN_NOTES';
      }
    }

    // 3. Verificación por extensión de archivo (cuando el contenido no es concluyente)
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
    if (lowerName.endsWith('.json')) {
      return 'WRITTEN_NOTES';
    }

    // Por defecto asume notas escritas si es texto general o desconocido
    return 'WRITTEN_NOTES';
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

    // Formato base: MusicXML
    const musicXmlCap: FormatCapabilityInfo = {
      format: 'MUSIC_XML',
      label: 'MusicXML 4.0',
      extension: '.musicxml',
      mimeType: 'application/vnd.recordare.musicxml+xml',
      isAvailable: false,
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
      statusBadge: 'DEFERRED_PHASE',
      description: 'Partitura visual grabada en PDF con tipografía profesional (Bravura).',
      blockingReason:
        'El grabado visual a PDF mediante headless Chromium o VexFlow server-side está programado para Fase 2B. En Fase 2A utilice exportación MusicXML para abrir e imprimir en software de notación.',
    };

    // Formato base: Tablatura (Diferido Fase 2B)
    const tabCap: FormatCapabilityInfo = {
      format: 'TABLATURE',
      label: 'Tablatura (Guitarra/Bajo)',
      extension: '.tab',
      mimeType: 'text/plain',
      isAvailable: false,
      statusBadge: 'DEFERRED_PHASE',
      description: 'Generación de digitaciones automáticas en tablatura de 6 o 4 cuerdas.',
      blockingReason:
        'El cálculo polifónico de digitaciones óptimas de tablatura está programado para Fase 2B.',
    };

    // 1. Fuentes de Audio o Video
    if (isAudioOrVideo) {
      const audioReason =
        'La transcripción automática de audio a partitura (Basic Pitch / Demucs / Whisper.cpp) está diferida formalmente para Fase 2B con modelos locales sin servicios comerciales pagos.';
      musicXmlCap.blockingReason = audioReason;
      midiCap.blockingReason = audioReason;
      chordProCap.blockingReason = audioReason;
      lyricsCap.blockingReason = audioReason;
      return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
    }

    // 2. Fuentes de Partitura en PDF o Imagen (OMR)
    if (isPdfOrImage) {
      const omrReason =
        'El reconocimiento óptico de partituras (OMR con Audiveris / oemer) está diferido para Fase 2B para garantizar precisión profesional sin alucinación de notas.';
      musicXmlCap.blockingReason = omrReason;
      midiCap.blockingReason = omrReason;
      chordProCap.blockingReason = omrReason;
      lyricsCap.blockingReason = omrReason;
      pdfCap.blockingReason = omrReason;
      tabCap.blockingReason = omrReason;
      return [musicXmlCap, midiCap, chordProCap, lyricsCap, pdfCap, tabCap];
    }

    // 3. Fuentes Estructuradas (MusicXML, MIDI, ChordPro, Notas escritas)
    if (sourceCategory === 'STRUCTURED_MUSICXML') {
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'NATIVE';

      midiCap.isAvailable = true;
      midiCap.statusBadge = 'CONVERTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
    } else if (sourceCategory === 'STRUCTURED_MIDI') {
      midiCap.isAvailable = true;
      midiCap.statusBadge = 'NATIVE';

      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
    } else if (sourceCategory === 'STRUCTURED_CHORDPRO') {
      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'NATIVE';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';

      // MusicXML es viable como lead sheet (compases, acordes y letra, sin notas inventadas)
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';

      // MIDI está BLOQUEADO por CERO-FABRICACIÓN si la fuente es sólo cifrado
      midiCap.isAvailable = false;
      midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
      midiCap.blockingReason =
        'No es posible generar MIDI melódico desde un cifrado ChordPro sin notas, pues violaría el principio de CERO invención de melodía.';
    } else {
      // WRITTEN_NOTES
      musicXmlCap.isAvailable = true;
      musicXmlCap.statusBadge = 'CONVERTED';

      midiCap.isAvailable = true;
      midiCap.statusBadge = 'CONVERTED';

      chordProCap.isAvailable = true;
      chordProCap.statusBadge = 'CONVERTED';

      lyricsCap.isAvailable = true;
      lyricsCap.statusBadge = 'CONVERTED';
    }

    // 4. Ajustes Dinámicos según Contenido Real del Payload Canónico (si está disponible)
    if (payload) {
      const notes = payload.getAllNotes();
      const chords = payload.getAllChords();
      const lyrics = payload.getAllLyrics();

      // Si no hay notas melódicas, el formato MIDI se bloquea por cero fabricación
      if (notes.length === 0) {
        midiCap.isAvailable = false;
        midiCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        midiCap.blockingReason =
          'El documento canónico no contiene notas melódicas. No se generará un archivo MIDI con notas inventadas.';
      }

      // Si no hay letra, el formato de solo letra se bloquea
      if (lyrics.length === 0) {
        lyricsCap.isAvailable = false;
        lyricsCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
        lyricsCap.blockingReason =
          'El documento canónico no contiene texto lírico vocal (obra instrumental).';
      }

      // Si no hay acordes ni letra, ChordPro avisa
      if (chords.length === 0 && lyrics.length === 0) {
        chordProCap.statusBadge = 'BLOCKED_ZERO_FABRICATION';
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
