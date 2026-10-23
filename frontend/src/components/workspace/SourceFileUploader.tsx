/**
 * @file SourceFileUploader.tsx
 * @description Componente accesible para importación de partituras MusicXML, ChordPro, documentos PDF
 * e imágenes raster (PNG, JPG, WEBP, TIFF) con atril visual (Fase B).
 *
 * Características:
 * - Selección accesible mediante input de archivo nativo y soporte Drag & Drop.
 * - Validación previa de tamaño (5 MB estructurado, 15 MB documentos/imágenes) y formato antes de procesamiento.
 * - Estados visuales explícitos en español: reposo, arrastre, procesando, éxito y error.
 * - Carga rápida de muestras preconfiguradas para pruebas sin archivos externos.
 * - Preservación de documento original y fallback inmediato de atril visual.
 */

import React, { useRef, useState } from 'react';
import { CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { IngestionService } from '../../core/ingestion/ingestion-service.ts';
import {
  MAX_SAFE_FILE_SIZE_BYTES,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  IngestionValidator,
} from '../../core/ingestion/validation.ts';
import { BethesdaApiClient } from '../../core/api/api-client.ts';
import { useAuth } from '../../core/auth/use-auth.ts';
import { extractPdfPageCount } from '../../core/ingestion/pdf-utils.ts';

const ingestionService = new IngestionService();

export interface SourceFileUploaderProps {
  readonly onSongImported: (
    song: CanonicalMusicPayload,
    meta: {
      sourceName?: string | undefined;
      format: string;
      isVisualOnly?: boolean | undefined;
      documentUrl?: string | undefined;
      storageKey?: string | undefined;
      pageCount?: number | undefined;
    }
  ) => void;
  readonly onImportError?: (message: string, code: string) => void;
  readonly onCancel?: () => void;
}

export const SourceFileUploader: React.FC<SourceFileUploaderProps> = ({
  onSongImported,
  onImportError,
  onCancel,
}) => {
  const { user } = useAuth();
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setErrorMessage(null);
    setSuccessInfo(null);

    const detected = IngestionValidator.detectFormat('', file.name);
    const isVisualDoc = detected === 'PDF' || detected === 'IMAGE';
    const maxLimit = isVisualDoc ? MAX_DOCUMENT_FILE_SIZE_BYTES : MAX_SAFE_FILE_SIZE_BYTES;

    if (file.size > maxLimit) {
      const maxMb = (maxLimit / (1024 * 1024)).toFixed(0);
      const msg = `El archivo "${file.name}" supera el límite máximo permitido de ${maxMb} MB (${(file.size / (1024 * 1024)).toFixed(2)} MB).`;
      setErrorMessage(msg);
      if (onImportError) onImportError(msg, 'INVALID_SOURCE');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Si es un documento visual (PDF o imagen raster)
      if (isVisualDoc) {
        let storageKey: string | undefined;
        // Priorizar URL blob en memoria para renderizado instantáneo y sin fricción de red en sesión activa
        const localBlobUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : undefined;
        let fileUrl: string | undefined = localBlobUrl;
        let detectedPageCount = 1;

        if (detected === 'PDF') {
          try {
            const arrayBuffer = await file.arrayBuffer();
            detectedPageCount = extractPdfPageCount(arrayBuffer);
          } catch {
            detectedPageCount = 1;
          }
        }

        // Si el usuario está autenticado, registrar en servidor con validación de magic bytes y persistencia
        if (user) {
          try {
            const client = BethesdaApiClient.getInstance();
            const inspected = await client.inspectDocument(file);
            storageKey = inspected.storageKey;
            if (inspected.pageCount) {
              detectedPageCount = inspected.pageCount;
            }
            if (!fileUrl) {
              fileUrl = client.getDocumentFileUrl(inspected.storageKey);
            }

            // Persistir opcionalmente en catálogo canónico
            await client.importVisualDocumentSong({
              storageKey: inspected.storageKey,
              filename: file.name,
              mimeType: inspected.mimeType,
              title: file.name.replace(/\.[^/.]+$/, ''),
            });
          } catch (uploadErr) {
            // Si el backend no está disponible o falla la red, usar blob local como fallback
            console.warn('Persistencia en servidor no disponible, usando fallback local en memoria:', uploadErr);
          }
        }

        // Crear URL local si no se obtuvo una del servidor
        if (!fileUrl && typeof URL !== 'undefined' && URL.createObjectURL) {
          fileUrl = URL.createObjectURL(file);
        }

        const result = await ingestionService.importBrowserFile(file);

        if (result.isSuccess && result.payload) {
          const formatLabel = detected === 'PDF' ? 'PDF' : 'Imagen';
          const msg = `"${result.payload.title}" cargada con éxito en modo Atril Visual (${formatLabel}).`;
          setSuccessInfo(msg);

          const payloadWithMetadata = new CanonicalMusicPayload({
            version: result.payload.version,
            title: result.payload.title,
            timeline: result.payload.timeline,
            sections: [...result.payload.sections],
            measures: [...result.payload.measures],
            instrumentTracks: [...result.payload.instrumentTracks],
            metadata: {
              ...(result.payload.metadata ?? {}),
              isVisualOnly: true,
              sourceFormat: detected,
              documentUrl: fileUrl,
              storageKey,
              filename: file.name,
              mimeType: file.type || (detected === 'PDF' ? 'application/pdf' : 'image/png'),
              pageCount: detectedPageCount,
            },
          });

          onSongImported(payloadWithMetadata, {
            sourceName: file.name,
            format: detected,
            isVisualOnly: true,
            documentUrl: fileUrl,
            storageKey,
            pageCount: detectedPageCount,
          });
        } else {
          const firstError = result.diagnostics.find((d) => d.severity === 'ERROR');
          const errText = firstError ? `[${firstError.code}] ${firstError.message}` : 'Error al procesar documento visual.';
          setErrorMessage(errText);
          if (onImportError) onImportError(errText, firstError?.code ?? 'NORMALIZATION_FAILED');
        }
      } else {
        // 2. Archivo estructurado tradicional (MusicXML, ChordPro)
        const result = await ingestionService.importBrowserFile(file);

        if (result.isSuccess && result.payload) {
          const stats = result.statistics;
          const msg = `"${result.payload.title}" importada con éxito (${result.provenance.sourceFormat}, ${stats?.measureCount ?? result.payload.measures.length} compases).`;
          setSuccessInfo(msg);
          onSongImported(result.payload, {
            sourceName: file.name,
            format: result.provenance.sourceFormat,
            isVisualOnly: false,
          });
        } else {
          const firstError = result.diagnostics.find((d) => d.severity === 'ERROR');
          const errText = firstError ? `[${firstError.code}] ${firstError.message}` : 'Error desconocido durante la normalización del archivo.';
          setErrorMessage(errText);
          if (onImportError) onImportError(errText, firstError?.code ?? 'NORMALIZATION_FAILED');
        }
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Fallo inesperado al procesar el archivo: ${text}`);
      if (onImportError) onImportError(text, 'IMPORT_EXCEPTION');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  // Muestra MusicXML sintética para prueba directa en navegador
  const handleLoadSampleMusicXml = () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Cántico Nuevo (Muestra MusicXML)</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voz</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><sound tempo="120"/></direction>
      <harmony><root><root-step>C</root-step></root><kind text="">major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><lyric><syllabic>single</syllabic><text>Ven</text></lyric></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><lyric><syllabic>single</syllabic><text>a</text></lyric></note>
      <harmony><root><root-step>G</root-step></root><kind text="">major</kind></harmony>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><lyric><syllabic>single</syllabic><text>Él</text></lyric></note>
    </measure>
  </part>
</score-partwise>`;

    const blob = new Blob([sampleXml], { type: 'application/xml' });
    const file = new File([blob], 'cantico_nuevo_sample.musicxml', { type: 'application/xml' });
    void processFile(file);
  };

  // Muestra ChordPro sintética para prueba directa en navegador
  const handleLoadSampleChordPro = () => {
    const sampleChordPro = `{title: Alabad al Señor (Muestra ChordPro)}
{key: G}
{tempo: 125}
{time: 4/4}

{soc: Coro}
[G]Alabad al Se[Em]ñor por su bon[C]dad
Porque para [D]siempre es su mise[G]ricordia
{eoc}`;

    const blob = new Blob([sampleChordPro], { type: 'text/plain' });
    const file = new File([blob], 'alabad_al_senor_sample.chordpro', { type: 'text/plain' });
    void processFile(file);
  };

  // Muestra de Documento Visual sintético (Partitura de Alta Resolución)
  const handleLoadSampleVisualDocument = () => {
    const sampleDocFile = new File(['%PDF-1.4 sample score document content'], 'partitura_grande_es_tu_fidelidad.pdf', {
      type: 'application/pdf',
    });
    void processFile(sampleDocFile);
  };

  return (
    <section className="source-file-uploader-card" aria-label="Importar Archivo de Partitura o Cifrado">
      <div className="uploader-header">
        <h3 className="uploader-title">Importar Partitura / Cifrado Musical</h3>
        <span className="uploader-badge">Fase B — MusicXML, ChordPro, PDF &amp; Imágenes</span>
      </div>

      <div
        className={`dropzone-container ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="region"
        aria-label="Zona de arrastre de archivos de partitura"
      >
        <input
          ref={fileInputRef}
          type="file"
          id="music-file-input"
          className="visually-hidden-input"
          accept=".xml,.musicxml,.chordpro,.pro,.chopro,.crd,.txt,.pdf,.png,.jpg,.jpeg,.webp,.tiff,.tif"
          onChange={handleFileChange}
          disabled={isLoading}
          aria-label="Seleccionar archivo de partitura (MusicXML, ChordPro, PDF o imagen)"
        />

        <div className="dropzone-content">
          <span className="dropzone-icon" aria-hidden="true">🎼</span>
          <p className="dropzone-instruction">
            <strong>Arrastra tu partitura aquí</strong> o{' '}
            <label htmlFor="music-file-input" className="file-browse-btn" tabIndex={0} role="button">
              examinar desde tu dispositivo
            </label>
          </p>
          <p className="dropzone-formats">
            Soportados: <code>.musicxml</code>, <code>.chordpro</code>, <code>.pdf</code>, <code>.png</code>, <code>.jpg</code>, <code>.webp</code>, <code>.tiff</code>
            <br />
            <small>(Máx. 5 MB para MusicXML/ChordPro — 15 MB para PDF e Imágenes)</small>
          </p>
        </div>

        {isLoading && (
          <div className="uploader-loading-overlay" aria-live="polite">
            <span className="spinner" aria-hidden="true">⏳</span>
            <span>Inspeccionando archivo y validando firmas binarias...</span>
          </div>
        )}
      </div>

      {/* Muestras rápidas de verificación */}
      <div className="uploader-samples-row" role="group" aria-label="Muestras rápidas de archivo">
        <span className="samples-label">Carga Rápida de Muestra:</span>
        <button
          type="button"
          className="btn-sample-load"
          onClick={handleLoadSampleMusicXml}
          disabled={isLoading}
          id="btn-sample-musicxml"
        >
          📄 Notación MusicXML
        </button>
        <button
          type="button"
          className="btn-sample-load"
          onClick={handleLoadSampleChordPro}
          disabled={isLoading}
          id="btn-sample-chordpro"
        >
          📝 Cifrado ChordPro
        </button>
        <button
          type="button"
          className="btn-sample-load"
          onClick={handleLoadSampleVisualDocument}
          disabled={isLoading}
          id="btn-sample-visual-doc"
        >
          🖼️ Partitura Visual (PDF / Imagen)
        </button>
      </div>

      {/* Mensajes de Estado */}
      {successInfo && (
        <div className="uploader-status-message success" role="status" aria-live="polite">
          <span className="status-icon">✓</span>
          <span>{successInfo}</span>
        </div>
      )}

      {errorMessage && (
        <div className="uploader-status-message error" role="alert" aria-live="assertive">
          <span className="status-icon">✕</span>
          <div className="error-text-col">
            <strong>Fallo en la Ingesta de Partitura:</strong>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {onCancel && (
        <div className="uploader-actions-row">
          <button type="button" className="btn-uploader-cancel" onClick={onCancel}>
            Cerrar Panel de Ingesta
          </button>
        </div>
      )}
    </section>
  );
};

export default SourceFileUploader;
