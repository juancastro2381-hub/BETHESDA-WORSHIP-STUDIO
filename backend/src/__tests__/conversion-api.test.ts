/**
 * @file conversion-api.test.ts
 * @description Suite de pruebas automatizadas para los endpoints del Centro de Conversión Musical (Fase 2A).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.ts';
import { type FastifyInstance } from 'fastify';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { pool } from '../db/index.ts';

describe('Phase 2A — Musical Conversion Center API Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let testUserToken: string;
  let otherUserToken: string;
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const otherUserId = '00000000-0000-0000-0000-000000000002';

  const validChordProContent = `
{title: Sublime Gracia}
{artist: John Newton}
{key: G}
{tempo: 120}
{time: 4/4}
{start_of_verse: Verso 1}
[G]Sublime [D]gracia del Señor
{end_of_verse}
`;

  before(async () => {
    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    testUserToken = tokenService.signAccessToken({
      id: testUserId,
      email: 'musician@bethesda.com',
      role: 'MUSICIAN',
    }).token;
    otherUserToken = tokenService.signAccessToken({
      id: otherUserId,
      email: 'other@bethesda.com',
      role: 'MUSICIAN',
    }).token;
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  it('1. POST /api/v1/conversion/validate — should detect STRUCTURED_MUSICXML and valid capabilities', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/validate',
      payload: {
        filename: 'himno.musicxml',
        rawText: '<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"><measure number="1"></measure></part></score-partwise>',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.detectedCategory, 'STRUCTURED_MUSICXML');
    assert.strictEqual(body.data.canConvert, true);

    const caps = body.data.capabilities;
    assert.ok(caps.find((c: any) => c.format === 'MUSIC_XML' && c.isAvailable));
    assert.ok(caps.find((c: any) => c.format === 'MIDI' && c.isAvailable));
    assert.ok(caps.find((c: any) => c.format === 'CHORD_PRO' && c.isAvailable));
    assert.ok(caps.find((c: any) => c.format === 'LYRICS_ONLY' && c.isAvailable));
    assert.ok(caps.find((c: any) => c.format === 'ENGRAVED_PDF' && !c.isAvailable));
  });

  it('2. POST /api/v1/conversion/validate — should block MIDI for STRUCTURED_CHORDPRO (Zero-Fabrication)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/validate',
      payload: {
        filename: 'canto.cho',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.detectedCategory, 'STRUCTURED_CHORDPRO');

    const midiCap = body.data.capabilities.find((c: any) => c.format === 'MIDI');
    assert.ok(midiCap);
    assert.strictEqual(midiCap.isAvailable, false);
    assert.strictEqual(midiCap.statusBadge, 'BLOCKED_ZERO_FABRICATION');
  });

  it('3. POST /api/v1/conversion/validate — should mark AUDIO_RECORDING as DEFERRED_PHASE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/validate',
      payload: {
        filename: 'ensayo.mp3',
        dataBase64: Buffer.from('fake-mp3-bytes').toString('base64'),
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.detectedCategory, 'AUDIO_RECORDING');
    assert.strictEqual(body.data.canConvert, false);

    for (const cap of body.data.capabilities) {
      assert.strictEqual(cap.isAvailable, false);
      assert.strictEqual(cap.statusBadge, 'DEFERRED_PHASE');
    }
  });

  it('4. POST /api/v1/conversion/transpile — direct execution to LYRICS_ONLY and MUSIC_XML', async () => {
    // 4.1 A solo letra
    const resLyrics = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/transpile',
      payload: {
        filename: 'himno.cho',
        targetFormat: 'LYRICS_ONLY',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(resLyrics.statusCode, 200);
    const lyricsBody = JSON.parse(resLyrics.payload);
    assert.strictEqual(lyricsBody.data.success, true);
    assert.strictEqual(lyricsBody.data.targetFormat, 'LYRICS_ONLY');
    assert.ok(lyricsBody.data.data.includes('Sublime gracia del Señor'));
    assert.ok(!lyricsBody.data.data.includes('[G]'));

    // 4.2 A MusicXML
    const resXml = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/transpile',
      payload: {
        filename: 'himno.cho',
        targetFormat: 'MUSIC_XML',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(resXml.statusCode, 200);
    const xmlBody = JSON.parse(resXml.payload);
    assert.strictEqual(xmlBody.data.success, true);
    assert.ok(xmlBody.data.data.includes('<score-partwise'));

    // 4.3 A MIDI (debe fallar por Cero Fabricación)
    const resMidi = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/transpile',
      payload: {
        filename: 'himno.cho',
        targetFormat: 'MIDI',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(resMidi.statusCode, 200);
    const midiBody = JSON.parse(resMidi.payload);
    assert.strictEqual(midiBody.data.success, false);
    assert.ok(midiBody.data.diagnostics.some((d: any) => d.code === 'CANNOT_EXPORT_MIDI_WITHOUT_NOTES'));
  });

  it('5. POST /api/v1/conversion/jobs — should require authentication (401 Unauthorized)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/jobs',
      payload: {
        filename: 'himno.cho',
        targetFormat: 'LYRICS_ONLY',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(res.statusCode, 401);
  });

  it('6. GET /api/v1/conversion/jobs — should require authentication (401 Unauthorized)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversion/jobs',
    });

    assert.strictEqual(res.statusCode, 401);
  });

  it('7. POST /api/v1/conversion/jobs — should REJECT job creation for AUDIO_RECORDING (Phase 2B Deferred Guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/jobs',
      headers: { authorization: `Bearer ${testUserToken}` },
      payload: {
        filename: 'adoracion.mp3',
        targetFormat: 'MUSIC_XML',
        dataBase64: Buffer.from('fake-mp3-bytes').toString('base64'),
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Fase 2B'));
  });

  it('8. POST /api/v1/conversion/jobs — should REJECT job creation for ChordPro -> MIDI (Zero-Fabrication Guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/jobs',
      headers: { authorization: `Bearer ${testUserToken}` },
      payload: {
        filename: 'cifrado.cho',
        targetFormat: 'MIDI',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('CERO Fabricación'));
  });

  it('9. POST /api/v1/conversion/validate — should expose explicit capabilityState in capabilities matrix', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/validate',
      payload: {
        filename: 'cancion.cho',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    const choCap = body.data.capabilities.find((c: any) => c.format === 'CHORD_PRO');
    assert.strictEqual(choCap.capabilityState, 'SUPPORTED');

    const midiCap = body.data.capabilities.find((c: any) => c.format === 'MIDI');
    assert.strictEqual(midiCap.capabilityState, 'NOT_SUPPORTED');

    const pdfCap = body.data.capabilities.find((c: any) => c.format === 'ENGRAVED_PDF');
    assert.strictEqual(pdfCap.capabilityState, 'PLANNED_PHASE_2B');
  });
});
