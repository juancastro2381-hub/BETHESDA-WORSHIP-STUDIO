/**
 * @file SourceFileUploader.tsx
 * @description Componente accesible para importación de archivos de partitura MusicXML y ChordPro (Fase 1H).
 *
 * Características:
 * - Selección accesible mediante input de archivo nativo y soporte Drag & Drop.
 * - Validación previa de tamaño (límite 5MB) y formato antes de procesamiento.
 * - Estados visuales explícitos: reposo, arrastre, procesando, éxito y error.
 * - Acceso a muestras preconfiguradas para pruebas rápidas en navegador.
 * - El componente NO parsea música en JSX; delega estrictamente a IngestionService.
 */

import React, { useRef, useState } from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { IngestionService } from '../../core/ingestion/ingestion-service.ts';
import { MAX_SAFE_FILE_SIZE_BYTES } from '../../core/ingestion/validation.ts';

const ingestionService = new IngestionService();

export interface SourceFileUploaderProps {
  readonly onSongImported: (song: CanonicalMusicPayload, meta: { sourceName?: string; format: string }) => void;
  readonly onImportError?: (message: string, code: string) => void;
  readonly onCancel?: () => void;
}

export const SourceFileUploader: React.FC<SourceFileUploaderProps> = ({
  onSongImported,
  onImportError,
  onCancel,
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setErrorMessage(null);
    setSuccessInfo(null);

    if (file.size > MAX_SAFE_FILE_SIZE_BYTES) {
      const msg = `El archivo "${file.name}" supera el límite máximo seguro de 5 MB (${(file.size / (1024 * 1024)).toFixed(2)} MB).`;
      setErrorMessage(msg);
      if (onImportError) onImportError(msg, 'INVALID_SOURCE');
      return;
    }

    setIsLoading(true);

    try {
      const result = await ingestionService.importBrowserFile(file);

      if (result.isSuccess && result.payload) {
        const stats = result.statistics;
        const msg = `"${result.payload.title}" importada con éxito (${result.provenance.sourceFormat}, ${stats?.measureCount ?? result.payload.measures.length} compases).`;
        setSuccessInfo(msg);
        onSongImported(result.payload, {
          sourceName: file.name,
          format: result.provenance.sourceFormat,
        });
      } else {
        const firstError = result.diagnostics.find((d) => d.severity === 'ERROR');
        const errText = firstError ? `[${firstError.code}] ${firstError.message}` : 'Error desconocido durante la normalización del archivo.';
        setErrorMessage(errText);
        if (onImportError) onImportError(errText, firstError?.code ?? 'NORMALIZATION_FAILED');
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

  return (
    <section className="source-file-uploader-card" aria-label="Importar Archivo de Partitura o Cifrado">
      <div className="uploader-header">
        <h3 className="uploader-title">Importar Partitura / Cifrado Musical</h3>
        <span className="uploader-badge">Fase 1H — MusicXML &amp; ChordPro</span>
      </div>

      <div
        className={`dropzone-container ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="region"
        aria-label="Zona de arrastre de archivos musicales"
      >
        <input
          ref={fileInputRef}
          type="file"
          id="music-file-input"
          className="visually-hidden-input"
          accept=".xml,.musicxml,.chordpro,.pro,.chopro,.crd,.txt"
          onChange={handleFileChange}
          disabled={isLoading}
          aria-label="Seleccionar archivo MusicXML o ChordPro"
        />

        <div className="dropzone-content">
          <span className="dropzone-icon" aria-hidden="true">🎼</span>
          <p className="dropzone-instruction">
            <strong>Arrastra tu archivo aquí</strong> o{' '}
            <label htmlFor="music-file-input" className="file-browse-btn" tabIndex={0} role="button">
              examinar desde tu dispositivo
            </label>
          </p>
          <p className="dropzone-formats">
            Formatos soportados: <code>.musicxml</code>, <code>.xml</code>, <code>.chordpro</code>, <code>.pro</code>, <code>.crd</code> (Máx. 5 MB)
          </p>
        </div>

        {isLoading && (
          <div className="uploader-loading-overlay" aria-live="polite">
            <span className="spinner" aria-hidden="true">⏳</span>
            <span>Validando y normalizando modelo canónico...</span>
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
          📄 Muestra MusicXML (.musicxml)
        </button>
        <button
          type="button"
          className="btn-sample-load"
          onClick={handleLoadSampleChordPro}
          disabled={isLoading}
          id="btn-sample-chordpro"
        >
          📝 Muestra ChordPro (.chordpro)
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
            <strong>Fallo en la Ingesta Musical:</strong>
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
