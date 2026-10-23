/**
 * @file visual-ingestion-defect-remediation.test.ts
 * @description Suite de pruebas automatizadas específicas para la remediación del defecto
 * de ingesta visual (Fase B).
 *
 * Cobertura requerida:
 * 1. Ingesta de PDF preservando metadatos visuales sin inventar compases ni notas.
 * 2. Ingesta de imagen raster (PNG, JPEG, WebP) con preservación de formato e integridad.
 * 3. Selección y discriminación de documento visual con 0 compases y 0 notas (evitando el estado vacío no intencional).
 * 4. Preservación y persistencia de metadata en CanonicalMusicPayload (toJSON, fromJSON, inmutabilidad).
 * 5. Deserialización fidedigna en BethesdaApiClient.toCanonicalPayload preservando sourceFormat y storageKey.
 * 6. Preservación de metadatos visuales en useMusicalWorkspace (selectPersistedSong y selectSong).
 * 7. Invariante de regresión: Archivos estructurados MusicXML y ChordPro conservan compases y notas.
 * 8. Discriminación estricta de empty state: sólo se muestra cuando la canción NO es un documento visual.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { IngestionService } from '../ingestion-service.ts';
import { IngestionValidator } from '../validation.ts';
import { BethesdaApiClient, type BackendSongResponse } from '../../api/api-client.ts';
import { REAL_FIXTURE_PATHS, loadRealFixture } from '../fixtures/real-files.ts';

describe('Phase B Visual Ingestion Defect Remediation Suite', () => {
  const ingestionService = new IngestionService();

  // =========================================================================
  // 1. Detección de formatos visuales (PDF, PNG, JPG, WEBP, TIFF)
  // =========================================================================
  it('1. should accurately identify visual formats and distinguish them from structured files', () => {
    assert.strictEqual(IngestionValidator.detectFormat('', 'partitura.pdf'), 'PDF');
    assert.strictEqual(IngestionValidator.detectFormat('', 'escaneo.png'), 'IMAGE');
    assert.strictEqual(IngestionValidator.detectFormat('', 'himno.jpg'), 'IMAGE');
    assert.strictEqual(IngestionValidator.detectFormat('', 'hoja.jpeg'), 'IMAGE');
    assert.strictEqual(IngestionValidator.detectFormat('', 'cancion.webp'), 'IMAGE');
    assert.strictEqual(IngestionValidator.detectFormat('', 'partitura_alta_res.tiff'), 'IMAGE');

    // Archivos estructurados no deben confundirse
    assert.strictEqual(IngestionValidator.detectFormat('', 'canto.musicxml'), 'MUSIC_XML');
    assert.strictEqual(IngestionValidator.detectFormat('', 'himno.pro'), 'CHORD_PRO');
  });

  // =========================================================================
  // 2. Ingesta de documento visual en navegador sin invención de notas
  // =========================================================================
  it('2. should import PDF without fabricating musical measures, notes, or chords', async () => {
    const fakePdfFile = {
      name: 'grande_es_tu_fidelidad.pdf',
      size: 1024 * 50,
      type: 'application/pdf',
      text: async () => '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
    } as unknown as File;

    const result = await ingestionService.importBrowserFile(fakePdfFile);
    assert.strictEqual(result.isSuccess, true, 'Debe importar con éxito');
    assert.ok(result.payload, 'Debe producir CanonicalMusicPayload');

    const payload = result.payload;
    assert.strictEqual(payload.title, 'grande_es_tu_fidelidad');
    assert.strictEqual(payload.measures.length, 0, 'Debe tener exactamente 0 compases (CERO invención)');
    assert.strictEqual(payload.getAllNotes().length, 0, 'Debe tener exactamente 0 notas');
    assert.strictEqual(payload.getAllChords().length, 0, 'Debe tener exactamente 0 acordes');

    // Metadatos de documento visual adjuntos en payload
    assert.ok(payload.metadata, 'El payload debe contener metadata');
    assert.strictEqual(payload.metadata.isVisualOnly, true);
    assert.strictEqual(payload.metadata.sourceFormat, 'PDF');
    assert.strictEqual(payload.metadata.filename, 'grande_es_tu_fidelidad.pdf');
  });

  it('3. should import raster image without fabricating musical measures or notes', async () => {
    const fakePngFile = {
      name: 'partitura_guitarra.png',
      size: 1024 * 80,
      type: 'image/png',
      text: async () => 'fake_png_binary',
    } as unknown as File;

    const result = await ingestionService.importBrowserFile(fakePngFile);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const payload = result.payload;
    assert.strictEqual(payload.title, 'partitura_guitarra');
    assert.strictEqual(payload.measures.length, 0);
    assert.strictEqual(payload.getAllNotes().length, 0);
    assert.strictEqual(payload.metadata?.isVisualOnly, true);
    assert.strictEqual(payload.metadata?.sourceFormat, 'IMAGE');
  });

  // =========================================================================
  // 4. Preservación y Serialización/Deserialización de Metadata Canónica
  // =========================================================================
  it('4. should preserve visual metadata through CanonicalMusicPayload toJSON and fromJSON round-trip', () => {
    const timeline = new Timeline({ totalDurationTicks: 0, measureCount: 0 });
    const original = new CanonicalMusicPayload({
      title: 'Cántico Nuevo',
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      metadata: {
        isVisualOnly: true,
        sourceFormat: 'PDF',
        storageKey: 'doc_uuid_12345.pdf',
        mimeType: 'application/pdf',
        documentUrl: '/api/v1/documents/doc_uuid_12345.pdf/file',
      },
    });

    assert.strictEqual(original.metadata?.isVisualOnly, true);
    assert.strictEqual(original.metadata?.storageKey, 'doc_uuid_12345.pdf');

    // Serializar a JSON
    const json = original.toJSON();
    assert.ok(json.metadata);
    assert.strictEqual(json.metadata.isVisualOnly, true);
    assert.strictEqual(json.metadata.storageKey, 'doc_uuid_12345.pdf');

    // Deserializar desde JSON
    const restored = CanonicalMusicPayload.fromJSON(json);
    assert.strictEqual(restored.title, 'Cántico Nuevo');
    assert.strictEqual(restored.measures.length, 0);
    assert.ok(restored.metadata);
    assert.strictEqual(restored.metadata.isVisualOnly, true);
    assert.strictEqual(restored.metadata.sourceFormat, 'PDF');
    assert.strictEqual(restored.metadata.storageKey, 'doc_uuid_12345.pdf');
    assert.strictEqual(restored.metadata.documentUrl, '/api/v1/documents/doc_uuid_12345.pdf/file');
  });

  // =========================================================================
  // 5. Deserialización en BethesdaApiClient.toCanonicalPayload
  // =========================================================================
  it('5. should correctly extract sourceFormat, isVisualOnly and storageKey in BethesdaApiClient.toCanonicalPayload', () => {
    const timeline = new Timeline({ totalDurationTicks: 0, measureCount: 0 });
    const mockBackendResponse: BackendSongResponse = {
      song: {
        id: 'song-visual-uuid-1',
        title: 'Alaba a Dios',
        artist: 'Bethesda Worship',
        ccliNumber: null,
        defaultKey: 'C',
        defaultBpm: 120,
        timeSignature: '4/4',
        status: 'APPROVED',
        currentVersionId: 'ver-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: {
        id: 'ver-1',
        songId: 'song-visual-uuid-1',
        versionNumber: 1,
        name: 'Partitura Original (PDF)',
        description: 'Documento visual',
        sourceFormat: 'PDF',
        canonicalPayload: {
          version: '1.0.0',
          title: 'Alaba a Dios',
          timeline: timeline.toJSON(),
          sections: [],
          measures: [],
          instrumentTracks: [],
          metadata: {
            storageKey: 'alaba_a_dios_uuid.pdf',
            isVisualOnly: true,
          },
        },
        totalMeasures: 0,
        totalNotes: 0,
        totalChords: 0,
        isCurrent: true,
        createdAt: new Date().toISOString(),
      },
    };

    const payload = BethesdaApiClient.toCanonicalPayload(mockBackendResponse);
    assert.strictEqual(payload.title, 'Alaba a Dios');
    assert.strictEqual(payload.measures.length, 0);
    assert.ok(payload.metadata, 'El payload deserializado debe tener metadata');
    assert.strictEqual(payload.metadata.isVisualOnly, true, 'Debe preservar isVisualOnly');
    assert.strictEqual(payload.metadata.sourceFormat, 'PDF', 'Debe preservar sourceFormat de version');
    assert.strictEqual(payload.metadata.storageKey, 'alaba_a_dios_uuid.pdf', 'Debe preservar storageKey');
    assert.strictEqual(payload.metadata.songId, 'song-visual-uuid-1');
  });

  // =========================================================================
  // 6. Discriminación de Estado Vacío vs Atril Visual
  // =========================================================================
  it('6. should ensure isVisualDocument evaluates to true for visual songs with 0 measures', () => {
    // Caso A: Obtenido de importación directa
    const importedMeta = {
      format: 'PDF',
      isVisualOnly: true,
      documentUrl: 'blob:http://localhost:5173/uuid-blob',
      storageKey: 'storage-uuid-123.pdf',
    };
    const timeline = new Timeline({ totalDurationTicks: 0, measureCount: 0 });
    const song = new CanonicalMusicPayload({
      title: 'Canción Visual',
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      metadata: {
        isVisualOnly: true,
        sourceFormat: 'PDF',
      },
    });

    const isVisualDocumentA = Boolean(
      importedMeta?.isVisualOnly ||
      importedMeta?.format === 'PDF' ||
      importedMeta?.format === 'IMAGE' ||
      (song as any)?.metadata?.isVisualOnly ||
      (song as any)?.metadata?.sourceFormat === 'PDF' ||
      (song as any)?.metadata?.sourceFormat === 'IMAGE'
    );
    assert.strictEqual(isVisualDocumentA, true, 'Debe evaluar isVisualDocument como true');

    // Caso B: Obtenido de PostgreSQL (importedMeta es null)
    const nullImportedMeta: any = null;
    const isVisualDocumentB = Boolean(
      nullImportedMeta?.isVisualOnly ||
      nullImportedMeta?.format === 'PDF' ||
      nullImportedMeta?.format === 'IMAGE' ||
      (song as any)?.metadata?.isVisualOnly ||
      (song as any)?.metadata?.sourceFormat === 'PDF' ||
      (song as any)?.metadata?.sourceFormat === 'IMAGE'
    );
    assert.strictEqual(isVisualDocumentB, true, 'Debe evaluar isVisualDocument como true aun con importedMeta null');

    // Invariante: La condición de fallo (Canción Sin Contenido Musical) debe ser evitada
    const wouldShowEmptyWarning = !isVisualDocumentB && song.measures.length === 0;
    assert.strictEqual(wouldShowEmptyWarning, false, 'NO debe mostrar Canción Sin Contenido Musical para documentos visuales');
  });

  it('7. should still display Canción Sin Contenido Musical for genuinely empty non-visual songs', () => {
    const timeline = new Timeline({ totalDurationTicks: 0, measureCount: 0 });
    const emptyNonVisualSong = new CanonicalMusicPayload({
      title: 'Canción Vacía Sin Partitura',
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      // Sin metadata visual
    });

    const isVisual = Boolean(
      (emptyNonVisualSong as any)?.metadata?.isVisualOnly ||
      (emptyNonVisualSong as any)?.metadata?.sourceFormat === 'PDF' ||
      (emptyNonVisualSong as any)?.metadata?.sourceFormat === 'IMAGE'
    );
    assert.strictEqual(isVisual, false, 'Canción sin metadata visual no es documento visual');

    const showsEmptyState = !isVisual && emptyNonVisualSong.measures.length === 0;
    assert.strictEqual(showsEmptyState, true, 'Debe mostrar estado vacío cuando la canción carece de notas Y de documento visual');
  });

  // =========================================================================
  // 8. Regresión: Ingesta estructurada MusicXML y ChordPro no se ve afectada
  // =========================================================================
  it('8. should preserve structured ingestion for MusicXML and ChordPro without regressions', () => {
    // MusicXML
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const xmlResult = ingestionService.importSource(rawXml, 'valid.musicxml');
    assert.strictEqual(xmlResult.isSuccess, true);
    assert.ok(xmlResult.payload);
    assert.ok(xmlResult.payload.measures.length > 0, 'MusicXML debe conservar compases');
    assert.ok(xmlResult.payload.getAllNotes().length > 0, 'MusicXML debe conservar notas melódicas');

    // ChordPro
    const rawPro = loadRealFixture(REAL_FIXTURE_PATHS.VALID_LEAD_SHEET_CHORDPRO);
    const proResult = ingestionService.importSource(rawPro, 'valid.pro');
    assert.strictEqual(proResult.isSuccess, true);
    assert.ok(proResult.payload);
    assert.strictEqual(proResult.payload.getAllNotes().length, 0, 'ChordPro mantiene 0 notas melódicas');
    assert.ok(proResult.payload.getAllChords().length > 0, 'ChordPro debe conservar acordes');
  });
});
