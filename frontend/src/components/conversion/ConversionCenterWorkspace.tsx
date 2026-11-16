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
import {
  BethesdaApiClient,
  type AudioConversionWorkflowStateDTO,
  type AudioDraftProposalDTO,
  type GeneratedTargetArtifactDTO,
} from '../../core/api/api-client.ts';
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
  type CapabilityState,
  type SourceCapabilitySummary,
} from '../../core/conversion/index.ts';
import { CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';

export interface ConversionCenterWorkspaceProps {
  readonly onOpenInMusicStand?: (
    payload: CanonicalMusicPayload,
    meta?: { title: string; artist?: string }
  ) => void;
  readonly onOpenPersistedSongInStand?: (
    songId: string,
    options?: { audioId?: string; versionId?: string }
  ) => Promise<void> | void;
  readonly onClose?: () => void;
  readonly apiClient?: BethesdaApiClient;
}

const CREATE_NEW_SONG_OPTION = '__CREATE_NEW_SONG__';

export const ConversionCenterWorkspace: React.FC<ConversionCenterWorkspaceProps> = ({
  onOpenInMusicStand,
  onOpenPersistedSongInStand,
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [exportResult, setExportResult] = useState<ConversionExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedToCatalog, setSavedToCatalog] = useState<boolean>(false);
  const [savingCatalog, setSavingCatalog] = useState<boolean>(false);

  // Estado de Preservación, Análisis Python (WS-AUDIO-02), Transcripción (WS-AUDIO-03) y Revisión Humana (Gate 4)
  const [songList, setSongList] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>(CREATE_NEW_SONG_OPTION);
  const [isPreservingAudio, setIsPreservingAudio] = useState<boolean>(false);
  const [audioPreservationSuccess, setAudioPreservationSuccess] = useState<{
    audioId: string;
    songId: string;
    checksumSha256: string;
    filename: string;
    songTitle?: string | undefined;
  } | null>(null);

  const [audioWorkflowState, setAudioWorkflowState] = useState<AudioConversionWorkflowStateDTO | 'IDLE'>('IDLE');
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState<boolean>(false);
  const [activeAudioDraft, setActiveAudioDraft] = useState<AudioDraftProposalDTO | null>(null);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [reviewTitle, setReviewTitle] = useState<string>('');
  const [reviewKey, setReviewKey] = useState<string>('');
  const [reviewBpm, setReviewBpm] = useState<string>('');
  const [reviewTimeSig, setReviewTimeSig] = useState<string>('');
  const [reviewInstrument, setReviewInstrument] = useState<'GUITAR' | 'BASS' | 'PIANO' | 'VOCAL'>('GUITAR');
  const [reviewVerifiedLyrics, setReviewVerifiedLyrics] = useState<string>('');
  const [reviewChordPro, setReviewChordPro] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [previewTargetFormat, setPreviewTargetFormat] = useState<
    'CHORD_PRO' | 'MUSIC_XML' | 'MIDI' | 'TABLATURE' | 'LYRICS_ONLY'
  >('CHORD_PRO');
  const [isSavingDraftEdits, setIsSavingDraftEdits] = useState<boolean>(false);
  const [isSubmittingReviewDecision, setIsSubmittingReviewDecision] = useState<boolean>(false);
  const [reviewActionFeedback, setReviewActionFeedback] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const normalizeTitleForMatch = (raw: string): string =>
    raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // Cargar lista de canciones para vincular audio si el usuario está autenticado
  useEffect(() => {
    if (sourceCategory === 'AUDIO_RECORDING' && user) {
      client
        .listSongs({ limit: 50 })
        .then((res) => {
          if (res && res.items) {
            const mapped = res.items.map((s) => ({ id: s.id, title: s.title }));
            setSongList(mapped);
            const fileBase = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').trim() : '';
            const normalizedFile = normalizeTitleForMatch(fileBase);
            const exactMatch = normalizedFile
              ? mapped.find((s) => normalizeTitleForMatch(s.title) === normalizedFile)
              : undefined;
            if (exactMatch) {
              setSelectedSongId(exactMatch.id);
            } else {
              // Evitar asociar silenciosamente el audio a una canción no relacionada (Sección 2 y 3.D)
              setSelectedSongId(CREATE_NEW_SONG_OPTION);
            }
          }
        })
        .catch((e) => console.warn('No se pudo cargar la lista de canciones para preservación de audio:', e));
    }
  }, [sourceCategory, user, client, selectedFile]);

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
      file.name.endsWith('.png') ||
      file.name.endsWith('.jpg') ||
      file.name.endsWith('.jpeg') ||
      file.name.endsWith('.webp') ||
      file.name.endsWith('.tiff') ||
      file.name.endsWith('.mp3') ||
      file.name.endsWith('.wav') ||
      file.name.endsWith('.m4a') ||
      file.name.endsWith('.ogg') ||
      file.name.endsWith('.flac');

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
    setActiveJobId(null);
    setProgress(0);
    setErrorMessage(null);
    setAudioPreservationSuccess(null);
    setAudioWorkflowState('IDLE');
    setActiveAudioDraft(null);
    setAudioPlaybackUrl(null);
    setReviewActionFeedback(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
      chunks.push(String.fromCharCode(...slice));
    }
    return window.btoa(chunks.join(''));
  };

  const inferAudioMimeTypeFromFilename = (filename: string, rawType?: string): string => {
    const cleaned = (rawType ?? '').toLowerCase().split(';')[0]!.trim();
    if (cleaned && cleaned !== 'application/octet-stream' && cleaned !== 'binary/octet-stream') {
      return cleaned;
    }
    const lower = filename.toLowerCase().trim();
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.flac')) return 'audio/flac';
    if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    return 'audio/mpeg';
  };

  const populateReviewFormFromDraft = useCallback(
    async (draft: AudioDraftProposalDTO) => {
      setActiveAudioDraft(draft);
      setAudioWorkflowState(draft.workflowState);
      setReviewTitle(draft.title || '');
      setReviewKey(draft.detectedKey || '');
      setReviewBpm(draft.detectedBpm ? String(draft.detectedBpm) : '');
      setReviewTimeSig(draft.detectedTimeSignature || '');
      setReviewInstrument(draft.selectedInstrument || 'GUITAR');
      setReviewVerifiedLyrics(draft.verifiedLyrics || '');
      setReviewChordPro(draft.proposedChordPro || '');
      try {
        const streamUrl = await client.getAudioPlaybackStreamUrl(draft.audioAssetId);
        setAudioPlaybackUrl(streamUrl);
      } catch {
        setAudioPlaybackUrl(null);
      }
    },
    [client]
  );

  const ensureTargetSongForAudio = async (
    defaultTitle: string
  ): Promise<{ id: string; title: string }> => {
    if (selectedSongId && selectedSongId !== CREATE_NEW_SONG_OPTION) {
      const existing = songList.find((s) => s.id === selectedSongId);
      if (existing) {
        return existing;
      }
    }
    const created = await client.createAudioDraftSong({ title: defaultTitle });
    const newEntry = { id: created.song.id, title: created.song.title };
    setSongList((prev) => [newEntry, ...prev.filter((s) => s.id !== newEntry.id)]);
    setSelectedSongId(newEntry.id);
    return newEntry;
  };

  const handlePreserveAudio = async (): Promise<{
    audioId: string;
    songId: string;
    checksumSha256: string;
    filename: string;
    songTitle: string;
  } | null> => {
    if (!selectedFile || !fileRawBytes) {
      setErrorMessage('Seleccione un archivo de audio válido antes de preservar.');
      return null;
    }
    if (!user) {
      setErrorMessage('Su sesión ha expirado o no ha iniciado sesión. Inicie sesión nuevamente para preservar audio.');
      return null;
    }
    setIsPreservingAudio(true);
    setErrorMessage(null);
    setReviewActionFeedback(null);
    try {
      const normalizedTitle = selectedFile.name.replace(/\.[^/.]+$/, '').trim() || selectedFile.name;
      const targetSong = await ensureTargetSongForAudio(normalizedTitle);
      const b64 = uint8ArrayToBase64(fileRawBytes);
      const resolvedMimeType = inferAudioMimeTypeFromFilename(selectedFile.name, selectedFile.type);
      const res = await client.uploadSongAudio({
        songId: targetSong.id,
        title: normalizedTitle,
        filename: selectedFile.name,
        mimeType: resolvedMimeType,
        dataBase64: b64,
      });
      const preservedInfo = {
        audioId: res.id,
        songId: targetSong.id,
        checksumSha256: res.checksumSha256,
        filename: res.filename,
        songTitle: targetSong.title,
      };
      setAudioPreservationSuccess(preservedInfo);
      setAudioWorkflowState('AUDIO_PRESERVED');
      return preservedInfo;
    } catch (err: any) {
      setAudioWorkflowState('FAILED');
      setErrorMessage(err?.message || 'Error al preservar el activo de audio.');
      return null;
    } finally {
      setIsPreservingAudio(false);
    }
  };

  const handleAnalyzeAndTranscribeAudio = async () => {
    if (!user) {
      setErrorMessage('Inicie sesión para ejecutar el análisis acústico y la transcripción musical.');
      return;
    }
    setErrorMessage(null);
    setReviewActionFeedback(null);

    let preserved = audioPreservationSuccess;
    if (!preserved) {
      preserved = await handlePreserveAudio();
      if (!preserved) return;
    }

    setIsAnalyzingAudio(true);
    setAudioWorkflowState('ANALYSIS_RUNNING');
    try {
      const parsedBpm = bpmOverride ? parseInt(bpmOverride, 10) : undefined;
      const draft = await client.analyzeAndTranscribeAudio(preserved.audioId, {
        ...(keyOverride.trim() ? { keyOverride: keyOverride.trim() } : {}),
        ...(parsedBpm && !isNaN(parsedBpm) ? { bpmOverride: parsedBpm } : {}),
        ...(timeSignatureOverride.trim() ? { timeSignatureOverride: timeSignatureOverride.trim() } : {}),
        ...(reviewVerifiedLyrics.trim() ? { verifiedLyrics: reviewVerifiedLyrics.trim() } : {}),
        selectedInstrument: reviewInstrument,
      });
      await populateReviewFormFromDraft(draft);
      setReviewActionFeedback(
        `Análisis Python (WS-AUDIO-02) y generación de borradores (WS-AUDIO-03) completados. Estado: ${draft.workflowState}. Revise y apruebe abajo.`
      );
    } catch (err: any) {
      setAudioWorkflowState('FAILED');
      setErrorMessage(err?.message || 'Error durante el análisis acústico o transcripción.');
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  const handleSaveAudioDraftEdits = async () => {
    if (!activeAudioDraft) return;
    setIsSavingDraftEdits(true);
    setErrorMessage(null);
    setReviewActionFeedback(null);
    try {
      const parsedBpm = reviewBpm.trim() ? parseInt(reviewBpm.trim(), 10) : undefined;
      const updated = await client.updateAudioDraft(
        activeAudioDraft.audioAssetId,
        activeAudioDraft.proposalId,
        {
          title: reviewTitle.trim() || activeAudioDraft.title,
          key: reviewKey.trim(),
          ...(parsedBpm && !isNaN(parsedBpm) ? { bpm: parsedBpm } : {}),
          timeSignature: reviewTimeSig.trim(),
          proposedChordPro: reviewChordPro,
          verifiedLyrics: reviewVerifiedLyrics,
          selectedInstrument: reviewInstrument,
          reason: reviewNotes.trim() || 'Ajustes manuales durante Revisión Humana.',
        }
      );
      await populateReviewFormFromDraft(updated);
      setReviewActionFeedback('✅ Cambios guardados en el borrador y vistas previas recalculadas.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudieron guardar las ediciones del borrador.');
    } finally {
      setIsSavingDraftEdits(false);
    }
  };

  const handleReviewDecision = async (
    decision: 'REJECTED' | 'CORRECTION_REQUESTED' | 'APPROVED_FOR_IMPORT'
  ) => {
    if (!activeAudioDraft) return;
    setIsSubmittingReviewDecision(true);
    setErrorMessage(null);
    setReviewActionFeedback(null);
    try {
      const updated = await client.reviewAudioDraft(
        activeAudioDraft.audioAssetId,
        activeAudioDraft.proposalId,
        {
          decision,
          ...(reviewNotes.trim() ? { notes: reviewNotes.trim() } : {}),
        }
      );
      await populateReviewFormFromDraft(updated);
      if (decision === 'REJECTED') {
        setReviewActionFeedback(
          '🛑 Borrador rechazado. La canción canónica y sus versiones existentes permanecen intactas sin modificación.'
        );
      } else if (decision === 'CORRECTION_REQUESTED') {
        setReviewActionFeedback('⚠️ Se registró la solicitud de corrección en el historial de auditoría.');
      } else {
        setReviewActionFeedback('✅ Borrador marcado como validado por revisor humano.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al registrar la decisión de revisión.');
    } finally {
      setIsSubmittingReviewDecision(false);
    }
  };

  const handleApproveAndPublishAudioDraft = async () => {
    if (!activeAudioDraft) return;
    setIsSubmittingReviewDecision(true);
    setErrorMessage(null);
    setReviewActionFeedback(null);
    try {
      const res = await client.approveAndPublishAudioDraft(
        activeAudioDraft.audioAssetId,
        activeAudioDraft.proposalId,
        {
          targetSongId: activeAudioDraft.songId,
          setAsCurrent: true,
          reviewNotes: reviewNotes.trim() || 'Aprobado tras revisión humana para Atril Digital.',
        }
      );
      await populateReviewFormFromDraft(res.draft);
      setReviewActionFeedback(
        `🎉 Versión canónica v${res.versionNumber} creada y aprobada para "${res.draft.songTitle}". Las versiones anteriores se conservaron en el historial.`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudo aprobar y publicar el borrador.');
    } finally {
      setIsSubmittingReviewDecision(false);
    }
  };

  const handleDownloadAudioDraftFormat = (artifact: GeneratedTargetArtifactDTO) => {
    if (!artifact.generatable || !artifact.content) return;
    let blob: Blob;
    if (artifact.isBinary) {
      const binStr = window.atob(artifact.content);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      blob = new Blob([bytes.buffer as ArrayBuffer], { type: artifact.mimeType });
    } else {
      blob = new Blob([artifact.content], { type: `${artifact.mimeType};charset=utf-8` });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenPreservedSongInStand = async () => {
    const targetSongId =
      activeAudioDraft?.songId ||
      audioPreservationSuccess?.songId ||
      (selectedSongId !== CREATE_NEW_SONG_OPTION ? selectedSongId : '');
    if (!targetSongId) return;

    if (onOpenPersistedSongInStand) {
      const resolvedAudioId = activeAudioDraft?.audioAssetId ?? audioPreservationSuccess?.audioId;
      const resolvedVersionId = activeAudioDraft?.approvalMetadata?.approvedSongVersionId;
      await onOpenPersistedSongInStand(targetSongId, {
        ...(resolvedAudioId ? { audioId: resolvedAudioId } : {}),
        ...(resolvedVersionId ? { versionId: resolvedVersionId } : {}),
      });
      return;
    }

    if (activeAudioDraft?.proposedCanonicalPayload && onOpenInMusicStand) {
      const payload = CanonicalMusicPayload.fromJSON(activeAudioDraft.proposedCanonicalPayload);
      onOpenInMusicStand(payload, { title: payload.title });
      if (onClose) onClose();
    }
  };

  // Polling autoritativo del progreso del trabajo en el backend (CR-01)
  useEffect(() => {
    if (!activeJobId || conversionStatus !== 'PROCESSING') {
      return;
    }

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const job = await client.getConversionJob(activeJobId);
        if (!isMounted) return;

        setProgress(job.progress || 20);

        if (job.status === 'COMPLETED' || job.status === 'REVIEW_REQUIRED') {
          clearInterval(interval);
          setConversionStatus(job.status);
          setProgress(100);

          const details = job.errorDetails as any;
          if (details) {
            let canonicalPayload: CanonicalMusicPayload | undefined;
            if (details.canonicalPayload) {
              try {
                canonicalPayload = CanonicalMusicPayload.fromJSON(details.canonicalPayload);
              } catch (e) {
                console.warn('No se pudo hidratar canonicalPayload:', e);
              }
            }

            let content: string | Uint8Array = details.data ?? '';
            if (details.isBinary && typeof details.data === 'string') {
              const binStr = window.atob(details.data);
              const bytes = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) {
                bytes[i] = binStr.charCodeAt(i);
              }
              content = bytes;
            }

            setExportResult({
              success: true,
              targetFormat: details.targetFormat || selectedTarget,
              filename: job.outputRef || selectedFile?.name || 'conversion_output',
              mimeType: details.mimeType || 'text/plain',
              content,
              diagnostics: details.diagnostics || [],
              canonicalPayload,
            });
          }
        } else if (job.status === 'FAILED') {
          clearInterval(interval);
          setConversionStatus('FAILED');
          const details = job.errorDetails as any;
          setErrorMessage(
            details?.diagnostics?.find((d: any) => d.severity === 'ERROR')?.message ||
              (job as any).errorCode ||
              'La conversión en segundo plano ha fallado.'
          );
        } else if (job.status === 'CANCELLED') {
          clearInterval(interval);
          setConversionStatus('CANCELLED');
        }
      } catch (err: any) {
        console.warn('Error en sondeo de trabajo:', err.message);
      }
    }, 700);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeJobId, conversionStatus, client, selectedTarget, selectedFile]);

  // Ejecución de Conversión
  const handleStartConversion = useCallback(async () => {
    if (!selectedFile) return;

    // Guard: Validación estricta antes de iniciar procesamiento
    const canConvertNow = capabilities.some((c) => c.isAvailable);
    const targetCap = capabilities.find((c) => c.format === selectedTarget);
    if (!canConvertNow || !targetCap || !targetCap.isAvailable) {
      setConversionStatus('FAILED');
      const err =
        targetCap?.blockingReason ||
        'La conversión no está disponible para este tipo de archivo en la versión actual (planificado para la Fase 2B).';
      setErrorMessage(err);
      return;
    }

    setConversionStatus('PROCESSING');
    setProgress(10);
    setErrorMessage(null);
    setSavedToCatalog(false);

    const options: ConversionOptions = {
      targetFormat: selectedTarget,
      transposeSemitones: transposeSemitones !== 0 ? transposeSemitones : undefined,
      keyOverride: keyOverride.trim() || undefined,
      bpmOverride: bpmOverride ? parseInt(bpmOverride, 10) : undefined,
      timeSignatureOverride: timeSignatureOverride.trim() || undefined,
    };

    // Si el usuario está autenticado, usar el backend autoritativo con cola persistente (CR-01)
    if (user) {
      try {
        let rawText: string | undefined = fileRawText ?? undefined;
        let dataBase64: string | undefined;

        if (!rawText && fileRawBytes) {
          dataBase64 = uint8ArrayToBase64(fileRawBytes);
        }

        const apiOptions: {
          transposeSemitones?: number;
          keyOverride?: string;
          bpmOverride?: number;
          timeSignatureOverride?: string;
        } = {};
        if (options.transposeSemitones !== undefined) apiOptions.transposeSemitones = options.transposeSemitones;
        if (options.keyOverride !== undefined) apiOptions.keyOverride = options.keyOverride;
        if (options.bpmOverride !== undefined) apiOptions.bpmOverride = options.bpmOverride;
        if (options.timeSignatureOverride !== undefined) apiOptions.timeSignatureOverride = options.timeSignatureOverride;

        const jobPayload: {
          filename: string;
          targetFormat: string;
          rawText?: string;
          dataBase64?: string;
          options?: {
            transposeSemitones?: number;
            keyOverride?: string;
            bpmOverride?: number;
            timeSignatureOverride?: string;
          };
        } = {
          filename: selectedFile.name,
          targetFormat: selectedTarget,
          options: apiOptions,
        };
        if (rawText !== undefined) jobPayload.rawText = rawText;
        if (dataBase64 !== undefined) jobPayload.dataBase64 = dataBase64;

        const job = await client.createConversionJob(jobPayload);

        setActiveJobId(job.id);
        setProgress(job.progress || 15);
      } catch (err: any) {
        setConversionStatus('FAILED');
        setErrorMessage(err.message || 'Error al iniciar trabajo de conversión en el servidor.');
      }
      return;
    }

    // Modo sin conexión o invitado: Transpilación local instantánea
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
    user,
    client,
    capabilities,
  ]);

  const handleCancelJob = useCallback(async () => {
    if (!activeJobId) {
      setConversionStatus('CANCELLED');
      return;
    }
    try {
      await client.cancelConversionJob(activeJobId);
      setConversionStatus('CANCELLED');
    } catch (err: any) {
      alert(`Error al cancelar: ${err.message}`);
    }
  }, [activeJobId, client]);

  const handleRetryJob = useCallback(async () => {
    if (!activeJobId) {
      handleStartConversion();
      return;
    }
    try {
      setConversionStatus('PROCESSING');
      setProgress(15);
      setErrorMessage(null);
      await client.retryConversionJob(activeJobId);
    } catch (err: any) {
      setConversionStatus('FAILED');
      setErrorMessage(err.message || 'Error al solicitar reintento.');
    }
  }, [activeJobId, client, handleStartConversion]);

  // Descarga del archivo convertido
  const handleDownloadOutput = useCallback(async () => {
    if (activeJobId && (conversionStatus === 'COMPLETED' || conversionStatus === 'REVIEW_REQUIRED')) {
      try {
        const { blob, filename } = await client.downloadConversionOutput(activeJobId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      } catch (e) {
        console.warn('Descarga por API falló, usando buffer local:', e);
      }
    }

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
  }, [activeJobId, conversionStatus, exportResult, client]);

  // Persistir en Catálogo de Canciones
  const handleSaveToCatalog = useCallback(async () => {
    if (!exportResult || !user) return;
    setSavingCatalog(true);

    try {
      if (activeJobId) {
        await client.commitConversionJobToCatalog(activeJobId);
      } else {
        const contentStr =
          typeof exportResult.content === 'string'
            ? exportResult.content
            : new TextDecoder().decode(exportResult.content);
        await client.importAndPersist(contentStr, exportResult.filename);
      }
      setSavedToCatalog(true);
    } catch (err: any) {
      alert(`Error al guardar en el catálogo: ${err.message}`);
    } finally {
      setSavingCatalog(false);
    }
  }, [activeJobId, exportResult, user, client]);

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

  const sourceSummary = sourceCategory
    ? FormatCapabilitiesEvaluator.getSourceCapabilitySummary(sourceCategory, selectedFile?.name)
    : null;
  const canConvert = capabilities.some((c) => c.isAvailable);
  const currentTargetCap = capabilities.find((c) => c.format === selectedTarget);
  const isTargetAvailable = Boolean(currentTargetCap?.isAvailable);

  const isPermanentFailure =
    Boolean(errorMessage) &&
    (errorMessage!.includes('SOURCE_CATEGORY_DEFERRED_PHASE') ||
      errorMessage!.includes('BLOCKED_ZERO_FABRICATION') ||
      errorMessage!.includes('CERO Fabricación') ||
      errorMessage!.includes('CERO-FABRICACIÓN') ||
      errorMessage!.includes('DEFERRED_PHASE') ||
      errorMessage!.includes('Fase 2B') ||
      errorMessage!.includes('TABLATURE_INGESTION_UNSUPPORTED') ||
      errorMessage!.includes('no admite conversión') ||
      errorMessage!.includes('no es compatible') ||
      errorMessage!.includes('requiere transcripción'));

  const getCapabilityStateBadgeClass = (state: CapabilityState): string => {
    switch (state) {
      case 'SUPPORTED':
        return 'badge-state-supported';
      case 'PARTIALLY_SUPPORTED':
        return 'badge-state-partially-supported';
      case 'NOT_SUPPORTED':
        return 'badge-state-not-supported';
      case 'PLANNED_PHASE_2B':
        return 'badge-state-planned-phase-2b';
      default:
        return '';
    }
  };

  const getCapabilityStateBadgeLabel = (state: CapabilityState): string => {
    switch (state) {
      case 'SUPPORTED':
        return 'SOPORTADO';
      case 'PARTIALLY_SUPPORTED':
        return 'PARCIAL';
      case 'NOT_SUPPORTED':
        return 'NO SOPORTADO';
      case 'PLANNED_PHASE_2B':
        return 'PLANIFICADO FASE 2B';
      default:
        return state;
    }
  };

  const formatHumanFriendlyError = (
    rawError: string | null
  ): { title: string; explanation: string; technical?: string } => {
    if (!rawError) {
      return {
        title: 'Error en la conversión',
        explanation: 'Ocurrió un error inesperado durante el procesamiento.',
      };
    }

    if (
      rawError.includes('SOURCE_CATEGORY_DEFERRED_PHASE') ||
      rawError.includes('requiere transcripción o digitalización óptica diferida')
    ) {
      return {
        title: 'Conversión Planificada para la Fase 2B',
        explanation:
          'La transcripción automática de audio a partitura y el reconocimiento óptico (OMR) están planificados para la Fase 2B mediante modelos locales de alta fidelidad sin servicios comerciales de terceros. Su archivo original ha sido preservado íntegramente en el sistema.',
        technical: rawError,
      };
    }

    if (
      rawError.includes('BLOCKED_ZERO_FABRICATION') ||
      rawError.includes('CERO Fabricación') ||
      rawError.includes('CERO-FABRICACIÓN') ||
      rawError.includes('sin notas')
    ) {
      return {
        title: 'Conversión Bloqueada por Cero Fabricación',
        explanation:
          'Bethesda Worship Studio opera bajo el principio de fidelidad estricta y CERO invención de notas. El archivo fuente no contiene notas melódicas, por lo que no es posible generar un archivo MIDI sin inventar notas.',
        technical: rawError,
      };
    }

    if (rawError.includes('ENGRAVED_PDF_DEFERRED_PHASE')) {
      return {
        title: 'Grabado de PDF en Servidor Planificado para Fase 2B',
        explanation:
          'El grabado vectorial directo a PDF en servidor mediante Bravura está planificado para la Fase 2B. Puede exportar a MusicXML para abrir e imprimir en software de notación profesional.',
        technical: rawError,
      };
    }

    if (
      rawError.includes('TABLATURE_INGESTION_UNSUPPORTED') ||
      rawError.includes('tablatura')
    ) {
      return {
        title: 'Tablatura ASCII No Soportada Directamente',
        explanation:
          'La ingesta y conversión directa de tablaturas en texto (.tab) está planificada para la Fase 2B. El atril permite visualizar digitaciones a partir de partituras canónicas.',
        technical: rawError,
      };
    }

    if (rawError.includes('QUEUE_UNAVAILABLE')) {
      return {
        title: 'Servicio de Cola No Disponible',
        explanation:
          'El gestor de tareas en segundo plano no se encuentra accesible en este momento. Por favor verifique la conexión del servidor o reintente en unos instantes.',
        technical: rawError,
      };
    }

    return {
      title: 'Error de Procesamiento',
      explanation: rawError,
    };
  };

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

      {/* Barra de Estado del Sistema y Compatibilidad */}
      <div className="conversion-health-bar">
        <div className="health-indicators-group">
          <div className="health-item">
            <span className="health-dot dot-online" />
            <span className="health-item-label">Servidor API:</span>
            <span className="health-item-val">En línea</span>
          </div>
          <div className="health-item">
            <span className="health-dot dot-online" />
            <span className="health-item-label">Motor de Cola:</span>
            <span className="health-item-val">{user ? 'pg-boss Activo' : 'Transpilador Local'}</span>
          </div>
        </div>
        <div className="health-item">
          <span className="health-item-label">Compatibilidad:</span>
          <span className="health-item-val">
            {!selectedFile
              ? '⚪ Esperando archivo...'
              : sourceSummary?.state === 'SUPPORTED'
              ? `🟢 Formato Soportado (${sourceSummary.label})`
              : sourceSummary?.state === 'PARTIALLY_SUPPORTED'
              ? `⚠️ Soporte Parcial (${sourceSummary.label})`
              : sourceSummary?.state === 'NOT_SUPPORTED'
              ? `❌ No Soportado (${sourceSummary.label})`
              : sourceSummary?.state === 'PLANNED_AUDIO_WORKSTREAM'
              ? `🎙️ Preservación de Audio Disponible (WS-AUDIO-01)`
              : `⏱️ Planificado Fase 2B (${sourceSummary?.label})`}
          </span>
        </div>
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
                  Formatos soportados: MusicXML (.musicxml, .xml), MIDI (.mid), ChordPro (.cho, .crd), PDF, Imagen, Audio (MP3, WAV, FLAC, OGG, M4A)
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileInputChange}
                  accept=".musicxml,.xml,.mxl,.mid,.midi,.cho,.chordpro,.crd,.pro,.pdf,.png,.jpg,.jpeg,.mp3,.wav,.m4a,.flac,.ogg,.aac"
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

            {selectedFile && sourceSummary?.advisoryNotice && (
              <div
                className={`capability-advisory-banner ${
                  sourceSummary.state === 'NOT_SUPPORTED'
                    ? 'advisory-blocked'
                    : sourceSummary.state === 'PARTIALLY_SUPPORTED'
                    ? 'advisory-warning'
                    : 'advisory-info'
                }`}
              >
                <span className="advisory-icon">
                  {sourceCategory === 'AUDIO_RECORDING'
                    ? '🎙️'
                    : sourceCategory === 'PDF_SCORE' || sourceCategory === 'IMAGE_SCORE'
                    ? '📄'
                    : sourceCategory === 'TABLATURE_ASCII'
                    ? '⚠️'
                    : sourceCategory === 'UNKNOWN_UNSUPPORTED'
                    ? '❌'
                    : 'ℹ️'}
                </span>
                <div className="advisory-content">
                  <strong>{sourceSummary.label}:</strong> {sourceSummary.advisoryNotice}
                </div>
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
                  {sourceCategory === 'TXT_LYRICS' && '📝 Solo Letra / Texto'}
                  {sourceCategory === 'PDF_SCORE' && '📄 Partitura en PDF'}
                  {sourceCategory === 'IMAGE_SCORE' && '🖼️ Partitura en Imagen'}
                  {sourceCategory === 'AUDIO_RECORDING' && '🎙️ Grabación de Audio'}
                  {sourceCategory === 'VIDEO_REFERENCE' && '🎥 Video de Referencia'}
                  {sourceCategory === 'TABLATURE_ASCII' && '🎸 Tablatura ASCII'}
                  {sourceCategory === 'WRITTEN_NOTES' && '📝 Notas Escritas / JSON'}
                  {sourceCategory === 'UNKNOWN_UNSUPPORTED' && '❓ Formato No Reconocido'}
                </span>
                {sourceSummary && (
                  <span
                    className={`cap-badge ${getCapabilityStateBadgeClass(sourceSummary.state)}`}
                    style={{ marginLeft: '8px' }}
                  >
                    {getCapabilityStateBadgeLabel(sourceSummary.state)}
                  </span>
                )}
              </div>

              <div className="capabilities-matrix-list">
                {sourceCategory === 'AUDIO_RECORDING' && activeAudioDraft ? (
                  (['CHORD_PRO', 'MUSIC_XML', 'MIDI', 'TABLATURE', 'LYRICS_ONLY'] as const).map((fmtKey) => {
                    const targetInfo = activeAudioDraft.targets[fmtKey];
                    if (!targetInfo) return null;
                    const labelMap: Record<string, string> = {
                      CHORD_PRO: 'ChordPro / Cifrado',
                      MUSIC_XML: 'MusicXML 4.0',
                      MIDI: 'MIDI Estándar (SMF 1)',
                      TABLATURE: `Tablatura (${activeAudioDraft.selectedInstrument === 'BASS' ? 'Bajo' : 'Guitarra'})`,
                      LYRICS_ONLY: 'Solo Letra (TXT)',
                    };
                    const badgeClass =
                      activeAudioDraft.workflowState === 'APPROVED' && targetInfo.generatable
                        ? 'badge-state-supported'
                        : targetInfo.status === 'DRAFT_READY'
                        ? 'badge-state-supported'
                        : targetInfo.status === 'REVIEW_REQUIRED'
                        ? 'badge-state-partially-supported'
                        : 'badge-state-not-supported';
                    const badgeText =
                      activeAudioDraft.workflowState === 'APPROVED' && targetInfo.generatable
                        ? 'APPROVED'
                        : targetInfo.status;
                    return (
                      <div key={fmtKey} className="capability-row">
                        <span className="cap-format-name">{labelMap[fmtKey]}</span>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span className={`cap-badge ${badgeClass}`}>{badgeText}</span>
                          {targetInfo.generatable && (
                            <span className="cap-badge badge-ai-draft">
                              {Math.round(targetInfo.confidence * 100)}% CONFIANZA
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  capabilities.map((cap) => (
                    <div key={cap.format} className="capability-row">
                      <span className="cap-format-name">{cap.label}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span className={`cap-badge ${getCapabilityStateBadgeClass(cap.capabilityState)}`}>
                          {sourceCategory === 'AUDIO_RECORDING'
                            ? audioWorkflowState !== 'IDLE'
                              ? audioWorkflowState
                              : 'REQUIERE ANÁLISIS PYTHON (WS-AUDIO-02/03)'
                            : getCapabilityStateBadgeLabel(cap.capabilityState)}
                        </span>
                        <span className={`cap-badge ${getBadgeClass(cap.statusBadge)}`}>
                          {sourceCategory === 'AUDIO_RECORDING'
                            ? 'BORRADOR REVISIÓN HUMANA'
                            : getBadgeLabel(cap.statusBadge)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
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
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <span className={`cap-badge ${getCapabilityStateBadgeClass(cap.capabilityState)}`}>
                            {getCapabilityStateBadgeLabel(cap.capabilityState)}
                          </span>
                          <span className={`cap-badge ${getBadgeClass(cap.statusBadge)}`}>
                            {getBadgeLabel(cap.statusBadge)}
                          </span>
                        </div>
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

              {sourceCategory === 'AUDIO_RECORDING' ? (
                <div
                  className="audio-preservation-panel"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>
                      🎙️ Flujo Secuencial de Audio: Preservación, Análisis Python y Transcripción (Scope 1C)
                    </h4>
                    <span
                      className="cap-badge"
                      style={{
                        background:
                          audioWorkflowState === 'APPROVED'
                            ? 'rgba(34,197,94,0.2)'
                            : audioWorkflowState === 'REJECTED' || audioWorkflowState === 'FAILED'
                            ? 'rgba(239,68,68,0.2)'
                            : 'rgba(59,130,246,0.2)',
                        color:
                          audioWorkflowState === 'APPROVED'
                            ? '#86efac'
                            : audioWorkflowState === 'REJECTED' || audioWorkflowState === 'FAILED'
                            ? '#fca5a5'
                            : '#93c5fd',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      ESTADO: {audioWorkflowState}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                    1) Preserve el archivo original (SHA-256). 2) Ejecute el análisis acústico Python (10 etapas DSP) y
                    genere borradores musicales (ChordPro, MusicXML, MIDI, Tablatura). 3) Revise y apruebe el borrador
                    para publicarlo como versión controlada en el Atril Digital sin sobrescribir canciones canónicas.
                  </p>

                  <div className="option-field" style={{ marginBottom: '12px' }}>
                    <label htmlFor="audio-target-song" className="option-label">
                      Canción Destino en el Catálogo (Asociación Explícita):
                    </label>
                    <select
                      id="audio-target-song"
                      className="option-input"
                      value={selectedSongId}
                      onChange={(e) => setSelectedSongId(e.target.value)}
                      disabled={isPreservingAudio || isAnalyzingAudio}
                    >
                      <option value={CREATE_NEW_SONG_OPTION}>
                        ✨ Crear nueva canción en catálogo: «{selectedFile.name.replace(/\.[^/.]+$/, '').trim() || selectedFile.name}»
                      </option>
                      {songList.map((s) => (
                        <option key={s.id} value={s.id}>
                          📌 Asociar a canción existente: {s.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {errorMessage && conversionStatus === 'IDLE' && (
                    <div
                      role="alert"
                      style={{
                        padding: '12px',
                        background: 'rgba(239,68,68,0.15)',
                        borderRadius: '6px',
                        border: '1px solid rgba(239,68,68,0.4)',
                        marginBottom: '12px',
                        fontSize: '0.85rem',
                        color: '#fca5a5',
                      }}
                    >
                      <div>⚠️ <strong>Error en el flujo de audio</strong></div>
                      <div style={{ marginTop: '4px' }}>{errorMessage}</div>
                    </div>
                  )}

                  {audioPreservationSuccess && (
                    <div
                      style={{
                        padding: '12px',
                        background: 'rgba(34,197,94,0.15)',
                        borderRadius: '6px',
                        border: '1px solid rgba(34,197,94,0.4)',
                        marginBottom: '12px',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div>✅ <strong>Audio original preservado en el servidor (WS-AUDIO-01)</strong></div>
                      <div>SHA-256: <code style={{ fontSize: '0.75rem' }}>{audioPreservationSuccess.checksumSha256}</code></div>
                      <div>Canción asociada: <strong>{audioPreservationSuccess.songTitle || 'Catálogo'}</strong></div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <button
                          type="button"
                          className="btn-action-primary"
                          style={{ padding: '6px 12px', background: '#16a34a', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
                          onClick={handleOpenPreservedSongInStand}
                        >
                          🎵 Abrir «{audioPreservationSuccess.songTitle}» en el Atril Digital
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn-execute-conversion"
                      onClick={() => void handlePreserveAudio()}
                      disabled={isPreservingAudio || isAnalyzingAudio || !user}
                      style={{
                        background: '#2563eb',
                        cursor: isPreservingAudio || isAnalyzingAudio || !user ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isPreservingAudio
                        ? '💾 Preservando Audio Original...'
                        : !user
                        ? '🔒 Inicie sesión para preservar'
                        : '💾 Paso 1: Preservar Audio para el Atril Digital (WS-AUDIO-01)'}
                    </button>

                    <button
                      type="button"
                      className="btn-execute-conversion"
                      onClick={() => void handleAnalyzeAndTranscribeAudio()}
                      disabled={isPreservingAudio || isAnalyzingAudio || !user}
                      style={{
                        background: '#7c3aed',
                        cursor: isPreservingAudio || isAnalyzingAudio || !user ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isAnalyzingAudio
                        ? '🔬 Ejecutando Análisis Python DSP (10 Etapas) y Transcripción...'
                        : !user
                        ? '🔒 Inicie sesión para analizar y transcribir'
                        : '🔬 Paso 2: Analizar Audio con Python y Generar Borradores Musicales (WS-AUDIO-02/03)'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {!canConvert && (
                    <div className="conversion-disabled-notice">
                      🚫 <strong>Conversión no disponible para este tipo de archivo:</strong>{' '}
                      {sourceSummary?.advisoryNotice ||
                        'Este formato está reservado para preservación o planificado para la Fase 2B.'}
                    </div>
                  )}

                  {canConvert && !isTargetAvailable && (
                    <div className="conversion-disabled-notice">
                      ⚠️ <strong>Formato objetivo no disponible:</strong>{' '}
                      {currentTargetCap?.blockingReason ||
                        'El formato seleccionado no es viable para la fuente actual.'}
                    </div>
                  )}

                  {/* Botón de Iniciar Conversión */}
                  <button
                    type="button"
                    className="btn-execute-conversion"
                    onClick={handleStartConversion}
                    disabled={conversionStatus === 'PROCESSING' || !canConvert || !isTargetAvailable}
                  >
                    {conversionStatus === 'PROCESSING'
                      ? '⚙️ Procesando...'
                      : !canConvert
                      ? '🚫 Conversión no disponible (Planificado Fase 2B)'
                      : !isTargetAvailable
                      ? '🚫 Formato Objetivo No Disponible'
                      : '🚀 Convertir Archivo'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: Progreso, Revisión Humana y Exportación */}
        <div className="conversion-panel-right">
          {/* PANEL DE REVISIÓN HUMANA OBLIGATORIA PARA BORRADORES DE AUDIO (WS-AUDIO-02, WS-AUDIO-03 & GATE 4) */}
          {sourceCategory === 'AUDIO_RECORDING' && activeAudioDraft && (
            <div className="conversion-card section-audio-human-review">
              <h3 className="section-title">
                <span className="step-num">E</span> Revisión Humana Obligatoria de Transcripción de Audio (Gate 4)
              </h3>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  borderRadius: '6px',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  marginBottom: '12px',
                  fontSize: '0.82rem',
                }}
              >
                <span>
                  <strong>Estado:</strong> <code>{activeAudioDraft.workflowState}</code>
                </span>
                <span>•</span>
                <span>
                  <strong>Canción asociada:</strong> {activeAudioDraft.songTitle}
                </span>
                <span>•</span>
                <span>
                  <strong>Confianza Global:</strong> {Math.round(activeAudioDraft.overallConfidence * 100)}%
                </span>
                <span>•</span>
                <span>
                  <strong>Motor:</strong> {activeAudioDraft.analysisVersion} / {activeAudioDraft.transcriptionVersion}
                </span>
              </div>

              {reviewActionFeedback && (
                <div
                  role="status"
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '0.85rem',
                    color: '#bfdbfe',
                  }}
                >
                  {reviewActionFeedback}
                </div>
              )}

              {/* 1. Reproductor del Audio Original Preservado */}
              {audioPlaybackUrl && (
                <div style={{ marginBottom: '14px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px' }}>
                    🎧 <strong>Audio Original Preservado:</strong> {activeAudioDraft.sourceFilename} (SHA-256:{' '}
                    <code>{activeAudioDraft.sourceSha256.slice(0, 16)}...</code>)
                  </div>
                  <audio controls src={audioPlaybackUrl} style={{ width: '100%', height: '36px' }} preload="metadata" />
                </div>
              )}

              {/* 2. Resumen de Análisis Acústico Python (WS-AUDIO-02) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '8px',
                  marginBottom: '14px',
                }}
              >
                <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Tonalidad Estimada</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeAudioDraft.analysisSummary.key ?? 'No resuelta'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                    Confianza: {Math.round(activeAudioDraft.analysisSummary.keyConfidence * 100)}% (
                    {activeAudioDraft.analysisSummary.keyStatus})
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Tempo (BPM)</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeAudioDraft.analysisSummary.bpm ? `${activeAudioDraft.analysisSummary.bpm} BPM` : 'No resuelto'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                    Confianza: {Math.round(activeAudioDraft.analysisSummary.bpmConfidence * 100)}% (
                    {activeAudioDraft.analysisSummary.bpmStatus})
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Métrica / Compás</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeAudioDraft.analysisSummary.timeSignature ?? 'No resuelta'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                    Confianza: {Math.round(activeAudioDraft.analysisSummary.meterConfidence * 100)}% (
                    {activeAudioDraft.analysisSummary.meterStatus})
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Eventos Detectados</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeAudioDraft.analysisSummary.totalChordsDetected} acordes /{' '}
                    {activeAudioDraft.analysisSummary.totalNotesDetected} notas
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
                    Notas: {activeAudioDraft.analysisSummary.noteExtractionStatus}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  color: '#fde68a',
                  marginBottom: '14px',
                }}
              >
                ℹ️ <strong>Evaluación de Polifonía y Cero Fabricación:</strong>{' '}
                {activeAudioDraft.analysisSummary.noteExtractionReason}
              </div>

              {/* 3. Línea de Tiempo de Acordes Reconocidos */}
              {activeAudioDraft.analysisSummary.chordTimeline.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: '#cbd5e1' }}>
                    🎸 Línea de Tiempo de Acordes Reconocidos ({activeAudioDraft.analysisSummary.chordTimeline.length} segmentos):
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      overflowX: 'auto',
                      paddingBottom: '6px',
                      maxHeight: '95px',
                    }}
                  >
                    {activeAudioDraft.analysisSummary.chordTimeline.slice(0, 32).map((seg, idx) => (
                      <div
                        key={idx}
                        style={{
                          minWidth: '88px',
                          padding: '6px 8px',
                          background: 'rgba(30, 41, 59, 0.85)',
                          borderRadius: '5px',
                          border:
                            seg.status === 'DETECTED'
                              ? '1px solid rgba(34,197,94,0.45)'
                              : '1px solid rgba(251,191,36,0.45)',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f8fafc' }}>{seg.chord}</div>
                        <div style={{ color: '#94a3b8' }}>
                          Compás {seg.measureNumber} • T{seg.beat}
                        </div>
                        <div style={{ color: '#60a5fa' }}>
                          {seg.startTimeSec.toFixed(1)}s ({Math.round(seg.confidence * 100)}%)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Editor de Propuesta Musical (Revisión Humana) */}
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  marginBottom: '14px',
                }}
              >
                <div style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '10px', color: '#93c5fd' }}>
                  ✏️ Edición y Corrección Humana del Borrador Propuesto
                </div>

                <div className="options-form-grid" style={{ marginBottom: '10px' }}>
                  <div className="option-field">
                    <label className="option-label" htmlFor="review-title-input">Título de la Obra:</label>
                    <input
                      id="review-title-input"
                      type="text"
                      className="option-input"
                      value={reviewTitle}
                      onChange={(e) => setReviewTitle(e.target.value)}
                    />
                  </div>
                  <div className="option-field">
                    <label className="option-label" htmlFor="review-key-input">Tonalidad Confirmada:</label>
                    <input
                      id="review-key-input"
                      type="text"
                      className="option-input"
                      placeholder="Ej. Em, G, C"
                      value={reviewKey}
                      onChange={(e) => setReviewKey(e.target.value)}
                    />
                  </div>
                  <div className="option-field">
                    <label className="option-label" htmlFor="review-bpm-input">Tempo Confirmado (BPM):</label>
                    <input
                      id="review-bpm-input"
                      type="number"
                      className="option-input"
                      value={reviewBpm}
                      onChange={(e) => setReviewBpm(e.target.value)}
                    />
                  </div>
                  <div className="option-field">
                    <label className="option-label" htmlFor="review-timesig-input">Métrica Confirmada:</label>
                    <input
                      id="review-timesig-input"
                      type="text"
                      className="option-input"
                      placeholder="Ej. 4/4, 3/4, 6/8"
                      value={reviewTimeSig}
                      onChange={(e) => setReviewTimeSig(e.target.value)}
                    />
                  </div>
                </div>

                <div className="option-field" style={{ marginBottom: '10px' }}>
                  <label className="option-label" htmlFor="review-instrument-select">
                    Instrumento para Proyección / Tablatura:
                  </label>
                  <select
                    id="review-instrument-select"
                    className="option-input"
                    value={reviewInstrument}
                    onChange={(e) =>
                      setReviewInstrument(e.target.value as 'GUITAR' | 'BASS' | 'PIANO' | 'VOCAL')
                    }
                  >
                    <option value="GUITAR">🎸 Guitarra (6 Cuerdas Estándar)</option>
                    <option value="BASS">🎸 Bajo Eléctrico (4 Cuerdas Estándar)</option>
                    <option value="PIANO">🎹 Piano / Teclado</option>
                    <option value="VOCAL">🎤 Voz / Guía de Director</option>
                  </select>
                </div>

                <div className="option-field" style={{ marginBottom: '10px' }}>
                  <label className="option-label" htmlFor="review-lyrics-textarea">
                    Letra Verificada (Opcional — nunca se inventa letra sin fuente verificada):
                  </label>
                  <textarea
                    id="review-lyrics-textarea"
                    className="option-input"
                    rows={3}
                    placeholder="Pegue aquí la letra verificada (una frase por línea) si desea integrarla al cifrado y habilitar el formato Solo Letra..."
                    value={reviewVerifiedLyrics}
                    onChange={(e) => setReviewVerifiedLyrics(e.target.value)}
                    style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                  />
                </div>

                <div className="option-field" style={{ marginBottom: '10px' }}>
                  <label className="option-label" htmlFor="review-chordpro-textarea">
                    Contenido Propuesto ChordPro / Lead Sheet (Editable):
                  </label>
                  <textarea
                    id="review-chordpro-textarea"
                    className="option-input"
                    rows={8}
                    value={reviewChordPro}
                    onChange={(e) => setReviewChordPro(e.target.value)}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
                  />
                </div>

                <div className="option-field" style={{ marginBottom: '10px' }}>
                  <label className="option-label" htmlFor="review-notes-input">
                    Notas del Revisor Humano (Auditoría):
                  </label>
                  <input
                    id="review-notes-input"
                    type="text"
                    className="option-input"
                    placeholder="Ej. Se verificó progresión Em - C - D - Em y tempo 70 BPM"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleSaveAudioDraftEdits()}
                  disabled={isSavingDraftEdits || activeAudioDraft.reviewStatus === 'COMMITTED'}
                  style={{
                    padding: '7px 14px',
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: isSavingDraftEdits ? 'not-allowed' : 'pointer',
                    fontSize: '0.83rem',
                    fontWeight: 600,
                  }}
                >
                  {isSavingDraftEdits
                    ? '💾 Recalculando Borrador...'
                    : '💾 Guardar Correcciones en Borrador y Actualizar Vistas Previas'}
                </button>
              </div>

              {/* 5. Vista Previa y Descarga por Formato Objetivo (WS-AUDIO-03) */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 600, marginBottom: '8px', color: '#cbd5e1' }}>
                  📄 Vista Previa de Formatos Transcritos (WS-AUDIO-03):
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {(['CHORD_PRO', 'MUSIC_XML', 'MIDI', 'TABLATURE', 'LYRICS_ONLY'] as const).map((fmt) => {
                    const art = activeAudioDraft.targets[fmt];
                    const isSelected = previewTargetFormat === fmt;
                    return (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setPreviewTargetFormat(fmt)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '5px',
                          border: isSelected ? '1px solid #60a5fa' : '1px solid rgba(255,255,255,0.15)',
                          background: isSelected ? 'rgba(37, 99, 235, 0.3)' : 'rgba(15, 23, 42, 0.6)',
                          color: art?.generatable ? '#f8fafc' : '#94a3b8',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                        }}
                      >
                        {fmt} ({art?.status ?? 'N/A'})
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const selectedArt = activeAudioDraft.targets[previewTargetFormat];
                  if (!selectedArt) return null;
                  return (
                    <div
                      style={{
                        padding: '10px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        borderRadius: '6px',
                        border: '1px solid rgba(148, 163, 184, 0.2)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: selectedArt.generatable ? '#86efac' : '#fca5a5' }}>
                          <strong>{selectedArt.format}</strong> — {selectedArt.reason}
                        </span>
                        {selectedArt.generatable && selectedArt.content && (
                          <button
                            type="button"
                            onClick={() => handleDownloadAudioDraftFormat(selectedArt)}
                            style={{
                              padding: '4px 10px',
                              background: '#334155',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            ⬇️ Descargar {selectedArt.filename}
                          </button>
                        )}
                      </div>
                      {selectedArt.generatable && selectedArt.content ? (
                        selectedArt.isBinary ? (
                          <div style={{ fontSize: '0.8rem', color: '#93c5fd', padding: '8px 0' }}>
                            🎹 Archivo binario MIDI SMF 1 verificado ({selectedArt.filename}). Use el botón de descarga para abrirlo en su DAW.
                          </div>
                        ) : (
                          <pre
                            style={{
                              maxHeight: '200px',
                              overflowY: 'auto',
                              fontSize: '0.76rem',
                              background: '#090d16',
                              padding: '8px',
                              borderRadius: '4px',
                              margin: 0,
                              color: '#e2e8f0',
                            }}
                          >
                            <code>{selectedArt.content.slice(0, 2500)}</code>
                          </pre>
                        )
                      ) : null}
                    </div>
                  );
                })()}
              </div>

              {/* 6. Acciones de Aprobación, Solicitud de Corrección y Rechazo (Gate 4 & Protección Canónica) */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  paddingTop: '10px',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleApproveAndPublishAudioDraft()}
                  disabled={isSubmittingReviewDecision}
                  style={{
                    padding: '8px 14px',
                    background: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: isSubmittingReviewDecision ? 'not-allowed' : 'pointer',
                  }}
                >
                  ✅ Aprobar Borrador y Publicar Versión al Atril Digital
                </button>

                <button
                  type="button"
                  onClick={() => void handleReviewDecision('CORRECTION_REQUESTED')}
                  disabled={isSubmittingReviewDecision || activeAudioDraft.reviewStatus === 'COMMITTED'}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fcd34d',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    cursor: isSubmittingReviewDecision ? 'not-allowed' : 'pointer',
                  }}
                >
                  ⚠️ Solicitar Corrección
                </button>

                <button
                  type="button"
                  onClick={() => void handleReviewDecision('REJECTED')}
                  disabled={isSubmittingReviewDecision || activeAudioDraft.reviewStatus === 'COMMITTED'}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    cursor: isSubmittingReviewDecision ? 'not-allowed' : 'pointer',
                  }}
                >
                  ✕ Rechazar Borrador (Proteger Canción Canónica)
                </button>

                <button
                  type="button"
                  onClick={() => void handleOpenPreservedSongInStand()}
                  style={{
                    padding: '8px 14px',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  🎵 Abrir «{activeAudioDraft.songTitle}» en el Atril Digital
                </button>
              </div>
            </div>
          )}

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
                  {conversionStatus === 'CANCELLED' && '🛑 CANCELADO'}
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

              <div className="queue-controls-row" style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                {conversionStatus === 'PROCESSING' && (
                  <button
                    type="button"
                    className="btn-cancel-job"
                    onClick={handleCancelJob}
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      borderRadius: '6px',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.825rem',
                      cursor: 'pointer',
                    }}
                  >
                    🛑 Cancelar Proceso
                  </button>
                )}
                {conversionStatus === 'FAILED' && (
                  isPermanentFailure ? (
                    <div className="retry-blocked-notice">
                      ℹ️ <em>Reintento deshabilitado: La conversión no es viable para este tipo de archivo en la versión actual.</em>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-retry-job"
                      onClick={handleRetryJob}
                      style={{
                        background: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        color: '#60a5fa',
                        borderRadius: '6px',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.825rem',
                        cursor: 'pointer',
                      }}
                    >
                      🔄 Reintentar Trabajo
                    </button>
                  )
                )}
                {conversionStatus === 'CANCELLED' && (
                  <button
                    type="button"
                    className="btn-retry-job"
                    onClick={handleStartConversion}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      color: '#60a5fa',
                      borderRadius: '6px',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.825rem',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Reiniciar Conversión
                  </button>
                )}
              </div>

              {errorMessage && (
                <div className="human-friendly-error-card">
                  {(() => {
                    const errorInfo = formatHumanFriendlyError(errorMessage);
                    return (
                      <>
                        <div className="human-error-title">
                          <span>⚠️</span>
                          <span>{errorInfo.title}</span>
                        </div>
                        <div className="human-error-explanation">{errorInfo.explanation}</div>
                        {errorInfo.technical && (
                          <div className="human-error-technical">
                            Diagnóstico técnico: {errorInfo.technical}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
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
