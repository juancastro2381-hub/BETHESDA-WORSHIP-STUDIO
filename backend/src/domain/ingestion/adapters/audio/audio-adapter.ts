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
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class AudioIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'AUDIO' as const;
  public readonly name = 'Bethesda Universal Audio Asset Importer';
  public readonly version = '1.1.0';

  private readonly storageProvider: ISourceStorageProvider;

  public constructor(storageProvider?: ISourceStorageProvider) {
    this.storageProvider = storageProvider ?? new LocalFileSystemSourceStorageProvider();
  }

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'AUDIO') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (['.wav', '.mp3', '.m4a', '.flac', '.aac', '.ogg'].includes(ext)) return true;
    }
    if (input.mimeType && input.mimeType.startsWith('audio/')) return true;
    return false;
  }

  public detectMimeType(buffer: Buffer): string {
    const info = AudioIngestionAdapter.detectAudioFormatFromBytes(buffer);
    if (info.format === 'WAV') return 'audio/wav';
    if (info.format === 'MP3') return 'audio/mpeg';
    if (info.format === 'FLAC') return 'audio/flac';
    if (info.format === 'M4A') return 'audio/mp4';
    return 'audio/octet-stream';
  }

  /**
   * Detecta y valida rigurosamente las firmas binarias de archivos de audio.
   * Rechaza categoricamente la suplantación MIME.
   */
  public static detectAudioFormatFromBytes(buffer: Buffer): { format: string; durationEstimateSeconds?: number } {
    if (!buffer || buffer.length < 12) {
      throw new ValidationError('El buffer de audio es demasiado pequeño o está corrupto (< 12 bytes).');
    }

    // 1. WAV: 'RIFF' .... 'WAVE'
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // RIFF
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45 // WAVE
    ) {
      let durationEstimate: number | undefined;
      try {
        const byteRate = buffer.readUInt32LE(28);
        if (byteRate > 0) {
          durationEstimate = Math.round((buffer.length - 44) / byteRate);
        }
      } catch {
        // Ignorar fallo de estimación
      }
      return { format: 'WAV', durationEstimateSeconds: durationEstimate };
    }

    // 2. MP3: ID3v2 ('ID3') o sync word (0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2 / 0xFF 0xFA)
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
      return { format: 'MP3' };
    }

    // 3. FLAC: 'fLaC' (0x66 0x4C 0x61 0x43)
    if (
      buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43
    ) {
      return { format: 'FLAC' };
    }

    // 4. M4A/AAC: 'ftyp' en offset 4
    if (
      buffer.length >= 8 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
    ) {
      return { format: 'M4A' };
    }

    // Si los bytes no coinciden con ninguna firma válida, RECHAZAR aunque el MIME declarado diga audio/
    throw new ValidationError(
      'Firma binaria de archivo de audio no reconocida o corrupta. El contenido del archivo no coincide con ningún formato de audio admitido (WAV, MP3, FLAC, M4A).'
    );
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer del archivo de audio está vacío o no fue suministrado.');
    }

    const filename = input.filename || 'pista_audio.wav';

    // 1. Validar firmas binarias reales (NO confiar solo en el MIME del cliente)
    const audioInfo = AudioIngestionAdapter.detectAudioFormatFromBytes(input.buffer);

    // 2. Si el cliente declaró un MIME explícito, verificar coherencia
    if (input.mimeType && input.mimeType.startsWith('audio/')) {
      const declared = input.mimeType.toLowerCase();
      if (audioInfo.format === 'WAV' && !declared.includes('wav')) {
        throw new ValidationError(`Inconsistencia MIME: el archivo contiene datos WAV pero se declaró como '${input.mimeType}'.`);
      }
      if (audioInfo.format === 'MP3' && !declared.includes('mpeg') && !declared.includes('mp3')) {
        throw new ValidationError(`Inconsistencia MIME: el archivo contiene datos MP3 pero se declaró como '${input.mimeType}'.`);
      }
    }

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
