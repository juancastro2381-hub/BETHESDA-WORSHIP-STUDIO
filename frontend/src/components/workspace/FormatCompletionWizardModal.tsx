/**
 * @file FormatCompletionWizardModal.tsx
 * @description Asistente guiado para completar la información musical faltante de cada formato del Atril Digital
 * (Partitura, Cifrado con Letra, Letra Sola y Tablatura) sin fabricación artificial de contenido.
 *
 * Respeta el flujo controlado de gobernanza:
 * Validar/Previsualizar -> Preservar Fuente y Crear Borrador (omr_proposals) -> Revisión y Aprobación RBAC (vN+1).
 */

import React, { useEffect, useState } from 'react';
import { CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { InstrumentRegistry, type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { TablatureCalculator } from '../../core/projection/tablature-calculator.ts';
import { UnifiedMusicImporter } from '../../core/ingestion/unified-importer.ts';
import {
  BethesdaApiClient,
  type CompletionPreviewResponseDTO,
  type CompletionProposalSummaryDTO,
  type CompletionSourceKindDTO,
  type MusicalCompletionPayloadDTO,
} from '../../core/api/api-client.ts';
import {
  StandFormatCapabilityResolver,
  type StandFormatCapabilityDescriptor,
  type StandReadingFormatId,
} from '../../core/workspace/stand-format-capabilities.ts';

export interface WrittenNoteDraftEntry {
  step: string;
  octave: number;
  alter: number;
  duration: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
  measureNumber: number;
}

export interface FormatCompletionUnsavedDraftState {
  partitureSourceKind: 'MUSICXML' | 'MIDI' | 'WRITTEN_NOTES';
  musicXmlText: string;
  midiBase64: string;
  midiFilename: string;
  writtenNotesTitle: string;
  writtenNotesEntries: WrittenNoteDraftEntry[];
  leadSheetSourceKind: 'LYRICS_TEXT' | 'CHORDPRO';
  chordProText: string;
  lyricsText: string;
  lyricsFilename: string;
  lyricsAlignmentMode: 'BY_MEASURE' | 'UNALIGNED';
  lyricsSourceOrigin: 'MANUAL_ENTRY' | 'TXT_IMPORT' | 'UNVERIFIED_AUDIO_SPEECH';
  lyricsVerifiedByHuman: boolean;
  tabSourceKind: 'EXISTING_NOTES_FRET_OVERRIDE' | 'TABLATURE_ASCII' | 'MUSICXML';
  tabAsciiText: string;
  tabInstrumentId: string;
  tabCapoFret: number;
  tabFretOverrides: Record<string, { stringNumber: number; fret: number }>;
  tabVerified: boolean;
  reviewerNotes: string;
}

export function createInitialFormatCompletionDraftState(
  songTitle = '',
  instrumentId = 'acoustic_guitar',
  capoFret = 0
): FormatCompletionUnsavedDraftState {
  return {
    partitureSourceKind: 'MUSICXML',
    musicXmlText: '',
    midiBase64: '',
    midiFilename: '',
    writtenNotesTitle: songTitle || 'Melodía',
    writtenNotesEntries: [{ step: 'C', octave: 4, alter: 0, duration: 'quarter', measureNumber: 1 }],
    leadSheetSourceKind: 'LYRICS_TEXT',
    chordProText: '',
    lyricsText: '',
    lyricsFilename: '',
    lyricsAlignmentMode: 'BY_MEASURE',
    lyricsSourceOrigin: 'MANUAL_ENTRY',
    lyricsVerifiedByHuman: true,
    tabSourceKind: 'EXISTING_NOTES_FRET_OVERRIDE',
    tabAsciiText: '',
    tabInstrumentId:
      instrumentId === 'bass' || instrumentId === 'electric_guitar'
        ? instrumentId
        : 'acoustic_guitar',
    tabCapoFret: capoFret,
    tabFretOverrides: {},
    tabVerified: false,
    reviewerNotes: '',
  };
}

export interface FormatCompletionWizardModalProps {
  readonly isOpen: boolean;
  readonly initialTargetFormat: StandReadingFormatId;
  readonly song: CanonicalMusicPayload;
  readonly songId?: string | undefined;
  readonly songStatus?: 'DRAFT' | 'APPROVED' | 'ARCHIVED' | undefined;
  readonly instrumentProfile: InstrumentProfile;
  readonly capoFret: number;
  readonly serverCapabilities?: Partial<Record<StandReadingFormatId, StandFormatCapabilityDescriptor>> | null | undefined;
  readonly pendingProposals?: readonly CompletionProposalSummaryDTO[] | undefined;
  readonly canApproveAndPublish: boolean;
  readonly isAuthenticated: boolean;
  readonly apiClient: BethesdaApiClient;
  readonly preservedDraftState: FormatCompletionUnsavedDraftState;
  readonly onUpdateDraftState: (
    updater: (prev: FormatCompletionUnsavedDraftState) => FormatCompletionUnsavedDraftState
  ) => void;
  readonly onClose: () => void;
  readonly onSongVersionUpdated?: ((songId: string) => Promise<void>) | undefined;
  readonly onApplyLocalPreview?: ((payload: CanonicalMusicPayload) => void) | undefined;
}

const registry = new InstrumentRegistry();
const stringInstruments = registry
  .getAll()
  .filter((p) => p.tuning !== undefined && p.isRepresentationSupported('TABLATURE'));

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1]! : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo binario.'));
    reader.readAsDataURL(file);
  });
}

export const FormatCompletionWizardModal: React.FC<FormatCompletionWizardModalProps> = ({
  isOpen,
  initialTargetFormat,
  song,
  songId,
  songStatus,
  instrumentProfile,
  capoFret,
  serverCapabilities,
  pendingProposals = [],
  canApproveAndPublish,
  isAuthenticated,
  apiClient,
  preservedDraftState,
  onUpdateDraftState,
  onClose,
  onSongVersionUpdated,
  onApplyLocalPreview,
}) => {
  const [activeFormat, setActiveFormat] = useState<StandReadingFormatId>(initialTargetFormat);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<CompletionPreviewResponseDTO | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveFormat(initialTargetFormat);
      setErrorMessage(null);
      setStatusMessage(null);
      setPreviewResult(null);
    }
  }, [isOpen, initialTargetFormat]);

  if (!isOpen) return null;

  const localCapabilities = StandFormatCapabilityResolver.evaluateAll(song, instrumentProfile, {
    songStatus,
    capoFret,
  });
  const effectiveCaps: Record<StandReadingFormatId, StandFormatCapabilityDescriptor> = {
    STAFF_NOTATION: serverCapabilities?.STAFF_NOTATION ?? localCapabilities.STAFF_NOTATION,
    CHORD_CHART: serverCapabilities?.CHORD_CHART ?? localCapabilities.CHORD_CHART,
    LYRICS_ONLY: serverCapabilities?.LYRICS_ONLY ?? localCapabilities.LYRICS_ONLY,
    TABLATURE: serverCapabilities?.TABLATURE ?? localCapabilities.TABLATURE,
  };
  const activeCap = effectiveCaps[activeFormat];

  const tabInstrument =
    registry.get(preservedDraftState.tabInstrumentId) ??
    registry.getOrThrow('acoustic_guitar');

  const songNotes = song.measures.flatMap((m) =>
    m.getAllNotes().map((n) => ({
      measureNumber: m.number,
      note: n,
      candidates: tabInstrument.tuning
        ? TablatureCalculator.findCandidates(n.pitch, tabInstrument.tuning, preservedDraftState.tabCapoFret)
        : [],
    }))
  );

  const buildPayloadDTO = (): MusicalCompletionPayloadDTO => {
    const trimmedNotes = preservedDraftState.reviewerNotes.trim();
    const notesPatch = trimmedNotes ? { notes: trimmedNotes } : {};

    if (activeFormat === 'STAFF_NOTATION') {
      if (preservedDraftState.partitureSourceKind === 'MUSICXML') {
        return {
          targetFormat: 'STAFF_NOTATION',
          sourceKind: 'MUSICXML',
          instrumentId: instrumentProfile.id,
          filename: `${song.title || 'partitura'}.musicxml`,
          rawText: preservedDraftState.musicXmlText,
          ...notesPatch,
        };
      }
      if (preservedDraftState.partitureSourceKind === 'MIDI') {
        return {
          targetFormat: 'STAFF_NOTATION',
          sourceKind: 'MIDI',
          instrumentId: instrumentProfile.id,
          filename: preservedDraftState.midiFilename || `${song.title || 'secuencia'}.mid`,
          dataBase64: preservedDraftState.midiBase64,
          ...notesPatch,
        };
      }
      const measuresMap = new Map<number, Array<{ step: string; octave: number; alter: number; duration: string }>>();
      for (const n of preservedDraftState.writtenNotesEntries) {
        const list = measuresMap.get(n.measureNumber) ?? [];
        list.push({ step: n.step, octave: n.octave, alter: n.alter, duration: n.duration });
        measuresMap.set(n.measureNumber, list);
      }
      const measures = Array.from(measuresMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([measureNumber, notes]) => ({ measureNumber, notes }));
      return {
        targetFormat: 'STAFF_NOTATION',
        sourceKind: 'WRITTEN_NOTES',
        instrumentId: instrumentProfile.id,
        writtenNotes: {
          title: preservedDraftState.writtenNotesTitle || song.title,
          measures,
        },
        ...notesPatch,
      };
    }

    if (activeFormat === 'CHORD_CHART') {
      if (preservedDraftState.leadSheetSourceKind === 'CHORDPRO') {
        return {
          targetFormat: 'CHORD_CHART',
          sourceKind: 'CHORDPRO',
          instrumentId: instrumentProfile.id,
          filename: `${song.title || 'lead_sheet'}.cho`,
          rawText: preservedDraftState.chordProText,
          ...notesPatch,
        };
      }
      return {
        targetFormat: 'CHORD_CHART',
        sourceKind: 'LYRICS_TEXT',
        instrumentId: instrumentProfile.id,
        filename: preservedDraftState.lyricsFilename || `${song.title || 'letra'}.txt`,
        lyricsData: {
          lyricsText: preservedDraftState.lyricsText,
          alignmentMode: preservedDraftState.lyricsAlignmentMode,
          sourceOrigin: preservedDraftState.lyricsSourceOrigin,
          verifiedByHuman: preservedDraftState.lyricsVerifiedByHuman,
        },
        ...notesPatch,
      };
    }

    if (activeFormat === 'LYRICS_ONLY') {
      return {
        targetFormat: 'LYRICS_ONLY',
        sourceKind: 'LYRICS_TEXT',
        instrumentId: instrumentProfile.id,
        filename: preservedDraftState.lyricsFilename || `${song.title || 'letra'}.txt`,
        lyricsData: {
          lyricsText: preservedDraftState.lyricsText,
          alignmentMode: 'BY_MEASURE',
          sourceOrigin: preservedDraftState.lyricsSourceOrigin,
          verifiedByHuman: preservedDraftState.lyricsVerifiedByHuman,
        },
        ...notesPatch,
      };
    }

    // TABLATURE
    const sourceKind: CompletionSourceKindDTO = preservedDraftState.tabSourceKind;
    const fretOverrides = Object.entries(preservedDraftState.tabFretOverrides).map(
      ([noteId, pos]) => ({
        noteId,
        stringNumber: pos.stringNumber,
        fret: pos.fret,
      })
    );
    return {
      targetFormat: 'TABLATURE',
      sourceKind,
      instrumentId: preservedDraftState.tabInstrumentId,
      ...(sourceKind === 'TABLATURE_ASCII'
        ? { filename: `${song.title || 'tab'}.tab`, rawText: preservedDraftState.tabAsciiText }
        : sourceKind === 'MUSICXML'
        ? { filename: `${song.title || 'tab'}.musicxml`, rawText: preservedDraftState.musicXmlText }
        : {}),
      tablatureConfig: {
        instrumentId: preservedDraftState.tabInstrumentId,
        capoFret: preservedDraftState.tabCapoFret,
        fretOverrides,
        tablatureVerified: preservedDraftState.tabVerified,
      },
      ...notesPatch,
    };
  };

  const handleValidatePreview = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setPreviewResult(null);

    const payloadDto = buildPayloadDTO();

    if (!songId || !isAuthenticated) {
      // Validación local inmediata para canciones de demostración no persistidas
      if (
        (payloadDto.sourceKind === 'MUSICXML' ||
          payloadDto.sourceKind === 'CHORDPRO' ||
          payloadDto.sourceKind === 'TABLATURE_ASCII') &&
        payloadDto.rawText
      ) {
        const importer = new UnifiedMusicImporter();
        const res = importer.import(payloadDto.rawText, payloadDto.filename);
        if (res.status === 'FAILED' || !res.payload) {
          setErrorMessage(res.diagnostics.map((d) => d.message).join(' | '));
          return;
        }
        const evalLocal = StandFormatCapabilityResolver.evaluateAll(res.payload, instrumentProfile);
        setStatusMessage(
          `Validación local completada: ${res.payload.getAllNotes().length} notas, ${res.payload.getAllChords().length} acordes, ${res.payload.getAllLyrics().length} sílabas. Estado ${activeFormat}: ${evalLocal[activeFormat].availabilityStatus}.`
        );
        if (onApplyLocalPreview && res.payload) {
          onApplyLocalPreview(res.payload);
        }
        return;
      }
      setErrorMessage(
        'Para enviar o validar cambios con preservación en el servidor, cargue una canción persistida del Catálogo BD e inicie sesión.'
      );
      return;
    }

    setIsBusy(true);
    try {
      const preview = await apiClient.validateSongCompletionPreview(songId, payloadDto);
      setPreviewResult(preview);
      if (preview.valid) {
        setStatusMessage(
          `✅ Validación técnica superada. Estado proyectado para ${activeCap.label}: ${preview.capabilities[activeFormat].availabilityStatus}. Ahora puede guardar el borrador en revisión.`
        );
      } else {
        setErrorMessage(preview.validationErrors.join(' | '));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al validar la información musical.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmitProposal = async () => {
    if (!songId || !isAuthenticated) {
      setErrorMessage('Inicie sesión sobre una canción guardada en PostgreSQL para crear una propuesta controlada.');
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const dto = buildPayloadDTO();
      const created = await apiClient.createSongCompletionProposal(songId, dto);
      setStatusMessage(
        `✅ Propuesta "${created.proposalId.slice(0, 8)}..." creada en estado ${created.reviewStatus} con fuente preservada (SHA-256: ${created.sourceHash.slice(0, 12)}...). La versión canónica activa no fue alterada.`
      );
      if (onSongVersionUpdated) {
        await onSongVersionUpdated(songId);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudo guardar la propuesta de completitud.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleReviewProposal = async (
    proposalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUESTED'
  ) => {
    if (!songId || !isAuthenticated) return;
    setIsBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await apiClient.reviewSongCompletionProposal(songId, proposalId, {
        decision,
        notes: preservedDraftState.reviewerNotes || undefined,
        setAsCurrent: true,
      });
      if (decision === 'APPROVED') {
        setStatusMessage(
          `🎉 Versión v${result.proposal.approvedVersionNumber} aprobada y publicada sin sobrescribir historial.`
        );
      } else {
        setStatusMessage(`Propuesta marcada como ${result.proposal.reviewStatus}. La canción canónica permanece intacta.`);
      }
      if (onSongVersionUpdated) {
        await onSongVersionUpdated(songId);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudo procesar la revisión de la propuesta.');
    } finally {
      setIsBusy(false);
    }
  };

  const formatTabMeta: Array<{ id: StandReadingFormatId; icon: string; label: string }> = [
    { id: 'STAFF_NOTATION', icon: '𝄞', label: 'Partitura' },
    { id: 'CHORD_CHART', icon: '𝄢', label: 'Cifrado con Letra' },
    { id: 'LYRICS_ONLY', icon: '📝', label: 'Letra Sola' },
    { id: 'TABLATURE', icon: '🎸', label: 'Tablatura' },
  ];

  const relevantProposals = pendingProposals.filter((p) => p.targetFormat === activeFormat);

  return (
    <div
      className="db-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-wizard-title"
    >
      <div className="db-modal-card format-completion-modal">
        <div className="db-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid rgba(148,163,184,0.18)', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 id="completion-wizard-title" style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>
              🧩 Asistente de Completitud Musical — «{song.title}»
            </h3>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '3px' }}>
              Cero Fabricación: complete la información real faltante para habilitar cada formato sin sobrescribir versiones previas.
            </div>
          </div>
          <button
            type="button"
            className="btn-close-conversion"
            onClick={onClose}
            aria-label="Volver al Atril Digital"
          >
            ↩️ Volver al Atril Digital
          </button>
        </div>

        <div className="db-modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          {/* Pestañas de los 4 Formatos del Atril */}
          <div className="completion-format-tabs" role="tablist" aria-label="Formatos del Atril Digital">
            {formatTabMeta.map((tab) => {
              const cap = effectiveCaps[tab.id];
              const isSelected = activeFormat === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActiveFormat(tab.id);
                    setErrorMessage(null);
                    setStatusMessage(null);
                    setPreviewResult(null);
                  }}
                  className={`completion-format-tab ${isSelected ? 'active' : ''} ${
                    cap.isAvailable ? 'available' : 'missing'
                  }`}
                >
                  <span>{tab.icon} {tab.label}</span>
                  <span className={`fmt-status-pill status-${cap.availabilityStatus.toLowerCase()}`}>
                    {cap.availabilityStatus}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Diagnóstico del Formato Seleccionado */}
          <div className="completion-diagnostic-box">
            <div className="completion-diag-header">
              <strong>Estado actual:</strong> <code>{activeCap.availabilityStatus}</code> •{' '}
              <strong>Evidencia:</strong> <code>{activeCap.evidenceStatus}</code> •{' '}
              <strong>Aprobación:</strong> <code>{activeCap.approvalStatus}</code>
            </div>
            {activeCap.blockingReason && (
              <div className="completion-diag-blocking">
                <strong>Motivo de restricción:</strong> {activeCap.blockingReason}
              </div>
            )}
            <div className="completion-diag-columns">
              <div>
                <div className="diag-col-title">Requisitos del formato:</div>
                <ul className="diag-list">
                  {activeCap.requiredContent.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="diag-col-title">Información faltante detectada:</div>
                {activeCap.missingContent.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#86efac' }}>
                    ✓ Contenido requerido completo.
                  </p>
                ) : (
                  <ul className="diag-list diag-missing">
                    {activeCap.missingContent.map((miss, idx) => (
                      <li key={idx}>{miss}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Flujo A: PARTITURE */}
          {activeFormat === 'STAFF_NOTATION' && (
            <div className="completion-workflow-panel">
              <div className="source-kind-selector">
                {(
                  [
                    { id: 'MUSICXML', label: 'Importar MusicXML (.musicxml / .xml)' },
                    { id: 'MIDI', label: 'Importar MIDI (.mid / .midi)' },
                    { id: 'WRITTEN_NOTES', label: 'Transcribir Notas Manuales' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`btn-source-mode ${
                      preservedDraftState.partitureSourceKind === opt.id ? 'active' : ''
                    }`}
                    onClick={() =>
                      onUpdateDraftState((prev) => ({ ...prev, partitureSourceKind: opt.id }))
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {preservedDraftState.partitureSourceKind === 'MUSICXML' && (
                <div className="completion-input-group">
                  <label className="option-label" htmlFor="completion-musicxml-file">
                    Subir archivo MusicXML o pegar contenido XML válido:
                  </label>
                  <input
                    id="completion-musicxml-file"
                    type="file"
                    accept=".xml,.musicxml"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const txt = await file.text();
                      onUpdateDraftState((prev) => ({ ...prev, musicXmlText: txt }));
                    }}
                  />
                  <textarea
                    className="completion-textarea"
                    rows={6}
                    value={preservedDraftState.musicXmlText}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, musicXmlText: e.target.value }))
                    }
                    placeholder="<score-partwise version=&quot;4.0&quot;>...</score-partwise>"
                  />
                </div>
              )}

              {preservedDraftState.partitureSourceKind === 'MIDI' && (
                <div className="completion-input-group">
                  <label className="option-label" htmlFor="completion-midi-file">
                    Seleccionar archivo MIDI estándar (.mid / .midi con eventos Note On reales):
                  </label>
                  <input
                    id="completion-midi-file"
                    type="file"
                    accept=".mid,.midi,audio/midi"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const b64 = await fileToBase64(file);
                      onUpdateDraftState((prev) => ({
                        ...prev,
                        midiBase64: b64,
                        midiFilename: file.name,
                      }));
                    }}
                  />
                  {preservedDraftState.midiFilename && (
                    <div className="midi-file-badge">
                      🎹 Archivo cargado: <strong>{preservedDraftState.midiFilename}</strong> (preservado como binario para validar cabecera MThd)
                    </div>
                  )}
                </div>
              )}

              {preservedDraftState.partitureSourceKind === 'WRITTEN_NOTES' && (
                <div className="completion-input-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span className="option-label">Notas melódicas verificadas por compás:</span>
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() =>
                        onUpdateDraftState((prev) => ({
                          ...prev,
                          writtenNotesEntries: [
                            ...prev.writtenNotesEntries,
                            {
                              step: 'D',
                              octave: 4,
                              alter: 0,
                              duration: 'quarter',
                              measureNumber: prev.writtenNotesEntries[prev.writtenNotesEntries.length - 1]?.measureNumber ?? 1,
                            },
                          ],
                        }))
                      }
                    >
                      + Agregar Nota
                    </button>
                  </div>
                  <div className="written-notes-rows">
                    {preservedDraftState.writtenNotesEntries.map((entry, idx) => (
                      <div key={idx} className="written-note-row">
                        <label>
                          Compás
                          <input
                            type="number"
                            min={1}
                            value={entry.measureNumber}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value || '1', 10));
                              onUpdateDraftState((prev) => ({
                                ...prev,
                                writtenNotesEntries: prev.writtenNotesEntries.map((item, i) =>
                                  i === idx ? { ...item, measureNumber: val } : item
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Nota
                          <select
                            value={entry.step}
                            onChange={(e) =>
                              onUpdateDraftState((prev) => ({
                                ...prev,
                                writtenNotesEntries: prev.writtenNotesEntries.map((item, i) =>
                                  i === idx ? { ...item, step: e.target.value } : item
                                ),
                              }))
                            }
                          >
                            {['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Alt
                          <select
                            value={entry.alter}
                            onChange={(e) =>
                              onUpdateDraftState((prev) => ({
                                ...prev,
                                writtenNotesEntries: prev.writtenNotesEntries.map((item, i) =>
                                  i === idx ? { ...item, alter: Number(e.target.value) } : item
                                ),
                              }))
                            }
                          >
                            <option value={0}>Natural</option>
                            <option value={1}>#</option>
                            <option value={-1}>b</option>
                          </select>
                        </label>
                        <label>
                          Octava
                          <input
                            type="number"
                            min={1}
                            max={7}
                            value={entry.octave}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(7, parseInt(e.target.value || '4', 10)));
                              onUpdateDraftState((prev) => ({
                                ...prev,
                                writtenNotesEntries: prev.writtenNotesEntries.map((item, i) =>
                                  i === idx ? { ...item, octave: val } : item
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Figura
                          <select
                            value={entry.duration}
                            onChange={(e) =>
                              onUpdateDraftState((prev) => ({
                                ...prev,
                                writtenNotesEntries: prev.writtenNotesEntries.map((item, i) =>
                                  i === idx ? { ...item, duration: e.target.value as any } : item
                                ),
                              }))
                            }
                          >
                            <option value="whole">Redonda</option>
                            <option value="half">Blanca</option>
                            <option value="quarter">Negra</option>
                            <option value="eighth">Corchea</option>
                            <option value="16th">Semicorchea</option>
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Flujo B & C: CHORDS WITH LYRICS / LYRICS ONLY */}
          {(activeFormat === 'CHORD_CHART' || activeFormat === 'LYRICS_ONLY') && (
            <div className="completion-workflow-panel">
              {activeFormat === 'CHORD_CHART' && (
                <div className="source-kind-selector">
                  <button
                    type="button"
                    className={`btn-source-mode ${
                      preservedDraftState.leadSheetSourceKind === 'LYRICS_TEXT' ? 'active' : ''
                    }`}
                    onClick={() =>
                      onUpdateDraftState((prev) => ({ ...prev, leadSheetSourceKind: 'LYRICS_TEXT' }))
                    }
                  >
                    Agregar / Alinear Letra con Acordes Existentes
                  </button>
                  <button
                    type="button"
                    className={`btn-source-mode ${
                      preservedDraftState.leadSheetSourceKind === 'CHORDPRO' ? 'active' : ''
                    }`}
                    onClick={() =>
                      onUpdateDraftState((prev) => ({ ...prev, leadSheetSourceKind: 'CHORDPRO' }))
                    }
                  >
                    Importar Contenido ChordPro (.cho)
                  </button>
                </div>
              )}

              {activeFormat === 'CHORD_CHART' && preservedDraftState.leadSheetSourceKind === 'CHORDPRO' ? (
                <div className="completion-input-group">
                  <label className="option-label" htmlFor="completion-chordpro-file">
                    Subir archivo .cho / .chordpro o editar contenido ChordPro:
                  </label>
                  <input
                    id="completion-chordpro-file"
                    type="file"
                    accept=".cho,.crd,.chordpro,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const txt = await file.text();
                      onUpdateDraftState((prev) => ({ ...prev, chordProText: txt }));
                    }}
                  />
                  <textarea
                    className="completion-textarea"
                    rows={7}
                    value={preservedDraftState.chordProText}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, chordProText: e.target.value }))
                    }
                    placeholder="{title: Nombre}&#10;{start_of_verse}&#10;[Em]Verso con [C]acordes [G]alineados"
                  />
                </div>
              ) : (
                <div className="completion-input-group">
                  <label className="option-label" htmlFor="completion-lyrics-file">
                    Importar archivo de texto (.txt) o escribir/pegar letra (admite etiquetas [Verso], [Coro]):
                  </label>
                  <input
                    id="completion-lyrics-file"
                    type="file"
                    accept=".txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const txt = await file.text();
                      onUpdateDraftState((prev) => ({
                        ...prev,
                        lyricsText: txt,
                        lyricsFilename: file.name,
                        lyricsSourceOrigin: 'TXT_IMPORT',
                      }));
                    }}
                  />
                  <textarea
                    className="completion-textarea"
                    rows={7}
                    value={preservedDraftState.lyricsText}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, lyricsText: e.target.value }))
                    }
                    placeholder="[Verso 1]&#10;El Señor está en este lugar&#10;[Coro]&#10;Santo, Santo es el Señor"
                  />

                  <div className="completion-options-row">
                    {activeFormat === 'CHORD_CHART' && (
                      <label className="option-field">
                        <span className="option-label">Modo de alineación con acordes:</span>
                        <select
                          className="option-input"
                          value={preservedDraftState.lyricsAlignmentMode}
                          onChange={(e) =>
                            onUpdateDraftState((prev) => ({
                              ...prev,
                              lyricsAlignmentMode: e.target.value as 'BY_MEASURE' | 'UNALIGNED',
                            }))
                          }
                        >
                          <option value="BY_MEASURE">Alinear líneas con compases existentes (BY_MEASURE)</option>
                          <option value="UNALIGNED">Guardar letra sin alinear aún (UNALIGNED — mantiene formato bloqueado)</option>
                        </select>
                      </label>
                    )}

                    <label className="option-field">
                      <span className="option-label">Procedencia de la letra:</span>
                      <select
                        className="option-input"
                        value={preservedDraftState.lyricsSourceOrigin}
                        onChange={(e) =>
                          onUpdateDraftState((prev) => ({
                            ...prev,
                            lyricsSourceOrigin: e.target.value as any,
                          }))
                        }
                      >
                        <option value="MANUAL_ENTRY">Ingresada manualmente por músico/director</option>
                        <option value="TXT_IMPORT">Importada desde archivo .txt oficial</option>
                        <option value="UNVERIFIED_AUDIO_SPEECH">Transcripción automática sin verificar (bloqueada hasta revisión)</option>
                      </select>
                    </label>
                  </div>

                  <label className="completion-checkbox-row">
                    <input
                      type="checkbox"
                      checked={preservedDraftState.lyricsVerifiedByHuman}
                      onChange={(e) =>
                        onUpdateDraftState((prev) => ({
                          ...prev,
                          lyricsVerifiedByHuman: e.target.checked,
                        }))
                      }
                    />
                    <span>Confirmo que el texto lírico corresponde fielmente a la canción y fue revisado manualmente.</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Flujo D: TABLATURE */}
          {activeFormat === 'TABLATURE' && (
            <div className="completion-workflow-panel">
              <div className="completion-options-row">
                <label className="option-field">
                  <span className="option-label">Instrumento de cuerda y afinación:</span>
                  <select
                    className="option-input"
                    value={preservedDraftState.tabInstrumentId}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, tabInstrumentId: e.target.value }))
                    }
                  >
                    {stringInstruments.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.name} — {inst.tuning?.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="option-field">
                  <span className="option-label">Traste de Cejilla (Capo):</span>
                  <input
                    className="option-input"
                    type="number"
                    min={0}
                    max={12}
                    value={preservedDraftState.tabCapoFret}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({
                        ...prev,
                        tabCapoFret: Math.max(0, Math.min(12, parseInt(e.target.value || '0', 10))),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="source-kind-selector">
                <button
                  type="button"
                  className={`btn-source-mode ${
                    preservedDraftState.tabSourceKind === 'EXISTING_NOTES_FRET_OVERRIDE' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateDraftState((prev) => ({ ...prev, tabSourceKind: 'EXISTING_NOTES_FRET_OVERRIDE' }))
                  }
                >
                  Revisar Posiciones sobre Notas Existentes ({songNotes.length})
                </button>
                <button
                  type="button"
                  className={`btn-source-mode ${
                    preservedDraftState.tabSourceKind === 'TABLATURE_ASCII' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateDraftState((prev) => ({ ...prev, tabSourceKind: 'TABLATURE_ASCII' }))
                  }
                >
                  Importar Tablatura ASCII (.tab)
                </button>
                <button
                  type="button"
                  className={`btn-source-mode ${
                    preservedDraftState.tabSourceKind === 'MUSICXML' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateDraftState((prev) => ({ ...prev, tabSourceKind: 'MUSICXML' }))
                  }
                >
                  Importar Notas MusicXML para Tablatura
                </button>
              </div>

              {preservedDraftState.tabSourceKind === 'TABLATURE_ASCII' && (
                <div className="completion-input-group">
                  <label className="option-label" htmlFor="completion-tab-file">
                    Subir archivo .tab o pegar tablatura ASCII:
                  </label>
                  <input
                    id="completion-tab-file"
                    type="file"
                    accept=".tab,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const txt = await file.text();
                      onUpdateDraftState((prev) => ({ ...prev, tabAsciiText: txt }));
                    }}
                  />
                  <textarea
                    className="completion-textarea"
                    rows={6}
                    value={preservedDraftState.tabAsciiText}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, tabAsciiText: e.target.value }))
                    }
                    placeholder="e|---0---2---3---|&#10;B|---1---3---0---|"
                  />
                </div>
              )}

              {preservedDraftState.tabSourceKind === 'MUSICXML' && (
                <div className="completion-input-group">
                  <textarea
                    className="completion-textarea"
                    rows={5}
                    value={preservedDraftState.musicXmlText}
                    onChange={(e) =>
                      onUpdateDraftState((prev) => ({ ...prev, musicXmlText: e.target.value }))
                    }
                    placeholder="<score-partwise version=&quot;4.0&quot;>...</score-partwise>"
                  />
                </div>
              )}

              {preservedDraftState.tabSourceKind === 'EXISTING_NOTES_FRET_OVERRIDE' && (
                <div className="completion-input-group">
                  {songNotes.length === 0 ? (
                    <div className="completion-diag-blocking">
                      No hay eventos de notas melódicas en la canción actual. Un símbolo de acorde no determina una digitación única; importe una tablatura ASCII o complete primero las notas melódicas en MusicXML/MIDI.
                    </div>
                  ) : (
                    <>
                      <div className="tablature-notes-review-list">
                        {songNotes.slice(0, 24).map(({ measureNumber, note, candidates }) => {
                          const currentOv = preservedDraftState.tabFretOverrides[note.id];
                          const best = TablatureCalculator.calculatePosition(
                            note.pitch,
                            tabInstrument.tuning!,
                            preservedDraftState.tabCapoFret
                          );
                          const selectedVal = currentOv
                            ? `${currentOv.stringNumber}:${currentOv.fret}`
                            : best
                            ? `${best.stringNumber}:${best.fret}`
                            : '';

                          return (
                            <div
                              key={note.id}
                              className={`tab-note-candidate-row ${candidates.length > 1 ? 'ambiguous' : ''} ${
                                candidates.length === 0 ? 'out-of-range' : ''
                              }`}
                            >
                              <span>
                                <strong>c.{measureNumber}</strong> {note.pitch.toString()}{' '}
                                {candidates.length > 1 ? '⚠️ (múltiples digitaciones)' : ''}
                              </span>
                              {candidates.length === 0 ? (
                                <span style={{ color: '#fca5a5', fontSize: '0.75rem' }}>
                                  Fuera de rango ({tabInstrument.tuning?.name})
                                </span>
                              ) : (
                                <select
                                  value={selectedVal}
                                  onChange={(e) => {
                                    const [strNum, fretNum] = e.target.value.split(':').map(Number);
                                    if (!strNum || fretNum === undefined || Number.isNaN(fretNum)) return;
                                    onUpdateDraftState((prev) => ({
                                      ...prev,
                                      tabFretOverrides: {
                                        ...prev.tabFretOverrides,
                                        [note.id]: { stringNumber: strNum, fret: fretNum },
                                      },
                                    }));
                                  }}
                                >
                                  {candidates.map((c) => (
                                    <option
                                      key={`${c.stringNumber}:${c.fret}`}
                                      value={`${c.stringNumber}:${c.fret}`}
                                    >
                                      Cuerda {c.stringNumber} • Traste {c.fret}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <label className="completion-checkbox-row">
                        <input
                          type="checkbox"
                          checked={preservedDraftState.tabVerified}
                          onChange={(e) =>
                            onUpdateDraftState((prev) => ({ ...prev, tabVerified: e.target.checked }))
                          }
                        />
                        <span>He revisado y validado las posiciones de cuerda y traste para este instrumento.</span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notas del Músico / Revisor */}
          <label className="option-field">
            <span className="option-label">Notas de procedencia / revisión (Auditoría):</span>
            <input
              type="text"
              className="option-input"
              value={preservedDraftState.reviewerNotes}
              onChange={(e) =>
                onUpdateDraftState((prev) => ({ ...prev, reviewerNotes: e.target.value }))
              }
              placeholder="Ej. Letra oficial tomada del himnario / tablatura revisada para guitarra acústica"
            />
          </label>

          {/* Mensajes de Error / Estado y Vista Previa de Capacidades */}
          {errorMessage && (
            <div className="uploader-alert alert-error" role="alert">
              <span>⚠️ {errorMessage}</span>
            </div>
          )}
          {statusMessage && (
            <div className="format-feedback success" role="status">
              <span>{statusMessage}</span>
            </div>
          )}

          {previewResult && (
            <div className="completion-preview-summary">
              <div>
                <strong>Previsualización:</strong> {previewResult.contentSummary.measureCount} compases •{' '}
                {previewResult.contentSummary.noteCount} notas • {previewResult.contentSummary.chordCount} acordes •{' '}
                {previewResult.contentSummary.lyricSyllableCount} sílabas
              </div>
              {previewResult.validationWarnings.length > 0 && (
                <div style={{ color: '#fcd34d', marginTop: '4px' }}>
                  ⚠️ Advertencias: {previewResult.validationWarnings.join(' | ')}
                </div>
              )}
            </div>
          )}

          {/* Botonera Principal de Completitud */}
          <div className="completion-actions-bar">
            <button
              type="button"
              className="btn-validate-preview"
              disabled={isBusy}
              onClick={() => void handleValidatePreview()}
            >
              🔍 Validar y Previsualizar
            </button>
            <button
              type="button"
              className="btn-submit-proposal"
              disabled={isBusy || !songId || !isAuthenticated}
              onClick={() => void handleSubmitProposal()}
              title={
                !songId
                  ? 'Disponible al abrir una canción persistida del catálogo BD'
                  : 'Guardar propuesta para revisión sin alterar la versión aprobada actual'
              }
            >
              💾 Guardar Borrador / Enviar a Revisión
            </button>
          </div>

          {/* Propuestas Pendientes de Aprobación Humana (RBAC) */}
          {relevantProposals.length > 0 && (
            <div className="completion-proposals-section">
              <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px' }}>
                📋 Propuestas de Completitud para {activeCap.label}:
              </div>
              {relevantProposals.map((prop) => (
                <div key={prop.proposalId} className="completion-proposal-card">
                  <div className="proposal-meta-row">
                    <span>
                      <strong>{prop.sourceFilename}</strong> • Estado: <code>{prop.reviewStatus}</code> • SHA-256:{' '}
                      <code>{prop.sourceHash.slice(0, 12)}...</code>
                    </span>
                    {prop.approvedVersionNumber && (
                      <span style={{ color: '#86efac' }}>✓ Versión v{prop.approvedVersionNumber}</span>
                    )}
                  </div>
                  {prop.notes && (
                    <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>Nota: {prop.notes}</div>
                  )}
                  {prop.reviewStatus === 'PENDING_REVIEW' && (
                    <div className="proposal-review-actions">
                      {canApproveAndPublish ? (
                        <>
                          <button
                            type="button"
                            className="btn-approve-proposal"
                            disabled={isBusy}
                            onClick={() => void handleReviewProposal(prop.proposalId, 'APPROVED')}
                          >
                            ✅ Aprobar y Publicar Nueva Versión (vN+1)
                          </button>
                          <button
                            type="button"
                            className="btn-reject-proposal"
                            disabled={isBusy}
                            onClick={() => void handleReviewProposal(prop.proposalId, 'REJECTED')}
                          >
                            ✕ Rechazar Propuesta
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: '0.76rem', color: '#fcd34d' }}>
                          🔒 Aguardando revisión: solo un Director de Alabanza o Administrador puede aprobar y publicar al catálogo oficial.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
