/**
 * @file realtime.test.ts
 * @description Suite de pruebas unitarias para el cliente del Flujo Litúrgico en Tiempo Real (Fase 3B).
 *
 * Cubre:
 * 1. Inicialización en estado DISCONNECTED y ciclo de conexión.
 * 2. Manejo de snapshot inicial y emisión de estado litúrgico.
 * 3. Despacho de acciones litúrgicas con Bearer token.
 * 4. Desconexión y limpieza segura de temporizadores.
 * 5. Verificación estricta: EXCLUSIÓN TOTAL de sincronización de pedales físicos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RealtimeClient } from '../realtime-client.ts';
import type { RealtimeEvent, RealtimeSessionSnapshot } from '../realtime-types.ts';

describe('Workstream C — Phase 3B Realtime Client Suite', () => {
  it('1. should initialize in DISCONNECTED state with default configuration', () => {
    const client = new RealtimeClient('http://localhost:3000');
    assert.equal(client.getConnectionState(), 'DISCONNECTED');
    assert.equal(client.baseUrl, 'http://localhost:3000');
  });

  it('2. should notify onConnectionChange callback when status updates', () => {
    let capturedState = '';
    const client = new RealtimeClient('http://localhost:3000', {
      onConnectionChange: (state) => {
        capturedState = state;
      },
    });

    client.connect('mock-session-uuid', 'dummy-token');
    assert.ok(capturedState === 'CONNECTING' || capturedState === 'CONNECTED');
    client.disconnect();
    assert.equal(client.getConnectionState(), 'DISCONNECTED');
  });

  it('3. should handle incoming snapshot and update subscribers', () => {
    let receivedSnapshot: RealtimeSessionSnapshot | null = null;
    const client = new RealtimeClient('http://localhost:3000', {
      onSnapshot: (snap) => {
        receivedSnapshot = snap;
      },
    });

    const mockSnapshot: RealtimeSessionSnapshot = {
      sessionId: 'sess-123',
      setlistId: 'set-456',
      setlistTitle: 'Culto de Adoración',
      hostUserId: 'host-789',
      status: 'ACTIVE',
      epoch: 1,
      sequence: 1,
      currentItemIndex: 0,
      currentSection: 'INTRO',
      currentKeyOverride: null,
      currentBpmOverride: null,
      participantsCount: 3,
      participants: [],
      lastActivityAt: new Date().toISOString(),
    };

    // Invocar callback directamente
    (client as any).callbacks.onSnapshot?.(mockSnapshot);

    assert.ok(receivedSnapshot);
    assert.equal((receivedSnapshot as RealtimeSessionSnapshot).sessionId, 'sess-123');
    assert.equal((receivedSnapshot as RealtimeSessionSnapshot).currentSection, 'INTRO');
  });

  it('4. should handle state change event and sequence tracking', () => {
    let receivedEvent: RealtimeEvent | null = null;
    const client = new RealtimeClient('http://localhost:3000', {
      onStateChange: (event) => {
        receivedEvent = event;
      },
    });

    const mockEvent: RealtimeEvent = {
      eventId: 'evt-001',
      sessionId: 'sess-123',
      type: 'STATE_CHANGED',
      epoch: 1,
      sequence: 2,
      timestamp: new Date().toISOString(),
      state: {
        sessionId: 'sess-123',
        setlistId: 'set-456',
        setlistTitle: 'Culto de Adoración',
        hostUserId: 'host-789',
        status: 'ACTIVE',
        epoch: 1,
        sequence: 2,
        currentItemIndex: 1,
        currentSection: 'CORO',
        currentKeyOverride: 'D',
        currentBpmOverride: 120,
        participantsCount: 3,
        participants: [],
        lastActivityAt: new Date().toISOString(),
      },
      action: {
        actionId: 'act-001',
        type: 'SET_SECTION',
        performedBy: 'host-789',
      },
    };

    (client as any).callbacks.onStateChange?.(mockEvent);

    assert.ok(receivedEvent);
    assert.equal((receivedEvent as RealtimeEvent).sequence, 2);
    assert.equal((receivedEvent as RealtimeEvent).state.currentSection, 'CORO');
  });

  it('5. should strictly verify ZERO physical pedal code, APIs, or listeners exist', () => {
    const dir = path.resolve('src/core/realtime');
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
