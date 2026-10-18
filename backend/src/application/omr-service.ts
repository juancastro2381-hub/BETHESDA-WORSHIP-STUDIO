/**
 * @file omr-service.ts
 * @description Servicio de aplicación para Reconocimiento Óptico de Música (OMR) y flujo de revisión humana (Fase 3C — D2 / R1-P1).
 *
 * Enforce:
 * 1. La salida de IA es solo una propuesta preliminar con isAiDraft: true.
 * 2. No se puede comprometer al catálogo canónico sin aprobación humana explícita.
 * 3. Trazabilidad completa con hash y archivo de origen.
 * 4. R1-P1: La persistencia canónica convierte directamente los compases reconocidos y aprobados.
 *    CERO uso de fixtures simulados o hardcodeados en persistencia canónica.
 */

import type { IOmrProvider } from '../domain/omr/omr-provider.ts';
import type { OmrProposal, OmrRecognitionInput } from '../domain/omr/types.ts';
import type { ISongRepository, SongWithVersion } from '../repositories/song-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { TimeSignature } from '../../../frontend/src/core/canonical-model/time-signature.ts';
import { KeySignatureReference } from '../../../frontend/src/core/canonical-model/key-signature-reference.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { TempoEvent, TempoMap } from '../../../frontend/src/core/canonical-model/tempo-map.ts';
import { ChordEvent } from '../../../frontend/src/core/canonical-model/chord-event.ts';
import { Note, Rest, Voice } from '../../../frontend/src/core/canonical-model/musical-event.ts';
import { LyricSyllable } from '../../../frontend/src/core/canonical-model/lyric-syllable.ts';
import { CANONICAL_TPQN } from '../../../frontend/src/core/canonical-model/types.ts';
import { Chord } from '../../../frontend/src/core/music-theory/chord.ts';
import { KeySignature } from '../../../frontend/src/core/music-theory/key-signature.ts';
import { NoteName } from '../../../frontend/src/core/music-theory/note-name.ts';
import { Pitch } from '../../../frontend/src/core/music-theory/pitch.ts';

export class OmrService {
  private proposals: Map<string, OmrProposal>;
  private provider: IOmrProvider;
  private songRepo: ISongRepository;

  constructor(provider: IOmrProvider, songRepo: ISongRepository) {
    this.proposals = new Map();
    this.provider = provider;
    this.songRepo = songRepo;
  }

  /**
   * Procesa un archivo de partitura y genera una propuesta preliminar (AI Draft).
   */
  public async processUpload(
    input: OmrRecognitionInput,
    _userId: string
  ): Promise<OmrProposal> {
    const proposal = await this.provider.recognize(input);
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * Obtiene una propuesta OMR por ID.
   */
  public getProposal(proposalId: string): OmrProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new NotFoundError('Propuesta OMR', proposalId);
    }
    return proposal;
  }

  /**
   * Aplica revisión humana a una propuesta OMR (aprobación o rechazo).
   */
  public reviewProposal(
    proposalId: string,
    userId: string,
    status: 'APPROVED_FOR_IMPORT' | 'REJECTED'
  ): OmrProposal {
    const proposal = this.getProposal(proposalId);

    proposal.reviewStatus = status;
    proposal.reviewedAt = new Date().toISOString();
    proposal.reviewedByUserId = userId;

    return proposal;
  }

  /**
   * Convierte una propuesta OMR aprobada en una canción canónica en la base de datos PostgreSQL.
   */
  public async commitToCanonicalSong(
    proposalId: string,
    _userId: string,
    overrides?: { title?: string; key?: string }
  ): Promise<SongWithVersion> {
    const proposal = this.getProposal(proposalId);

    if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
      throw new ValidationError(
        'La propuesta de reconocimiento OMR debe ser revisada y aprobada por un humano antes de persistirse en el catálogo canónico.'
      );
    }

    if (!proposal.measures || proposal.measures.length === 0) {
      throw new ValidationError(
        'No se puede comprometer al catálogo canónico una propuesta OMR sin compases reconocidos válidos.'
      );
    }

    const title = overrides?.title || proposal.detectedTitle || 'Canción Importada por OMR';
    const defaultKey = overrides?.key || proposal.detectedKey || 'C';
    const defaultBpm = proposal.detectedBpm || 120;
    const timeSignature = proposal.detectedTimeSignature || '4/4';

    // R1-P1: Convertir DIRECTAMENTE los compases validados de la propuesta en el payload canónico.
    // CERO invención de fixtures ni sustitución por datos ajenos.
    const canonicalPayload = this.convertProposalToCanonical(proposal, title);
    const canonicalJSON = CanonicalSerializer.serialize(canonicalPayload);

    const created = await this.songRepo.create({
      title,
      defaultKey,
      defaultBpm,
      timeSignature,
      status: 'APPROVED',
      versionName: 'Partitura Escaneada (OMR)',
      versionDescription: `Importado mediante OMR desde ${proposal.sourceFilename} (Hash: ${proposal.sourceHash.substring(0, 8)}). Confianza IA: ${(proposal.overallConfidence * 100).toFixed(1)}%. Compases: ${proposal.measures.length}.`,
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
      metadata: {
        notes: `Reconocido ópticamente y revisado por usuario humano. Hash fuente: ${proposal.sourceHash}.`,
      },
    });

    return created;
  }

  /**
   * Convierte los compases validados de una propuesta OMR aprobada
   * en una estructura canónica CanonicalMusicPayload (R1-P1).
   */
  private convertProposalToCanonical(proposal: OmrProposal, title: string): CanonicalMusicPayload {
    const timeSig = TimeSignature.FOUR_FOUR;
    const measureDurationTicks = timeSig.calculateMeasureDurationTicks(); // 1920 ticks
    const bpm = proposal.detectedBpm || 120;
    const tempoMap = new TempoMap([new TempoEvent(0, bpm)]);

    const rawKey = (proposal.detectedKey || 'C').toUpperCase();
    const noteNameKey = (NoteName as any)[rawKey] ?? NoteName.C;
    const keySigRef = new KeySignatureReference(
      noteNameKey,
      'MAJOR',
      new KeySignature(0)
    );

    const measures: Measure[] = [];
    let currentTick = 0;
    let syllableSeq = 1;

    for (let idx = 0; idx < proposal.measures.length; idx++) {
      const mProp = proposal.measures[idx];
      const measureNum = mProp.measureNumber || idx + 1;
      const measureStartTick = currentTick;

      // 1. Acordes reconocidos
      const chords: ChordEvent[] = [];
      if (mProp.chordsDetected && mProp.chordsDetected.length > 0) {
        let chordIdx = 1;
        for (const c of mProp.chordsDetected) {
          try {
            const parsed = Chord.parse(c.chord);
            const beatOffset = Math.max(0, (c.beat - 1) * 480);
            chords.push(
              new ChordEvent({
                id: `omr_chord_${measureNum}_${chordIdx++}`,
                chord: parsed,
                startTick: measureStartTick + beatOffset,
                measureNumber: measureNum,
                voice: 1,
              })
            );
          } catch {
            // Ignorar cifrado ilegible
          }
        }
      }

      // 2. Notas reconocidas
      const notes: Note[] = [];
      let noteTick = measureStartTick;
      if (mProp.notesDetected && mProp.notesDetected.length > 0) {
        let noteIdx = 1;
        for (const n of mProp.notesDetected) {
          const stepName = (NoteName as any)[n.step.toUpperCase()] ?? NoteName.C;
          const pitch = new Pitch(stepName, n.octave);
          let durationTicks = 480;
          if (n.duration === 'whole') durationTicks = 1920;
          else if (n.duration === 'half') durationTicks = 960;
          else if (n.duration === 'eighth') durationTicks = 240;
          else if (n.duration === 'sixteenth') durationTicks = 120;

          notes.push(
            new Note({
              id: `omr_note_${measureNum}_${noteIdx++}`,
              pitch,
              startTick: noteTick,
              durationTicks,
              voice: 1,
              staff: 1,
            })
          );
          noteTick += durationTicks;
        }
      }

      const voice = notes.length > 0
        ? new Voice(1, notes)
        : new Voice(1, [
            new Rest({
              id: `omr_rest_${measureNum}`,
              startTick: measureStartTick,
              durationTicks: measureDurationTicks,
              voice: 1,
              staff: 1,
            }),
          ]);

      // 3. Lírica reconocida
      const lyrics: LyricSyllable[] = [];
      if (mProp.lyricsDetected && mProp.lyricsDetected.length > 0) {
        for (const l of mProp.lyricsDetected) {
          lyrics.push(
            new LyricSyllable({
              id: `omr_syl_${measureNum}_${syllableSeq}`,
              text: l.text,
              measureNumber: measureNum,
              tickOffset: 0,
              sequenceNumber: syllableSeq++,
              isHyphenated: l.text.endsWith('-'),
            })
          );
        }
      }

      measures.push(
        new Measure({
          number: measureNum,
          startTick: measureStartTick,
          durationTicks: measureDurationTicks,
          timeSignature: timeSig,
          keySignature: keySigRef,
          voices: [voice],
          chords,
          lyrics,
        })
      );

      currentTick += measureDurationTicks;
    }

    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      tempoMap,
      measureCount: measures.length,
      totalDurationTicks: Math.max(1920, currentTick),
    });

    return new CanonicalMusicPayload({
      title,
      timeline,
      measures,
    });
  }

  /**
   * Reset para entornos de prueba
   */
  public clearProposals(): void {
    this.proposals.clear();
  }
}
