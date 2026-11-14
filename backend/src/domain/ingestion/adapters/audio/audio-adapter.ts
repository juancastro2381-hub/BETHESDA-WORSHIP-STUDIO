/**
 * @file audio-adapter.ts
 * @description Adaptador universal para ingesta y preservación de archivos de audio (MP3, WAV, FLAC, M4A).
 *
 * Principios (Fase 1B-R):
 * 1. Inspección estricta de firmas mágicas binarias (Magic Bytes) independientemente del MIME declarado por el cliente.
 * 2. Rechazo de archivos ejecutables, HTML o binarios arbitrarios disfrazados con MIME de audio.
 * 3. Preservación física inmutable de los bytes originales con checksum criptográfico SHA-256.
 * 4. CERO invención de notas melódicas, acordes, clave o tempo (defaultKey: null, defaultBpm: null, timeSignature: null).
 * 5. CERO reporte de transcripción completada sin un motor real de inferencia.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type { ISourceStorageProvider } from '../../source-storage-provider.ts';
import { LocalFileSystemSourceStorageProvider } from '../../source-storage-provider.ts';
import {
  detectAudioFormatFromBytes as validatorDetectAudioFormat,
  validateAudioBuffer,
} from '../../../audio/audio-signature-validator.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class AudioIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'AUDIO' as const;
  public readonly name = 'Bethesda Universal Audio Asset Importer';
  public readonly version = '1.2.0';

  private readonly storageProvider: ISourceStorageProvider;

  public constructor(storageProvider?: ISourceStorageProvider) {
    this.storageProvider = storageProvider ?? new LocalFileSystemSourceStorageProvider();
  }

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'AUDIO') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (['.wav', '.mp3', '.m4a', '.flac', '.aac', '.ogg', '.opus'].includes(ext)) return true;
    }
    if (input.mimeType && input.mimeType.startsWith('audio/')) return true;
    return false;
  }

  public detectMimeType(buffer: Buffer): string {
    const info = AudioIngestionAdapter.detectAudioFormatFromBytes(buffer);
    return info.mimeType;
  }

  /**
   * Detecta y valida rigurosamente las firmas binarias de archivos de audio.
   * Rechaza categoricamente la suplantación MIME.
   */
  public static detectAudioFormatFromBytes(buffer: Buffer): {
    format: string;
    mimeType: string;
    durationEstimateSeconds?: number;
  } {
    return validatorDetectAudioFormat(buffer);
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer del archivo de audio está vacío o no fue suministrado.');
    }

    const filename = input.filename || 'pista_audio.wav';

    // 1. Validar firmas binarias reales y coherencia con el MIME declarado (NO confiar solo en el MIME del cliente)
    const audioInfo = validateAudioBuffer(input.buffer, input.mimeType);

    // 3. Preservar físicamente el archivo
    const saveResult = await this.storageProvider.save(filename, input.buffer);
    const sourceHash = saveResult.checksumSha256;
    const diagnostics: IngestionDiagnostic[] = [];

    // Extraer título base
    const baseTitle = input.filename ? path.basename(input.filename, path.extname(input.filename)) : '';
    const title = input.title?.trim() || baseTitle || `Pista de Audio (${audioInfo.format})`;

    // 4. Verificar disponibilidad del motor de transcripción
    const hasAudioTranscriptionEngine = process.env.AUDIO_TRANSCRIPTION_ENGINE_CONFIGURED === 'true';

    const statusMessage = hasAudioTranscriptionEngine
      ? 'Pista de audio registrada y encolada para transcripción polifónica.'
      : 'Motor de transcripción de audio a notas/cifrado no configurado en este servidor. El archivo de audio original se ha preservado de forma inmutable para reproducción.';

    diagnostics.push({
      code: hasAudioTranscriptionEngine ? 'AUDIO_TRANSCRIPTION_QUEUED' : 'RECOGNITION_ENGINE_UNAVAILABLE',
      severity: hasAudioTranscriptionEngine ? 'INFO' : 'WARNING',
      message: statusMessage,
    });

    return {
      status: hasAudioTranscriptionEngine ? 'RECOGNITION_PENDING' : 'RECOGNITION_UNAVAILABLE',
      sourceType: 'AUDIO',
      sourceHash,
      filename,
      storageKey: saveResult.storageKey,
      title,
      artist: input.artist || null,
      defaultKey: null, // CERO CLAVES INVENTADAS
      defaultBpm: null, // CERO TEMPOS INVENTADOS
      timeSignature: null, // CERO MÉTRICAS INVENTADAS
      canonicalPayload: null, // CERO PARTITURA CANÓNICA FALSA
      diagnostics,
      recognitionStatusMessage: statusMessage,
    };
  }
}
