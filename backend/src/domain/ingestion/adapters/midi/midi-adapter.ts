/**
 * @file midi-adapter.ts
 * @description Adaptador universal para ingesta de archivos MIDI (SMF 0 y 1) hacia CanonicalMusicPayload (Fase 1B).
 *
 * Principios:
 * 1. Conversión de ticks MIDI a ticks canónicos (480 TPQN).
 * 2. Mapeo de pistas MIDI a InstrumentTrack independientes sin mezclar canales.
 * 3. Partición estricta de notas en compases correlativos y continuos.
 * 4. CERO invención de tonalidades ficticias ni líricas falsas.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import {
  CanonicalMusicPayload,
  CANONICAL_TPQN,
  InstrumentTrack,
  KeySignatureReference,
  Measure,
  Note,
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
  public readonly version = '1.0.0';

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

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer del archivo MIDI está vacío o no fue suministrado.');
    }

    const diagnostics: IngestionDiagnostic[] = [];
    const sourceHash = crypto.createHash('sha256').update(input.buffer).digest('hex');

    // 1. Parsear archivo MIDI
    const parsedData: MidiParsedData = MidiParser.parse(input.buffer);

    // 2. Extraer Título
    let title = input.title?.trim();
    if (!title) {
      // Buscar nombre de la primera pista o nombre de archivo
      const firstTrackName = parsedData.tracks.find((t) => t.trackName && t.trackName !== 'Pista 1')?.trackName;
      if (firstTrackName) {
        title = firstTrackName;
      } else if (input.filename) {
        title = path.basename(input.filename, path.extname(input.filename));
      } else {
        title = 'Secuencia MIDI';
      }
    }

    // 3. Configurar Tonalidad y Métrica
    const timeSigData = parsedData.defaultTimeSignature;
    const timeSig = new TimeSignature(timeSigData.numerator, timeSigData.denominator);
    const measureDurationTicks = timeSig.calculateMeasureDurationTicks();

    // Mapear Tonalidad inicial
    let keyRef: KeySignatureReference;
    try {
      const musicalKey = MusicalKey.parse(parsedData.defaultKey);
      keyRef = KeySignatureReference.fromMusicalKey(musicalKey);
    } catch {
      keyRef = KeySignatureReference.fromMusicalKey(MusicalKey.C_MAJOR);
    }

    // 4. Configurar TempoMap
    const tempoEvents: TempoEvent[] = [];
    if (parsedData.tempoEvents.length > 0) {
      for (const t of parsedData.tempoEvents) {
        tempoEvents.push(new TempoEvent(t.tickCanonical, t.bpm));
      }
    } else {
      tempoEvents.push(new TempoEvent(0, parsedData.defaultBpm));
    }
    const tempoMap = new TempoMap(tempoEvents);

    // 5. Configurar InstrumentTracks y Voces
    const tracksWithNotes = parsedData.tracks.filter((t) => t.notes.length > 0);
    const effectiveTracks = tracksWithNotes.length > 0 ? tracksWithNotes : parsedData.tracks.slice(0, 1);

    const instrumentTracks: InstrumentTrack[] = [];
    const trackVoiceMap = new Map<number, number>(); // trackIndex -> voiceId

    let currentVoiceId = 1;
    for (const t of effectiveTracks) {
      const trackId = `track-midi-${t.trackIndex}`;
      const voiceId = currentVoiceId++;
      trackVoiceMap.set(t.trackIndex, voiceId);

      instrumentTracks.push(
        new InstrumentTrack({
          id: trackId,
          name: t.trackName || `Pista ${t.trackIndex}`,
          family: 'KEYS', // Default safe General MIDI
          voiceIds: [voiceId],
        })
      );
    }

    // 6. Determinar número total de compases requeridos
    const totalDurationTicks = Math.max(measureDurationTicks, parsedData.totalDurationTicksCanonical);
    const measureCount = Math.max(1, Math.ceil(totalDurationTicks / measureDurationTicks));

    // 7. Construir compases correlativos y continuos
    const measures: Measure[] = [];
    let currentTick = 0;

    for (let mNum = 1; mNum <= measureCount; mNum++) {
      const measureStartTick = currentTick;
      const measureEndTick = measureStartTick + measureDurationTicks;

      const voices: Voice[] = [];

      for (const t of effectiveTracks) {
        const voiceId = trackVoiceMap.get(t.trackIndex)!;
        const voiceNotes: Note[] = [];

        // Extraer notas de esta pista que inician dentro de este compás
        const notesInMeasure = t.notes.filter(
          (n) => n.startTickCanonical >= measureStartTick && n.startTickCanonical < measureEndTick
        );

        for (let noteIdx = 0; noteIdx < notesInMeasure.length; noteIdx++) {
          const rawNote = notesInMeasure[noteIdx];
          const notePitch = MidiParser.midiPitchToNote(rawNote.pitch);
          const pitch = new Pitch(NoteName.parse(notePitch.noteName), notePitch.octave);

          // Limitar duración de nota al límite del compás actual para evitar violación canónica
          const maxAllowedDuration = measureEndTick - rawNote.startTickCanonical;
          const noteDuration = Math.min(rawNote.durationTicksCanonical, maxAllowedDuration);

          voiceNotes.push(
            new Note({
              id: `midi-n-${mNum}-${t.trackIndex}-${noteIdx + 1}`,
              pitch,
              startTick: rawNote.startTickCanonical,
              durationTicks: Math.max(15, noteDuration),
              voice: voiceId,
              staff: 1,
              velocity: rawNote.velocity,
            })
          );
        }

        // Si la voz no tiene notas en este compás, agregar un silencio completo de compás
        if (voiceNotes.length === 0) {
          voices.push(
            new Voice(voiceId, [
              new Rest({
                id: `midi-rest-${mNum}-v${voiceId}`,
                startTick: measureStartTick,
                durationTicks: measureDurationTicks,
                voice: voiceId,
                staff: 1,
              }),
            ])
          );
        } else {
          voices.push(new Voice(voiceId, voiceNotes));
        }
      }

      measures.push(
        new Measure({
          number: mNum,
          timeSignature: timeSig,
          keySignature: keyRef,
          startTick: measureStartTick,
          durationTicks: measureDurationTicks,
          voices,
          chords: [], // CERO acordes inventados en MIDI
          lyrics: [], // CERO letras inventadas en MIDI
        })
      );

      currentTick = measureEndTick;
    }

    // 8. Crear Timeline y agregación CanonicalMusicPayload
    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      tempoMap,
      totalDurationTicks: currentTick,
      measureCount: measures.length,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title,
      timeline,
      measures,
      sections: [],
      instrumentTracks,
      metadata: {
        sourceFormat: 'MIDI',
        format: parsedData.format,
        division: parsedData.division,
        midiTrackCount: parsedData.trackCount,
        sourceHash,
      },
    });

    diagnostics.push({
      code: 'MIDI_IMPORT_SUCCESS',
      severity: 'INFO',
      message: `Archivo MIDI importado exitosamente: ${parsedData.trackCount} pistas, ${measures.length} compases, ${parsedData.defaultBpm} BPM.`,
    });

    return {
      status: 'PARSED',
      sourceType: 'MIDI',
      sourceHash,
      filename: input.filename,
      title,
      artist: input.artist || null,
      defaultKey: parsedData.defaultKey,
      defaultBpm: parsedData.defaultBpm,
      timeSignature: `${timeSig.numerator}/${timeSig.denominator}`,
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
    };
  }
}
