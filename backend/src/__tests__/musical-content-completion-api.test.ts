/**
 * @file musical-content-completion-api.test.ts
 * @description Pruebas de integración HTTP end-to-end para el sistema de Completitud de Información Musical
 * y Habilitación Inteligente de Formatos del Atril Digital (Scope 1C Integration).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { env } from '../config/env.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../../frontend/src/core/canonical-model/chord-event.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { TempoEvent, TempoMap } from '../../../frontend/src/core/canonical-model/tempo-map.ts';
import { TimeSignature } from '../../../frontend/src/core/canonical-model/time-signature.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { Chord } from '../../../frontend/src/core/music-theory/chord.ts';

function buildMinimalValidMidiBase64(): string {
  // Cabecera SMF 0 (480 TPQN) + 1 pista con Tempo 120 BPM y nota C4 (MIDI 60) duración 480 ticks
  const bytes = [
    // MThd chunk
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, // format 0
    0x00, 0x01, // 1 track
    0x01, 0xe0, // 480 TPQN
    // MTrk chunk
    0x4d, 0x54, 0x72, 0x6b,
    0x00, 0x00, 0x00, 0x19, // 25 bytes track length
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // Time Sig 4/4 (8 bytes)
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // Set Tempo 120 BPM (7 bytes)
    0x00, 0x90, 0x3c, 0x50, // Note On C4 vel 80 (4 bytes)
    0x83, 0x60, 0x80, 0x3c, 0x00, // Note Off C4 after 480 ticks (VLQ 0x83 0x60) (5 bytes -> total 24? wait recalc)
  ];
  // Recalcular longitud exacta de eventos en MTrk + End of Track:
  const trackEvents = [
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 8
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 7
    0x00, 0x90, 0x3c, 0x50, // 4
    0x83, 0x60, 0x80, 0x3c, 0x00, // 5
    0x00, 0xff, 0x2f, 0x00, // End of track (4) -> sum = 28 = 0x1c
  ];
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b,
    0x00, 0x00, 0x00, trackEvents.length,
  ];
  void bytes;
  return Buffer.from([...header, ...trackEvents]).toString('base64');
}

describe('Musical Content Completion & Intelligent Stand Format Enablement API', () => {
  let app: FastifyInstance;
  let directorToken: string;
  let musicianToken: string;
  let viewerToken: string;

  const createdUserIds: string[] = [];
  const createdSongIds: string[] = [];
  const createdProposalIds: string[] = [];
  const createdStorageKeys: string[] = [];

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    const ts = Date.now();
    const userRepo = new DrizzleUserRepository();
    const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);

    const director = await userRepo.create({
      email: `comp-director-${ts}@bethesda.co`,
      passwordHash: 'hash',
      firstName: 'Director',
      lastName: 'Completion',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.push(director.id);
    directorToken = tokenService.signAccessToken({
      sub: director.id,
      email: director.email,
      role: director.role,
    }).token;

    const musician = await userRepo.create({
      email: `comp-musician-${ts}@bethesda.co`,
      passwordHash: 'hash',
      firstName: 'Musico',
      lastName: 'Completion',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.push(musician.id);
    musicianToken = tokenService.signAccessToken({
      sub: musician.id,
      email: musician.email,
      role: musician.role,
    }).token;

    const viewer = await userRepo.create({
      email: `comp-viewer-${ts}@bethesda.co`,
      passwordHash: 'hash',
      firstName: 'Lector',
      lastName: 'Completion',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.push(viewer.id);
    viewerToken = tokenService.signAccessToken({
      sub: viewer.id,
      email: viewer.email,
      role: viewer.role,
    }).token;
  });

  after(async () => {
    try {
      for (const key of createdStorageKeys) {
        const p = path.resolve(process.cwd(), 'storage/sources', path.basename(key));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      if (createdProposalIds.length > 0) {
        await pool.query('DELETE FROM audit_logs WHERE resource = ANY($1::text[])', [createdProposalIds]);
      }
      if (createdSongIds.length > 0) {
        const srcRows = await pool.query<{ storage_path: string | null }>(
          'SELECT storage_path FROM song_sources WHERE song_id = ANY($1::uuid[])',
          [createdSongIds]
        );
        for (const r of srcRows.rows) {
          if (r.storage_path) {
            const p = path.resolve(process.cwd(), 'storage/sources', path.basename(r.storage_path));
            if (fs.existsSync(p)) fs.unlinkSync(p);
          }
        }
        await pool.query(
          "DELETE FROM omr_proposals WHERE raw_payload->>'songId' = ANY($1::text[])",
          [createdSongIds]
        );
        await pool.query('DELETE FROM song_sources WHERE song_id = ANY($1::uuid[])', [createdSongIds]);
        await pool.query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [createdSongIds]);
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
      }
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('should enforce authoritative format capabilities, validate sources, block unaligned/unverified shortcuts, enforce RBAC on approval, and create non-destructive song versions', async () => {
    // 1. Crear una canción derivada de audio con acordes DETECTED y ESTIMATED (0 notas, 0 letra) — idéntica al Lead Sheet de Scope 1C
    const songRepo = new DrizzleSongRepository();
    const initialCanonical = new CanonicalMusicPayload({
      title: 'Canto Armónico Base',
      timeline: new Timeline({
        tpqn: 480,
        tempoMap: new TempoMap([new TempoEvent(0, 72)]),
        measureCount: 2,
        totalDurationTicks: 3840,
      }),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          timeSignature: new TimeSignature(4, 4),
          chords: [
            new ChordEvent({
              id: 'aud-c1',
              chord: Chord.parse('Em'),
              startTick: 0,
              measureNumber: 1,
              evidenceStatus: 'DETECTED',
              confidence: 0.91,
            }),
          ],
        }),
        new Measure({
          number: 2,
          startTick: 1920,
          durationTicks: 1920,
          chords: [
            new ChordEvent({
              id: 'aud-c2',
              chord: Chord.parse('C'),
              startTick: 1920,
              measureNumber: 2,
              evidenceStatus: 'ESTIMATED',
              confidence: 0.62,
              alternativeSymbol: 'Am7',
            }),
          ],
        }),
      ],
      metadata: {
        isAudioDerived: true,
        approvalStatus: 'APPROVED',
        approvedFormats: ['CHORD_PRO', 'MUSIC_XML'],
        approvalScope: 'HARMONIC_LEAD_SHEET_ONLY',
      },
    });

    const created = await songRepo.create({
      title: 'Canto Armónico Base',
      artist: 'Ministerio Bethesda',
      defaultKey: 'Em',
      defaultBpm: 72,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'v1 Lead Sheet Armónico Audio',
      sourceFormat: 'CHORD_PRO',
      canonicalPayload: CanonicalSerializer.serialize(initialCanonical),
    });
    createdSongIds.push(created.song.id);
    const v1Id = created.version.id;

    // 2. Consultar GET /format-capabilities -> los 4 formatos deben estar deshabilitados con razón explícita
    const capRes1 = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}/format-capabilities?instrumentId=acoustic_guitar`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(capRes1.statusCode, 200, capRes1.body);
    const capData1 = capRes1.json().data;
    assert.strictEqual(capData1.capabilities.STAFF_NOTATION.isAvailable, false);
    assert.strictEqual(capData1.capabilities.CHORD_CHART.isAvailable, false);
    assert.strictEqual(capData1.capabilities.CHORD_CHART.leadSheetState, 'CHORDS_AVAILABLE_LYRICS_MISSING');
    assert.strictEqual(capData1.capabilities.LYRICS_ONLY.isAvailable, false);
    assert.strictEqual(capData1.capabilities.TABLATURE.isAvailable, false);

    // 3. Rechazar MusicXML con solo acordes (0 notas) para STAFF_NOTATION y rechazar fake MIDI
    const badXmlPreview = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/validate-preview`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'STAFF_NOTATION',
        sourceKind: 'MUSICXML',
        filename: 'solo_silencios.musicxml',
        rawText: `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P1</part-name></score-part></part-list><part id="P1"><measure number="1"><note><rest/><duration>1920</duration></note></measure></part></score-partwise>`,
      }),
    });
    assert.strictEqual(badXmlPreview.statusCode, 200);
    assert.strictEqual(badXmlPreview.json().data.valid, false);
    assert.ok(badXmlPreview.json().data.validationErrors.length > 0);

    const badMidiRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'STAFF_NOTATION',
        sourceKind: 'MIDI',
        filename: 'falso.mid',
        dataBase64: Buffer.from('not-a-midi-file').toString('base64'),
      }),
    });
    assert.strictEqual(badMidiRes.statusCode, 400);

    // 4. VIEWER no puede crear propuestas de completitud (403)
    const viewerAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${viewerToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'LYRICS_ONLY',
        sourceKind: 'LYRICS_TEXT',
        lyricsData: {
          lyricsText: 'Verso autorizado',
          alignmentMode: 'BY_MEASURE',
          verifiedByHuman: true,
        },
      }),
    });
    assert.strictEqual(viewerAttempt.statusCode, 403);

    // 5. Letra ingresada SIN alinear (UNALIGNED) mantiene CHORD_CHART bloqueado en LYRICS_AVAILABLE_NOT_ALIGNED
    const unalignedPreview = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/validate-preview`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'CHORD_CHART',
        sourceKind: 'LYRICS_TEXT',
        lyricsData: {
          lyricsText: 'El Señor está aquí\nTe adoramos hoy',
          alignmentMode: 'UNALIGNED',
          sourceOrigin: 'MANUAL_ENTRY',
          verifiedByHuman: true,
        },
      }),
    });
    assert.strictEqual(unalignedPreview.statusCode, 200);
    assert.strictEqual(unalignedPreview.json().data.capabilities.CHORD_CHART.isAvailable, false);
    assert.strictEqual(
      unalignedPreview.json().data.capabilities.CHORD_CHART.leadSheetState,
      'LYRICS_AVAILABLE_NOT_ALIGNED'
    );

    // 6. Proponer transcripción automática de voz SIN verificar -> crear propuesta bloquea aprobación directa (Cero Fabricación)
    const unverifiedSpeechProp = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'LYRICS_ONLY',
        sourceKind: 'LYRICS_TEXT',
        lyricsData: {
          lyricsText: 'texto automatico sin revisar',
          alignmentMode: 'BY_MEASURE',
          sourceOrigin: 'UNVERIFIED_AUDIO_SPEECH',
          verifiedByHuman: false,
        },
      }),
    });
    assert.strictEqual(unverifiedSpeechProp.statusCode, 201, unverifiedSpeechProp.body);
    createdProposalIds.push(unverifiedSpeechProp.json().data.proposalId);

    // 7. Músico propone MIDI válido para habilitar PARTITURE + TABLATURE -> v1 canónica NO debe cambiar aún
    const validMidiPropRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'STAFF_NOTATION',
        sourceKind: 'MIDI',
        filename: 'melodia_real.mid',
        dataBase64: buildMinimalValidMidiBase64(),
        notes: 'Melodía principal transcrita en MIDI para revisar',
      }),
    });
    assert.strictEqual(validMidiPropRes.statusCode, 201, validMidiPropRes.body);
    const midiProp = validMidiPropRes.json().data;
    createdProposalIds.push(midiProp.proposalId);
    assert.strictEqual(midiProp.reviewStatus, 'PENDING_REVIEW');

    // Confirmar que la versión activa de la canción sigue siendo v1 (0 notas)
    const beforeApproveSong = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(beforeApproveSong.json().data.version.id, v1Id);
    assert.strictEqual(beforeApproveSong.json().data.version.totalNotes, 0);

    // 8. MUSICIAN no puede aprobar ni publicar propuesta (403 RBAC)
    const musicianApproveAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${midiProp.proposalId}/review`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.strictEqual(musicianApproveAttempt.statusCode, 403);

    // 9. WORSHIP_LEADER aprueba la propuesta MIDI -> crea v2 conservando v1 Y conservando EVIDENCE STATUS (DETECTED/ESTIMATED) de acordes previos
    const approveMidiRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${midiProp.proposalId}/review`,
      headers: { authorization: `Bearer ${directorToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        decision: 'APPROVED',
        notes: 'Melodía verificada contra audio original.',
      }),
    });
    assert.strictEqual(approveMidiRes.statusCode, 200, approveMidiRes.body);
    const reviewBody = approveMidiRes.json().data;
    assert.strictEqual(reviewBody.proposal.approvedVersionNumber, 2);
    assert.strictEqual(reviewBody.capabilitiesResponse.capabilities.STAFF_NOTATION.isAvailable, true);
    assert.strictEqual(reviewBody.capabilitiesResponse.capabilities.STAFF_NOTATION.availabilityStatus, 'APPROVED');
    assert.strictEqual(reviewBody.capabilitiesResponse.capabilities.TABLATURE.isAvailable, true);

    // Verificar preservación no destructiva (v1 + v2) y preservación de evidenceStatus 'ESTIMATED' en acorde 2
    const afterV2Song = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    const v2Canonical = afterV2Song.json().data.version.canonicalPayload;
    assert.strictEqual(v2Canonical.measures[0].chords[0].evidenceStatus, 'DETECTED');
    assert.strictEqual(v2Canonical.measures[1].chords[0].evidenceStatus, 'ESTIMATED');
    assert.strictEqual(v2Canonical.measures[1].chords[0].alternativeSymbol, 'Am7');

    // Obtener ID de la nota creada en v2 para probar validación física de Tablatura (cuerda/traste)
    const createdNoteId = v2Canonical.measures[0].voices[0].events[0].id as string;
    assert.ok(createdNoteId);

    // 10. Override de tablatura físicamente inconsistente (C4=MIDI 60 asignado a Cuerda 1 Traste 5) debe rechazarse con 400
    const badTabOverrideRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'TABLATURE',
        sourceKind: 'EXISTING_NOTES_FRET_OVERRIDE',
        tablatureConfig: {
          instrumentId: 'acoustic_guitar',
          capoFret: 0,
          fretOverrides: [{ noteId: createdNoteId, stringNumber: 1, fret: 5 }],
          tablatureVerified: true,
        },
      }),
    });
    assert.strictEqual(badTabOverrideRes.statusCode, 400);

    // Override físicamente válido para C4 (MIDI 60): Cuerda 2 (B3=59) + Traste 1 = 60 -> aprobado como v3
    const validTabOverrideProp = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'TABLATURE',
        sourceKind: 'EXISTING_NOTES_FRET_OVERRIDE',
        tablatureConfig: {
          instrumentId: 'acoustic_guitar',
          capoFret: 0,
          fretOverrides: [{ noteId: createdNoteId, stringNumber: 2, fret: 1 }],
          tablatureVerified: true,
        },
      }),
    });
    assert.strictEqual(validTabOverrideProp.statusCode, 201, validTabOverrideProp.body);
    const tabPropId = validTabOverrideProp.json().data.proposalId;
    createdProposalIds.push(tabPropId);

    const approveTabRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${tabPropId}/review`,
      headers: { authorization: `Bearer ${directorToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.strictEqual(approveTabRes.statusCode, 200, approveTabRes.body);
    assert.strictEqual(approveTabRes.json().data.proposal.approvedVersionNumber, 3);
    assert.strictEqual(
      approveTabRes.json().data.capabilitiesResponse.capabilities.TABLATURE.tablatureSummary.humanVerifiedPositionsCount,
      1
    );

    // 11. Agregar letra verificada con encabezados de metadatos (deben filtrarse) alineada por compás y aprobar como v4 -> habilita CHORD_CHART y LYRICS_ONLY
    const alignedLyricsPropRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'CHORD_CHART',
        sourceKind: 'LYRICS_TEXT',
        filename: 'letra_oficial.txt',
        lyricsData: {
          lyricsText:
            'Canción Lead Sheet Test\n' +
            'Canción original de prueba\n' +
            'Tonalidad: Sol mayor (G) | Compás: 4/4 | Tempo: 96 BPM\n' +
            '[Verso 1]\nEl Señor está aquí\nTe adoramos hoy',
          alignmentMode: 'BY_MEASURE',
          sourceOrigin: 'TXT_IMPORT',
          verifiedByHuman: true,
        },
      }),
    });
    assert.strictEqual(alignedLyricsPropRes.statusCode, 201, alignedLyricsPropRes.body);
    const lyrPropId = alignedLyricsPropRes.json().data.proposalId;
    createdProposalIds.push(lyrPropId);

    // Verificar que las líneas de encabezado/metadatos NO fueron convertidas en sílabas líricas
    const previewHeaderFilterRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/validate-preview`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'CHORD_CHART',
        sourceKind: 'LYRICS_TEXT',
        filename: 'letra_oficial.txt',
        lyricsData: {
          lyricsText:
            'Canción Lead Sheet Test\n' +
            'Canción original de prueba\n' +
            'Tonalidad: Sol mayor (G) | Compás: 4/4 | Tempo: 96 BPM\n' +
            '[Verso 1]\nEl Señor está aquí',
          alignmentMode: 'BY_MEASURE',
          sourceOrigin: 'TXT_IMPORT',
          verifiedByHuman: true,
        },
      }),
    });
    assert.strictEqual(previewHeaderFilterRes.statusCode, 200);
    const previewLyricsTokens = previewHeaderFilterRes
      .json()
      .data.candidateCanonicalPayload.measures.flatMap((m: any) => m.lyrics.map((l: any) => l.text));
    assert.strictEqual(previewLyricsTokens.includes('original'), false);
    assert.strictEqual(previewLyricsTokens.includes('prueba'), false);
    assert.strictEqual(previewLyricsTokens.includes('96'), false);
    assert.strictEqual(previewLyricsTokens.includes('Señor'), true);

    const approveLyrRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${lyrPropId}/review`,
      headers: { authorization: `Bearer ${directorToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.strictEqual(approveLyrRes.statusCode, 200, approveLyrRes.body);
    const finalCaps = approveLyrRes.json().data.capabilitiesResponse.capabilities;
    assert.strictEqual(finalCaps.STAFF_NOTATION.isAvailable, true);
    assert.strictEqual(finalCaps.CHORD_CHART.isAvailable, true);
    assert.strictEqual(finalCaps.CHORD_CHART.leadSheetState, 'COMPLETE_AND_APPROVED');
    assert.strictEqual(finalCaps.LYRICS_ONLY.isAvailable, true);
    assert.strictEqual(finalCaps.TABLATURE.isAvailable, true);

    // 12. Rechazar propuesta no altera la versión activa v4
    const rejectPropRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals`,
      headers: { authorization: `Bearer ${musicianToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        targetFormat: 'LYRICS_ONLY',
        sourceKind: 'LYRICS_TEXT',
        lyricsData: {
          lyricsText: 'Propuesta descartada',
          alignmentMode: 'BY_MEASURE',
          verifiedByHuman: false,
        },
      }),
    });
    assert.strictEqual(rejectPropRes.statusCode, 201);
    const rejId = rejectPropRes.json().data.proposalId;
    createdProposalIds.push(rejId);

    const doReject = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${rejId}/review`,
      headers: { authorization: `Bearer ${directorToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ decision: 'REJECTED', notes: 'Letra incorrecta' }),
    });
    assert.strictEqual(doReject.statusCode, 200);
    assert.strictEqual(doReject.json().data.proposal.reviewStatus, 'REJECTED');

    // No permitir aprobar una propuesta ya rechazada (400)
    const approveRejectedAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${created.song.id}/completion/proposals/${rejId}/review`,
      headers: { authorization: `Bearer ${directorToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.strictEqual(approveRejectedAttempt.statusCode, 400);

    // Confirmar que las versiones v1, v2, v3, v4 coexisten intactas
    const versionsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}/versions`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(versionsRes.statusCode, 200);
    assert.strictEqual(versionsRes.json().data.length, 4);
  });
});
