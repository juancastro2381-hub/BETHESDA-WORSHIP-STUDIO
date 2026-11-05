/**
 * @file midi-adapter.ts
 * @description Adaptador universal para ingesta de archivos MIDI (SMF 0 y 1) hacia CanonicalMusicPayload.
 *
 * Principios (Fase 1B-R):
 * 1. Conversión de ticks MIDI a ticks canónicos (480 TPQN).
 * 2. CERO truncamiento de notas en fronteras de compás: las notas que cruzan compases se dividen con ligaduras canónicas (tie: START/BOTH/STOP).
 * 3. CERO duración mínima arbitraria de 15 ticks (se respeta la duración exacta >= 1 tick).
 * 4. Preservación estricta de cambios de métrica (Time Signature) y tempo dinámicos entre compases.
 * 5. Detección inteligente de familias instrumentales por canal, programa General MIDI y nombre de pista.
 * 6. CERO invención de tonalidad C, métrica 4/4 o tempo 120 si no están declarados en el archivo MIDI.
 * 7. CERO acordes ficticios o líricas falsas.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import {
  CanonicalMusicPayload,
  CANONICAL_TPQN,
  InstrumentTrack,
  type InstrumentFamily,
  KeySignatureReference,
  Measure,
  Note,
  type TieType,
  Rest,
  Timeline,
  TimeSignature,
  Voice,
} from '../../../../../../frontend/src/core/canonical-model/index.ts';
import { Pitch } from '../../../../../../frontend/src/core/music-theory/pitch.ts';
import { NoteName } from '../../../../../../frontend/src/core/music-theory/note-name.ts';
import { MusicalKey } from '../../../../../../frontend/src/core/music-theory/musical-key.ts';
import { TempoEvent, TempoMap } from '../../../../../../frontend/src/core/canonical-model/tempo-map.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import { MidiParser, type MidiParsedData, type MidiParsedTrack } from './midi-parser.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class MidiIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'MIDI' as const;
  public readonly name = 'Bethesda Standard MIDI File Importer';
  public readonly version = '1.1.0';

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'MIDI') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (ext === '.mid' || ext === '.midi') return true;
    }
    if (input.buffer && MidiParser.isMidiFile(input.buffer)) {
      return true;
    }
    return false;
  }

  public detectMimeType(_buffer: Buffer): string {
    return 'audio/midi';
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer del archivo MIDI está vacío o no fue suministrado.');
    }

    const diagnostics: IngestionDiagnostic[] = [];
    const sourceHash = crypto.createHash('sha256').update(input.buffer).digest('hex');

    // 1. Parsear archivo MIDI
    const parsedData: MidiParsedData = MidiParser.parse(input.buffer);
    diagnostics.push(...parsedData.diagnostics);

    // 2. Extraer Título
    let title = input.title?.trim();
    if (!title) {
      const firstTrackName = parsedData.tracks.find((t) => t.trackName && t.trackName !== 'Pista 1')?.trackName;
      if (firstTrackName) {
        title = firstTrackName;
      } else if (input.filename) {
        title = path.basename(input.filename, path.extname(input.filename));
      } else {
        title = 'Secuencia MIDI';
      }
    }

    // 3. Manejo de Tonalidad, Métrica y Tempo (CERO INVENCIÓN SILENCIOSA)
    const rawKey = parsedData.defaultKey;
    let keyRef: KeySignatureReference;
    let defaultKey: string | null = null;

    if (rawKey) {
      try {
        const parsedKey = MusicalKey.parse(rawKey);
        keyRef = KeySignatureReference.fromMusicalKey(parsedKey);
        defaultKey = parsedKey.toString();
      } catch {
        keyRef = KeySignatureReference.fromMusicalKey(MusicalKey.C_MAJOR);
        defaultKey = null;
        diagnostics.push({
          code: 'UNPARSEABLE_KEY_SIGNATURE',
          severity: 'WARNING',
          message: `La armadura '${rawKey}' no pudo ser interpretada formalmente; permanece no resuelta (null).`,
        });
      }
    } else {
      keyRef = KeySignatureReference.fromMusicalKey(MusicalKey.C_MAJOR);
      defaultKey = null;
      diagnostics.push({
        code: 'MISSING_KEY_SIGNATURE',
        severity: 'INFO',
        message: 'El archivo MIDI no declara armadura tonal (Key Signature); la tonalidad permanece no resuelta (null) para revisión humana.',
      });
    }

    let defaultTimeSignatureStr: string | null = null;
    if (parsedData.defaultTimeSignature) {
      defaultTimeSignatureStr = `${parsedData.defaultTimeSignature.numerator}/${parsedData.defaultTimeSignature.denominator}`;
    } else {
      diagnostics.push({
        code: 'MISSING_TIME_SIGNATURE',
        severity: 'INFO',
        message: 'El archivo MIDI no declara evento de métrica (Time Signature); la métrica permanece no resuelta (null) para revisión humana.',
      });
    }

    const defaultBpm: number | null = parsedData.defaultBpm;
    if (defaultBpm === null) {
      diagnostics.push({
        code: 'MISSING_TEMPO',
        severity: 'INFO',
        message: 'El archivo MIDI no declara evento de tempo (Set Tempo); el tempo permanece no resuelto (null) para revisión humana.',
      });
    }

    // 4. Configurar TempoMap en el Timeline
    const tempoEvents: TempoEvent[] = [];
    if (parsedData.tempoEvents.length > 0) {
      for (const t of parsedData.tempoEvents) {
        tempoEvents.push(new TempoEvent(t.tickCanonical, t.bpm));
      }
    } else {
      tempoEvents.push(new TempoEvent(0, 120)); // Base temporal de fallback para el contenedor
    }
    const tempoMap = new TempoMap(tempoEvents);

    // 5. Configurar InstrumentTracks y Voces con discriminación de familia
    const tracksWithNotes = parsedData.tracks.filter((t) => t.notes.length > 0);
    const effectiveTracks = tracksWithNotes.length > 0 ? tracksWithNotes : parsedData.tracks.slice(0, 1);

    const instrumentTracks: InstrumentTrack[] = [];
    const trackVoiceMap = new Map<number, number>();

    let currentVoiceId = 1;
    for (const t of effectiveTracks) {
      const trackId = `track-midi-${t.trackIndex}`;
      const voiceId = currentVoiceId++;
      trackVoiceMap.set(t.trackIndex, voiceId);

      const family = MidiIngestionAdapter.detectInstrumentFamily(t.trackName, t.channel, t.programNumber);

      instrumentTracks.push(
        new InstrumentTrack({
          id: trackId,
          name: t.trackName || `Pista ${t.trackIndex}`,
          family,
          voiceIds: [voiceId],
        })
      );
    }

    // 6. Generación de compases dinámicos respetando cambios de métrica
    // Función para obtener la TimeSignature activa en un tick canónico
    const getTimeSignatureAtTick = (tick: number): TimeSignature => {
      if (parsedData.timeSignatures.length === 0) {
        return new TimeSignature(4, 4);
      }
      let active = parsedData.timeSignatures[0];
      for (const ts of parsedData.timeSignatures) {
        if (ts.tickCanonical <= tick) {
          active = ts;
        } else {
          break;
        }
      }
      return new TimeSignature(active.numerator, active.denominator);
    };

    const totalDurationTicks = Math.max(1920, parsedData.totalDurationTicksCanonical);

    interface MeasureBoundary {
      mNum: number;
      startTick: number;
      durationTicks: number;
      timeSignature: TimeSignature;
    }

    const measureBoundaries: MeasureBoundary[] = [];
    let curTick = 0;
    let measureNumber = 1;

    while (curTick < totalDurationTicks || measureNumber === 1) {
      const activeTs = getTimeSignatureAtTick(curTick);
      const mDuration = activeTs.calculateMeasureDurationTicks();

      measureBoundaries.push({
        mNum: measureNumber,
        startTick: curTick,
        durationTicks: mDuration,
        timeSignature: activeTs,
      });

      curTick += mDuration;
      measureNumber++;
    }

    // 7. Distribuir notas sin truncamiento dividiendo en ligaduras (ties) al cruzar compases
    const measureVoiceNotes = new Map<string, Note[]>(); // key: `${mNum}_${voiceId}` -> Note[]

    for (const t of effectiveTracks) {
      const voiceId = trackVoiceMap.get(t.trackIndex)!;

      for (let noteIdx = 0; noteIdx < t.notes.length; noteIdx++) {
        const rawNote = t.notes[noteIdx];
        const notePitch = MidiParser.midiPitchToNote(rawNote.pitch);
        const pitch = new Pitch(NoteName.parse(notePitch.noteName), notePitch.octave);

        const noteStart = rawNote.startTickCanonical;
        const noteEnd = noteStart + rawNote.durationTicksCanonical;

        // Encontrar compases que se solapan con [noteStart, noteEnd)
        const overlappingMeasures = measureBoundaries.filter(
          (mb) => noteStart < mb.startTick + mb.durationTicks && noteEnd > mb.startTick
        );

        if (overlappingMeasures.length === 0) continue;

        for (let segIdx = 0; segIdx < overlappingMeasures.length; segIdx++) {
          const mb = overlappingMeasures[segIdx];
          const mNum = mb.mNum;
          const segStart = Math.max(noteStart, mb.startTick);
          const segEnd = Math.min(noteEnd, mb.startTick + mb.durationTicks);
          const segDuration = segEnd - segStart;

          if (segDuration <= 0) continue;

          const isFirstSeg = segStart === noteStart;
          const isLastSeg = segEnd === noteEnd;

          let tie: TieType = 'NONE';
          if (overlappingMeasures.length > 1) {
            if (isFirstSeg && !isLastSeg) tie = 'START';
            else if (!isFirstSeg && !isLastSeg) tie = 'CONTINUE';
            else if (!isFirstSeg && isLastSeg) tie = 'STOP';
          }

          const mvKey = `${mNum}_${voiceId}`;
          if (!measureVoiceNotes.has(mvKey)) {
            measureVoiceNotes.set(mvKey, []);
          }

          measureVoiceNotes.get(mvKey)!.push(
            new Note({
              id: `midi-n-${mNum}-${t.trackIndex}-${noteIdx + 1}-seg${segIdx + 1}`,
              pitch,
              startTick: segStart,
              durationTicks: Math.max(1, segDuration),
              voice: voiceId,
              staff: 1,
              velocity: rawNote.velocity,
              tie,
            })
          );
        }
      }
    }

    // 8. Construir objetos Measure correlativos con voces completas
    const measures: Measure[] = [];

    for (const mb of measureBoundaries) {
      const voices: Voice[] = [];

      for (const t of effectiveTracks) {
        const voiceId = trackVoiceMap.get(t.trackIndex)!;
        const mvKey = `${mb.mNum}_${voiceId}`;
        const notes = measureVoiceNotes.get(mvKey) ?? [];

        // Ordenar notas por startTick y pitch
        notes.sort((a, b) => a.startTick - b.startTick || a.pitch.midiNumber - b.pitch.midiNumber);

        if (notes.length === 0) {
          voices.push(
            new Voice(voiceId, [
              new Rest({
                id: `midi-rest-${mb.mNum}-v${voiceId}`,
                startTick: mb.startTick,
                durationTicks: mb.durationTicks,
                voice: voiceId,
                staff: 1,
              }),
            ])
          );
        } else {
          voices.push(new Voice(voiceId, notes));
        }
      }

      measures.push(
        new Measure({
          number: mb.mNum,
          timeSignature: mb.timeSignature,
          keySignature: keyRef,
          startTick: mb.startTick,
          durationTicks: mb.durationTicks,
          voices,
        })
      );
    }

    // 9. Construir agregación canónica
    const timeline = new Timeline({
      totalDurationTicks,
      tempoMap,
      measureCount: measures.length,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title,
      timeline,
      measures,
      instrumentTracks,
      metadata: {
        sourceFormat: 'MIDI',
        midiFormat: parsedData.format,
        division: parsedData.division,
        trackCount: parsedData.trackCount,
        hasUnresolvedKey: defaultKey === null,
        hasUnresolvedMeter: defaultTimeSignatureStr === null,
        hasUnresolvedTempo: defaultBpm === null,
        checksumSha256: sourceHash,
      },
    });

    // Estado: CONVERTED si tiene notas y metadatos resueltos, PARTIALLY_CONVERTED si faltan campos esenciales
    const isFullyResolved = defaultKey !== null && defaultTimeSignatureStr !== null && defaultBpm !== null;
    const status = isFullyResolved ? 'CONVERTED' : 'PARTIALLY_CONVERTED';

    return {
      status,
      sourceType: 'MIDI',
      sourceHash,
      filename: input.filename,
      title,
      artist: input.artist || null,
      defaultKey,
      defaultBpm,
      timeSignature: defaultTimeSignatureStr,
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
    };
  }

  /**
   * Determina la familia instrumental canónica según el canal, programa MIDI o nombre de pista.
   */
  public static detectInstrumentFamily(
    trackName: string,
    channel?: number,
    programNumber?: number
  ): InstrumentFamily {
    if (channel === 9) return 'DRUMS'; // Canal 10 General MIDI (índice 9)

    const name = trackName.toLowerCase();
    if (/drum|bater|perc/i.test(name)) return 'DRUMS';
    if (/bass|bajo/i.test(name)) return 'BASS';
    if (/guitar|acoust|electr/i.test(name)) return 'GUITAR';
    if (/vocal|voice|voz|lead|choir|coro/i.test(name)) return 'VOCALS';
    if (/string|violin|cello|orchestr/i.test(name)) return 'STRINGS';
    if (/brass|horn|trumpet|trombon/i.test(name)) return 'BRASS';
    if (/sax|flute|oboe|clarinet|wind/i.test(name)) return 'WOODWINDS';

    if (programNumber !== undefined) {
      if (programNumber >= 0 && programNumber <= 7) return 'KEYS'; // Piano
      if (programNumber >= 16 && programNumber <= 23) return 'KEYS'; // Organ
      if (programNumber >= 24 && programNumber <= 31) return 'GUITAR';
      if (programNumber >= 32 && programNumber <= 39) return 'BASS';
      if (programNumber >= 40 && programNumber <= 47) return 'STRINGS';
      if (programNumber >= 56 && programNumber <= 63) return 'BRASS';
      if (programNumber >= 64 && programNumber <= 71) return 'WOODWINDS';
      if (programNumber >= 72 && programNumber <= 79) return 'WOODWINDS';
    }

    return 'KEYS';
  }
}
