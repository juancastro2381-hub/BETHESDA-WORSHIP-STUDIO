/**
 * @file ConversionCenterWorkspace.tsx
 * @description Módulo visual principal del Centro de Conversión Musical de Bethesda Worship Studio (Fase 2A).
 *
 * Implementa las 7 secciones obligatorias:
 * - Sección A: Espacio de Carga y Gestión de Archivos (Drag & Drop, explorador de archivos, metadatos).
 * - Sección B: Detección Automática de Categoría y Matriz de Capacidades con Badges visuales.
 * - Sección C: Selector de Formato Objetivo con Reglas de Cero-Fabricación y Formatos Diferidos.
 * - Sección D: Panel de Opciones de Conversión (Transposición, Clave, Tempo, Métrica).
 * - Sección E: Cola de Procesamiento y Barra de Progreso en Tiempo Real.
 * - Sección F: Panel de Revisión Humana (Human-in-the-Loop), Diagnósticos y Vista Previa.
 * - Sección G: Exportación y Acciones (Descarga, Guardar en Catálogo, Abrir en Atril Digital).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { BethesdaApiClient } from '../../core/api/api-client.ts';
import { useAuth } from '../../core/auth/use-auth.ts';
import {
  FormatCapabilitiesEvaluator,
  ConversionEngine,
  type ConversionExportResult,
  type ConversionOptions,
  type ConversionSourceCategory,
  type ConversionTargetFormat,
  type FormatCapabilityInfo,
  type ConversionDiagnostic,
} from '../../core/conversion/index.ts';
import { CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';

export interface ConversionCenterWorkspaceProps {
  readonly onOpenInMusicStand?: (
    payload: CanonicalMusicPayload,
    meta?: { title: string; artist?: string }
  ) => void;
  readonly onClose?: () => void;
  readonly apiClient?: BethesdaApiClient;
}

export const ConversionCenterWorkspace: React.FC<ConversionCenterWorkspaceProps> = ({
  onOpenInMusicStand,
  onClose,
  apiClient,
}) => {
  const client = apiClient ?? BethesdaApiClient.getInstance();
  const { user } = useAuth();
  const engineRef = useRef(new ConversionEngine());

  // Estado del archivo cargado
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileRawText, setFileRawText] = useState<string | null>(null);
  const [fileRawBytes, setFileRawBytes] = useState<Uint8Array | null>(null);
  const [sourceCategory, setSourceCategory] = useState<ConversionSourceCategory | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Capacidades y formato objetivo
  const [capabilities, setCapabilities] = useState<FormatCapabilityInfo[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<ConversionTargetFormat>('CHORD_PRO');

  // Opciones de conversión
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [keyOverride, setKeyOverride] = useState<string>('');
  const [bpmOverride, setBpmOverride] = useState<string>('');
  const [timeSignatureOverride, setTimeSignatureOverride] = useState<string>('');

  // Estado del proceso de conversión
  const [conversionStatus, setConversionStatus] = useState<
    'IDLE' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  >('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [exportResult, setExportResult] = useState<ConversionExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedToCatalog, setSavedToCatalog] = useState<boolean>(false);
  const [savingCatalog, setSavingCatalog] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Evaluar capacidades ante cambio de archivo
  useEffect(() => {
    if (!selectedFile) {
      setSourceCategory(null);
      setCapabilities([]);
      setExportResult(null);
      setConversionStatus('IDLE');
      setProgress(0);
      return;
    }

    const detected = FormatCapabilitiesEvaluator.detectSourceCategory(
      selectedFile.name,
      fileRawBytes || fileRawText || undefined
    );
    setSourceCategory(detected);

    const caps = FormatCapabilitiesEvaluator.getFormatCapabilities(detected);
    setCapabilities(caps);

    // Seleccionar automáticamente el primer formato disponible
    const firstAvailable = caps.find((c) => c.isAvailable);
    if (firstAvailable) {
      setSelectedTarget(firstAvailable.format);
    }
  }, [selectedFile, fileRawText, fileRawBytes]);

  // Manejo de carga de archivos
  const processUploadedFile = useCallback((file: File) => {
    setSelectedFile(file);
    setExportResult(null);
    setConversionStatus('IDLE');
    setProgress(0);
    setErrorMessage(null);
    setSavedToCatalog(false);

    const isBinaryFormat =
      file.name.endsWith('.mid') ||
      file.name.endsWith('.midi') ||
      file.name.endsWith('.pdf') ||
      file.name.endsWith('.mp3') ||
      file.name.endsWith('.wav');

    const reader = new FileReader();

    if (isBinaryFormat) {
      reader.onload = (e) => {
        const arrayBuf = e.target?.result as ArrayBuffer;
        if (arrayBuf) {
          const bytes = new Uint8Array(arrayBuf);
          setFileRawBytes(bytes);
          setFileRawText(null);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setFileRawText(text);
        setFileRawBytes(null);
      };
      reader.readAsText(file);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        processUploadedFile(droppedFile);
      }
    },
    [processUploadedFile]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processUploadedFile(file);
      }
    },
    [processUploadedFile]
  );

  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setFileRawText(null);
    setFileRawBytes(null);
    setSourceCategory(null);
    setCapabilities([]);
    setExportResult(null);
    setConversionStatus('IDLE');
    setProgress(0);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Ejecución de Conversión
  const handleStartConversion = useCallback(async () => {
    if (!selectedFile) return;

    setConversionStatus('PROCESSING');
    setProgress(15);
    setErrorMessage(null);

    const options: ConversionOptions = {
      targetFormat: selectedTarget,
      transposeSemitones: transposeSemitones !== 0 ? transposeSemitones : undefined,
      keyOverride: keyOverride.trim() || undefined,
      bpmOverride: bpmOverride ? parseInt(bpmOverride, 10) : undefined,
      timeSignatureOverride: timeSignatureOverride.trim() || undefined,
    };

    try {
      setProgress(40);
      let contentToConvert = fileRawText;
      if (!contentToConvert && fileRawBytes) {
        contentToConvert = new TextDecoder().decode(fileRawBytes);
      }

      if (!contentToConvert) {
        throw new Error('No se pudo leer el contenido del archivo.');
      }

      setProgress(70);

      // Usar ConversionEngine del cliente para respuesta instantánea de alta fidelidad
      const result = engineRef.current.convertSource(
        contentToConvert,
        selectedFile.name,
        options
      );

      setProgress(100);
      setExportResult(result);

      if (!result.success) {
        setConversionStatus('FAILED');
        setErrorMessage(
          result.diagnostics.find((d) => d.severity === 'ERROR')?.message ||
            'La conversión no pudo completarse.'
        );
      } else {
        const hasWarnings = result.diagnostics.some((d) => d.severity === 'WARNING');
        setConversionStatus(hasWarnings ? 'REVIEW_REQUIRED' : 'COMPLETED');
      }
    } catch (err: any) {
      setConversionStatus('FAILED');
      setErrorMessage(err.message || 'Error inesperado durante la conversión.');
    }
  }, [
    selectedFile,
    selectedTarget,
    transposeSemitones,
    keyOverride,
    bpmOverride,
    timeSignatureOverride,
    fileRawText,
    fileRawBytes,
  ]);

  // Descarga del archivo convertido
  const handleDownloadOutput = useCallback(() => {
    if (!exportResult || !exportResult.content) return;

    let blob: Blob;
    if (exportResult.content instanceof Uint8Array) {
      blob = new Blob([exportResult.content as any], { type: exportResult.mimeType });
    } else {
      blob = new Blob([exportResult.content], { type: exportResult.mimeType });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportResult.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [exportResult]);

  // Persistir en Catálogo de Canciones
  const handleSaveToCatalog = useCallback(async () => {
    if (!exportResult || !user) return;
    setSavingCatalog(true);

    try {
      const contentStr =
        typeof exportResult.content === 'string'
          ? exportResult.content
          : new TextDecoder().decode(exportResult.content);

      await client.importAndPersist(contentStr, exportResult.filename);
      setSavedToCatalog(true);
    } catch (err: any) {
      alert(`Error al guardar en el catálogo: ${err.message}`);
    } finally {
      setSavingCatalog(false);
    }
  }, [exportResult, user, client]);

  // Abrir en Atril Digital
  const handleOpenInStand = useCallback(() => {
    if (!exportResult?.canonicalPayload || !onOpenInMusicStand) return;
    const artist =
      typeof exportResult.canonicalPayload.metadata?.['artist'] === 'string'
        ? (exportResult.canonicalPayload.metadata['artist'] as string)
        : undefined;

    onOpenInMusicStand(exportResult.canonicalPayload, {
      title: exportResult.canonicalPayload.title,
      ...(artist ? { artist } : {}),
    });
    if (onClose) {
      onClose();
    }
  }, [exportResult, onOpenInMusicStand, onClose]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getBadgeClass = (status: FormatCapabilityInfo['statusBadge']): string => {
    switch (status) {
      case 'NATIVE':
        return 'badge-native';
      case 'CONVERTED':
        return 'badge-converted';
      case 'AI_DRAFT':
        return 'badge-draft';
      case 'BLOCKED_ZERO_FABRICATION':
        return 'badge-blocked';
      case 'DEFERRED_PHASE':
        return 'badge-deferred';
      default:
        return '';
    }
  };

  const getBadgeLabel = (status: FormatCapabilityInfo['statusBadge']): string => {
    switch (status) {
      case 'NATIVE':
        return 'NATIVO';
      case 'CONVERTED':
        return 'CONVERTIBLE';
      case 'AI_DRAFT':
        return 'BORRADOR IA';
      case 'BLOCKED_ZERO_FABRICATION':
        return 'BLOQUEADO (Cero Fabricación)';
      case 'DEFERRED_PHASE':
        return 'DIFERIDO (Fase 2B)';
      default:
        return status;
    }
  };

  return (
    <div className="conversion-center-workspace" role="region" aria-label="Centro de Conversión Musical">
      {/* Encabezado del Módulo */}
      <div className="conversion-header">
        <div className="header-title-row">
          <div className="title-icon">🔄</div>
          <div>
            <h2 className="title-text">Centro de Conversión Musical</h2>
            <p className="subtitle-text">
              Transforme partituras, archivos MIDI, cifrados ChordPro y letras con preservación matemática de la verdad musical.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn-close-conversion"
            onClick={onClose}
            aria-label="Volver al atril"
          >
            ✕ Volver al Atril
          </button>
        )}
      </div>

      <div className="conversion-grid-container">
        {/* COLUMNA IZQUIERDA: Carga, Detección y Opciones */}
        <div className="conversion-panel-left">
          {/* SECCIÓN A: Espacio de Carga y Gestión de Archivos */}
          <div className="conversion-card section-upload">
            <h3 className="section-title">
              <span className="step-num">A</span> Archivo Fuente Musical
            </h3>

            {!selectedFile ? (
              <div
                className={`dropzone ${isDragging ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Zona de arrastre de archivos musicales"
              >
                <div className="dropzone-icon">📁</div>
                <div className="dropzone-primary-text">
                  Arrastre su archivo musical aquí o <span className="highlight-browse">examine</span>
                </div>
                <div className="dropzone-secondary-text">
                  Formatos soportados: MusicXML (.musicxml, .xml), MIDI (.mid), ChordPro (.cho, .crd), PDF, Imagen, Audio
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileInputChange}
                  accept=".musicxml,.xml,.mxl,.mid,.midi,.cho,.chordpro,.crd,.pro,.pdf,.png,.jpg,.jpeg,.mp3,.wav,.m4a"
                />
              </div>
            ) : (
              <div className="selected-file-card">
                <div className="file-info-col">
                  <div className="file-name-row">
                    <span className="file-icon">📄</span>
                    <span className="file-name" title={selectedFile.name}>
                      {selectedFile.name}
                    </span>
                  </div>
                  <div className="file-meta-row">
                    <span>{formatFileSize(selectedFile.size)}</span>
                    <span className="separator">•</span>
                    <span>{selectedFile.type || 'Tipo desconocido'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-remove-file"
                  onClick={handleClearFile}
                  title="Quitar archivo"
                >
                  ✕ Quitar
                </button>
              </div>
            )}
          </div>

          {/* SECCIÓN B: Detección Automática y Capacidades */}
          {selectedFile && (
            <div className="conversion-card section-capabilities">
              <h3 className="section-title">
                <span className="step-num">B</span> Detección de Origen y Capacidades
              </h3>

              <div className="source-detection-badge-row">
                <span className="detection-label">Formato Detectado:</span>
                <span className="source-category-tag">
                  {sourceCategory === 'STRUCTURED_MUSICXML' && '🎼 MusicXML 4.0'}
                  {sourceCategory === 'STRUCTURED_MIDI' && '🎹 MIDI Estándar (SMF 1)'}
                  {sourceCategory === 'STRUCTURED_CHORDPRO' && '🎸 ChordPro (Cifrado con Letra)'}
                  {sourceCategory === 'PDF_SCORE' && '📄 Partitura en PDF'}
                  {sourceCategory === 'IMAGE_SCORE' && '🖼️ Partitura en Imagen'}
                  {sourceCategory === 'AUDIO_RECORDING' && '🎙️ Grabación de Audio'}
                  {sourceCategory === 'VIDEO_REFERENCE' && '🎥 Video de Referencia'}
                  {sourceCategory === 'WRITTEN_NOTES' && '📝 Notas Escritas / JSON'}
                </span>
              </div>

              <div className="capabilities-matrix-list">
                {capabilities.map((cap) => (
                  <div key={cap.format} className="capability-row">
                    <span className="cap-format-name">{cap.label}</span>
                    <span className={`cap-badge ${getBadgeClass(cap.statusBadge)}`}>
                      {getBadgeLabel(cap.statusBadge)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECCIÓN C: Selector de Formato Objetivo */}
          {selectedFile && (
            <div className="conversion-card section-targets">
              <h3 className="section-title">
                <span className="step-num">C</span> Formato Objetivo
              </h3>

              <div className="target-formats-grid">
                {capabilities.map((cap) => {
                  const isBlocked = !cap.isAvailable;
                  const isSelected = selectedTarget === cap.format;

                  return (
                    <div
                      key={cap.format}
                      className={`target-format-card ${isSelected ? 'selected' : ''} ${
                        isBlocked ? 'disabled' : ''
                      }`}
                      onClick={() => {
                        if (!isBlocked) {
                          setSelectedTarget(cap.format);
                        }
                      }}
                      role="radio"
                      aria-checked={isSelected}
                      aria-disabled={isBlocked}
                    >
                      <div className="target-card-header">
                        <span className="target-card-label">{cap.label}</span>
                        <span className={`cap-badge ${getBadgeClass(cap.statusBadge)}`}>
                          {getBadgeLabel(cap.statusBadge)}
                        </span>
                      </div>
                      <p className="target-card-desc">{cap.description}</p>
                      {isBlocked && cap.blockingReason && (
                        <div className="blocking-reason-box">⚠️ {cap.blockingReason}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECCIÓN D: Opciones de Conversión */}
          {selectedFile && (
            <div className="conversion-card section-options">
              <h3 className="section-title">
                <span className="step-num">D</span> Opciones de Conversión
              </h3>

              <div className="options-form-grid">
                <div className="option-field">
                  <label htmlFor="transposition-select" className="option-label">
                    Transposición Armónica:
                  </label>
                  <div className="transposition-control-group">
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => setTransposeSemitones((prev) => Math.max(-11, prev - 1))}
                    >
                      -1
                    </button>
                    <span className="transposition-display">
                      {transposeSemitones > 0 ? `+${transposeSemitones}` : transposeSemitones} semitonos
                    </span>
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => setTransposeSemitones((prev) => Math.min(11, prev + 1))}
                    >
                      +1
                    </button>
                    {transposeSemitones !== 0 && (
                      <button
                        type="button"
                        className="btn-reset-stepper"
                        onClick={() => setTransposeSemitones(0)}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div className="option-field">
                  <label htmlFor="key-override-input" className="option-label">
                    Sobrescribir Tonalidad (Opcional):
                  </label>
                  <input
                    id="key-override-input"
                    type="text"
                    className="option-input"
                    placeholder="Ej. G, Em, Bb, F#"
                    value={keyOverride}
                    onChange={(e) => setKeyOverride(e.target.value)}
                  />
                </div>

                <div className="option-field">
                  <label htmlFor="bpm-override-input" className="option-label">
                    Sobrescribir Tempo (BPM):
                  </label>
                  <input
                    id="bpm-override-input"
                    type="number"
                    className="option-input"
                    placeholder="Ej. 120"
                    min="30"
                    max="300"
                    value={bpmOverride}
                    onChange={(e) => setBpmOverride(e.target.value)}
                  />
                </div>

                <div className="option-field">
                  <label htmlFor="time-sig-input" className="option-label">
                    Sobrescribir Métrica:
                  </label>
                  <input
                    id="time-sig-input"
                    type="text"
                    className="option-input"
                    placeholder="Ej. 4/4, 6/8"
                    value={timeSignatureOverride}
                    onChange={(e) => setTimeSignatureOverride(e.target.value)}
                  />
                </div>
              </div>

              {/* Botón de Iniciar Conversión */}
              <button
                type="button"
                className="btn-execute-conversion"
                onClick={handleStartConversion}
                disabled={conversionStatus === 'PROCESSING'}
              >
                {conversionStatus === 'PROCESSING' ? '⚙️ Procesando...' : '🚀 Convertir Archivo'}
              </button>
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: Progreso, Revisión Humana y Exportación */}
        <div className="conversion-panel-right">
          {/* SECCIÓN E: Cola de Procesamiento y Progreso */}
          {conversionStatus !== 'IDLE' && (
            <div className="conversion-card section-queue">
              <h3 className="section-title">
                <span className="step-num">E</span> Estado de Procesamiento
              </h3>

              <div className="status-header-row">
                <span className="status-label">Estado:</span>
                <span className={`status-pill status-${conversionStatus.toLowerCase()}`}>
                  {conversionStatus === 'PROCESSING' && '⏳ PROCESANDO'}
                  {conversionStatus === 'COMPLETED' && '✅ COMPLETADO'}
                  {conversionStatus === 'REVIEW_REQUIRED' && '⚠️ REVISIÓN REQUERIDA'}
                  {conversionStatus === 'FAILED' && '❌ FALLIDO'}
                </span>
              </div>

              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progress}%` }}
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>

              {errorMessage && <div className="conversion-error-alert">{errorMessage}</div>}
            </div>
          )}

          {/* SECCIÓN F: Revisión Humana (Human-in-the-Loop) */}
          {exportResult && (
            <div className="conversion-card section-review">
              <h3 className="section-title">
                <span className="step-num">F</span> Revisión y Diagnósticos
              </h3>

              {/* Badges de Estado de Revisión */}
              <div className="review-badges-row">
                {conversionStatus === 'REVIEW_REQUIRED' && (
                  <div className="human-review-warning">
                    ⚠️ <strong>Borrador de Conversión:</strong> Requiere validación humana. Revise los diagnósticos a continuación.
                  </div>
                )}
                {conversionStatus === 'COMPLETED' && (
                  <div className="human-review-success">
                    ✨ Conversión fidedigna completada con verificación de verdad musical.
                  </div>
                )}
              </div>

              {/* Diagnósticos */}
              {exportResult.diagnostics.length > 0 && (
                <div className="diagnostics-panel-box">
                  <div className="diag-header">Diagnósticos de Transpilación ({exportResult.diagnostics.length}):</div>
                  <ul className="diag-list">
                    {exportResult.diagnostics.map((d, idx) => (
                      <li key={idx} className={`diag-item diag-${d.severity.toLowerCase()}`}>
                        <span className="diag-severity">[{d.severity}]</span>
                        <span className="diag-code">{d.code}:</span>
                        <span className="diag-msg">{d.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Vista Previa del Archivo Generado */}
              <div className="output-preview-container">
                <div className="preview-header">
                  <span>Vista Previa: {exportResult.filename}</span>
                  <span className="preview-mime">({exportResult.mimeType})</span>
                </div>

                {typeof exportResult.content === 'string' ? (
                  <pre className="output-preview-code">
                    <code>{exportResult.content.slice(0, 3000)}</code>
                    {exportResult.content.length > 3000 && (
                      <div className="preview-truncated-notice">
                        ... ({exportResult.content.length - 3000} caracteres adicionales omitidos en vista previa)
                      </div>
                    )}
                  </pre>
                ) : (
                  <div className="binary-preview-box">
                    <div className="binary-icon">🎹</div>
                    <div className="binary-title">Archivo MIDI Estándar Generado</div>
                    <div className="binary-stats">
                      Tamaño: {formatFileSize(exportResult.content.length)} • Formato 1 • 480 TPQN
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECCIÓN G: Exportación y Atril Digital */}
          {exportResult && exportResult.success && (
            <div className="conversion-card section-actions">
              <h3 className="section-title">
                <span className="step-num">G</span> Acciones de Exportación
              </h3>

              <div className="actions-button-grid">
                {/* 1. Descargar Archivo */}
                <button
                  type="button"
                  className="btn-action btn-download"
                  onClick={handleDownloadOutput}
                >
                  ⬇️ Descargar Archivo ({exportResult.filename})
                </button>

                {/* 2. Guardar en Catálogo */}
                <button
                  type="button"
                  className="btn-action btn-catalog"
                  onClick={handleSaveToCatalog}
                  disabled={savingCatalog || savedToCatalog || !user}
                >
                  {savedToCatalog
                    ? '✅ Guardado en Catálogo'
                    : savingCatalog
                    ? 'Guardando...'
                    : '💾 Guardar en Catálogo de Canciones'}
                </button>

                {/* 3. Abrir en Atril Digital */}
                {exportResult.canonicalPayload && onOpenInMusicStand && (
                  <button
                    type="button"
                    className="btn-action btn-music-stand"
                    onClick={handleOpenInStand}
                  >
                    🎵 Abrir en Atril Digital
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
