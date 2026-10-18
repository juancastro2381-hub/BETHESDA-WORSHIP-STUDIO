/**
 * @file multitracks.test.ts
 * @description Suite de pruebas unitarias para el motor de Multipistas frontend (Fase 3C — D1).
 *
 * Cubre:
 * 1. Inicialización de sesión y acotamiento de parámetros (volumen, pan).
 * 2. Lógica de consola: precedencia estricta de Solo y Mute en el cálculo de ganancia.
 * 3. Búsqueda sincronizada (seek) y máquina de estados (play, pause, stop).
 * 4. Verificación de completitud offline: denegación ante stems faltantes.
 * 5. Verificación estricta: EXCLUSIÓN TOTAL de sincronización de pedales físicos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MultitrackEngine } from '../multitrack-engine.ts';
import type { MultitrackSession } from '../types.ts';

describe('Workstream D — Phase 3C Multitrack Engine Suite (Frontend)', () => {
  const mockSession: MultitrackSession = {
    id: 'session-multitrack-01',
    songId: 'song-01',
    title: 'Digno y Santo',
    durationSeconds: 240,
    bpm: 72,
    tracks: [
      {
        id: 'track-click',
        sessionId: 'session-multitrack-01',
        name: 'Click',
        trackType: 'CLICK',
        audioAssetId: 'asset-click-01',
        volume: 0.8,
        pan: -1.0,
        isMuted: false,
        isSolo: false,
        offsetMs: 0,
        sortOrder: 1,
      },
      {
        id: 'track-cues',
        sessionId: 'session-multitrack-01',
        name: 'Guía / Cues',
        trackType: 'CUES',
        audioAssetId: 'asset-cues-02',
        volume: 0.7,
        pan: 1.0,
        isMuted: false,
        isSolo: false,
        offsetMs: 0,
        sortOrder: 2,
      },
      {
        id: 'track-drums',
        sessionId: 'session-multitrack-01',
        name: 'Batería',
        trackType: 'DRUMS',
        audioAssetId: 'asset-drums-03',
        volume: 0.9,
        pan: 0.0,
        isMuted: false,
        isSolo: false,
        offsetMs: 10,
        sortOrder: 3,
      },
    ],
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
  };

  it('1. should calculate default gains correctly when no solo is active', () => {
    const engine = new MultitrackEngine(mockSession);
    assert.equal(engine.getEffectiveGain('track-click'), 0.8);
    assert.equal(engine.getEffectiveGain('track-cues'), 0.7);
    assert.equal(engine.getEffectiveGain('track-drums'), 0.9);
  });

  it('2. should silence non-solo tracks when solo is activated on a track', () => {
    const engine = new MultitrackEngine(mockSession);
    engine.toggleSolo('track-drums');

    // La batería tiene solo: conserva su volumen
    assert.equal(engine.getEffectiveGain('track-drums'), 0.9);
    // Click y Cues no tienen solo: se silencian a 0.0
    assert.equal(engine.getEffectiveGain('track-click'), 0.0);
    assert.equal(engine.getEffectiveGain('track-cues'), 0.0);
  });

  it('3. should enforce mute precedence: muted track has 0.0 gain even with solo active', () => {
    const engine = new MultitrackEngine(mockSession);
    engine.toggleSolo('track-drums');
    engine.toggleMute('track-drums'); // Mute + Solo simultáneos

    assert.equal(engine.getEffectiveGain('track-drums'), 0.0);
  });

  it('4. should clamp volume in [0.0, 1.0] and pan in [-1.0, 1.0]', () => {
    const engine = new MultitrackEngine(mockSession);

    engine.setTrackVolume('track-click', 2.5);
    assert.equal(engine.session.tracks[0]!.volume, 1.0);

    engine.setTrackVolume('track-click', -0.5);
    assert.equal(engine.session.tracks[0]!.volume, 0.0);

    engine.setTrackPan('track-cues', 3.0);
    assert.equal(engine.session.tracks[1]!.pan, 1.0);

    engine.setTrackPan('track-cues', -5.0);
    assert.equal(engine.session.tracks[1]!.pan, -1.0);
  });

  it('5. should synchronize seek and playback controls across unified timeline', () => {
    const engine = new MultitrackEngine(mockSession);
    assert.equal(engine.isPlaying, false);

    engine.play();
    assert.equal(engine.isPlaying, true);

    engine.seek(65.5);
    assert.equal(engine.currentTime, 65.5);

    // Búsqueda más allá de la duración acota a la duración
    engine.seek(500);
    assert.equal(engine.currentTime, 240);

    engine.stop();
    assert.equal(engine.isPlaying, false);
    assert.equal(engine.currentTime, 0);
  });

  it('6. should validate offline completeness: ready only if 100% of stems are available', () => {
    // Caso 1: Solo 2 de 3 disponibles -> No está listo para offline
    const partialAvailable = new Set(['asset-click-01', 'asset-cues-02']);
    const checkPartial = MultitrackEngine.isFullyAvailableOffline(mockSession, partialAvailable);
    assert.equal(checkPartial.isReady, false);
    assert.equal(checkPartial.missingCount, 1);
    assert.deepEqual(checkPartial.missingIds, ['asset-drums-03']);

    // Caso 2: Los 3 stems disponibles -> Listo para offline
    const fullAvailable = new Set(['asset-click-01', 'asset-cues-02', 'asset-drums-03']);
    const checkFull = MultitrackEngine.isFullyAvailableOffline(mockSession, fullAvailable);
    assert.equal(checkFull.isReady, true);
    assert.equal(checkFull.missingCount, 0);
  });

  it('7. should strictly verify ZERO physical pedal code, APIs, or listeners exist', () => {
    const dir = path.resolve('src/core/multitracks');
    const files = fs.readdirSync(dir);

    const forbiddenTerms = [
      'pedal',
      'bluetooth',
      'navigator.bluetooth',
      'navigator.usb',
      'navigator.hid',
      'gamepad',
      'PageUp',
      'PageDown',
    ];

    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const term of forbiddenTerms) {
          assert.equal(
            content.toLowerCase().includes(term.toLowerCase()),
            false,
            `Forbidden pedal term "${term}" found in ${file}`
          );
        }
      }
    }
  });
});
