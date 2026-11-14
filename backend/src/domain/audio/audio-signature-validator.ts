/**
 * @file audio-signature-validator.ts
 * @description Validador unificado de firmas binarias de audio para el backend de Bethesda Worship Studio.
 * Espejo de frontend/src/core/conversion/audio-signature.ts y workers/audio_worker/signature_inspector.py.
 *
 * Principios:
 * 1. Inspección binaria profunda (cero confianza en extensión o MIME declarado).
 * 2. MP3 con ID3v2: valida la cabecera synchsafe y exige una trama MPEG subsiguiente válida.
 * 3. MP3 sin ID3: valida sincronización de trama MPEG-1/2/2.5 Layers I/II/III.
 * 4. Soporta WAV (RIFF/RIFX + WAVE), FLAC (fLaC), OGG (OggS), M4A (ftyp audio brands), AAC ADTS.
 * 5. Rechaza categoricamente la suplantación MIME (p.ej. ejecutables o HTML con extensión .mp3 o MIME audio/mpeg).
 */

import { ValidationError } from '../errors.ts';

export type AudioFormat = 'MP3' | 'WAV' | 'FLAC' | 'OGG' | 'M4A' | 'AAC';

export interface AudioSignatureResult {
  readonly valid: boolean;
  readonly format: AudioFormat | null;
  readonly mimeType: string | null;
  readonly hasId3v2: boolean;
  readonly id3TagSizeBytes: number;
  readonly mpegFrameOffset: number | null;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
  readonly bitrateKbps: number | null;
  readonly reason: string | null;
}

export interface MpegFrameHeader {
  readonly offset: number;
  readonly versionId: number;
  readonly layerId: number;
  readonly bitrateKbps: number;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly frameLength: number;
}

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const MPEG1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const MPEG2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];

const SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

const ADTS_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'aac ']);

function ascii(bytes: Uint8Array | Buffer, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function u32le(bytes: Uint8Array | Buffer, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
  );
}

function u16le(bytes: Uint8Array | Buffer, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function parseMpegFrameHeader(bytes: Uint8Array | Buffer, offset: number): MpegFrameHeader | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const b3 = bytes[offset + 3]!;

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionId = (b1 >> 3) & 0x03;
  const layerId = (b1 >> 1) & 0x03;
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const srIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;

  if (versionId === 1 || layerId === 0 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;

  const sampleRateHz = SAMPLE_RATES[versionId]![srIdx]!;
  const channels = channelMode === 3 ? 1 : 2;

  let bitrateKbps: number;
  let frameLength: number;
  if (versionId === 3) {
    if (layerId === 1) {
      bitrateKbps = MPEG1_L3[bitrateIdx]!;
      frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRateHz + padding);
    } else if (layerId === 2) {
      bitrateKbps = MPEG1_L2[bitrateIdx]!;
      frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRateHz + padding);
    } else {
      bitrateKbps = MPEG1_L1[bitrateIdx]!;
      frameLength = (Math.floor((12 * bitrateKbps * 1000) / sampleRateHz) + padding) * 4;
    }
  } else if (layerId === 1) {
    bitrateKbps = MPEG2_L3[bitrateIdx]!;
    frameLength = Math.floor((72 * bitrateKbps * 1000) / sampleRateHz + padding);
  } else if (layerId === 2) {
    bitrateKbps = MPEG2_L3[bitrateIdx]!;
    frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRateHz + padding);
  } else {
    bitrateKbps = MPEG2_L1[bitrateIdx]!;
    frameLength = (Math.floor((12 * bitrateKbps * 1000) / sampleRateHz) + padding) * 4;
  }

  if (bitrateKbps <= 0 || frameLength < 4) return null;
  return { offset, versionId, layerId, bitrateKbps, sampleRateHz, channels, frameLength };
}

export function parseId3v2TotalSize(bytes: Uint8Array | Buffer, offset = 0): number | null {
  if (offset < 0 || offset + 10 > bytes.length) return null;
  if (bytes[offset] !== 0x49 || bytes[offset + 1] !== 0x44 || bytes[offset + 2] !== 0x33) return null;
  if (bytes[offset + 3] === 0xff || bytes[offset + 4] === 0xff) return null;
  const flags = bytes[offset + 5]!;
  const s0 = bytes[offset + 6]!;
  const s1 = bytes[offset + 7]!;
  const s2 = bytes[offset + 8]!;
  const s3 = bytes[offset + 9]!;
  if (((s0 | s1 | s2 | s3) & 0x80) !== 0) return null;
  const body = ((s0 & 0x7f) << 21) | ((s1 & 0x7f) << 14) | ((s2 & 0x7f) << 7) | (s3 & 0x7f);
  const footer = flags & 0x10 ? 10 : 0;
  return 10 + body + footer;
}

function findFirstMpegFrame(bytes: Uint8Array | Buffer, start: number, maxScan: number): MpegFrameHeader | null {
  const end = Math.min(bytes.length - 3, start + maxScan);
  for (let i = Math.max(0, start); i < end; i++) {
    if (bytes[i] !== 0xff) continue;
    const hdr = parseMpegFrameHeader(bytes, i);
    if (!hdr) continue;
    const next = i + hdr.frameLength;
    if (next + 4 > bytes.length) return hdr;
    if (parseMpegFrameHeader(bytes, next)) return hdr;
  }
  return null;
}

function failure(reason: string, extra?: Partial<AudioSignatureResult>): AudioSignatureResult {
  return {
    valid: false,
    format: null,
    mimeType: null,
    hasId3v2: false,
    id3TagSizeBytes: 0,
    mpegFrameOffset: null,
    sampleRateHz: null,
    channels: null,
    bitrateKbps: null,
    reason,
    ...extra,
  };
}

function success(
  format: AudioFormat,
  mimeType: string,
  extra?: Partial<AudioSignatureResult>
): AudioSignatureResult {
  return {
    valid: true,
    format,
    mimeType,
    hasId3v2: false,
    id3TagSizeBytes: 0,
    mpegFrameOffset: null,
    sampleRateHz: null,
    channels: null,
    bitrateKbps: null,
    reason: null,
    ...extra,
  };
}

/**
 * Inspecciona bytes de audio crudo en memoria.
 */
export function inspectAudioSignature(bytes: Buffer | Uint8Array): AudioSignatureResult {
  if (!bytes || bytes.length < 4) {
    return failure('El archivo está vacío o es demasiado pequeño (< 4 bytes) para contener una cabecera de audio.');
  }

  // 1. WAV
  if (
    bytes.length >= 12 &&
    (ascii(bytes, 0, 4) === 'RIFF' || ascii(bytes, 0, 4) === 'RIFX') &&
    ascii(bytes, 8, 4) === 'WAVE'
  ) {
    let sampleRateHz: number | null = null;
    let channels: number | null = null;
    let bitrateKbps: number | null = null;
    let pos = 12;
    const limit = Math.min(bytes.length, 4096);
    while (pos + 8 <= limit) {
      const id = ascii(bytes, pos, 4);
      const size = u32le(bytes, pos + 4);
      if (id === 'fmt ' && size >= 16 && pos + 24 <= bytes.length) {
        channels = u16le(bytes, pos + 10);
        sampleRateHz = u32le(bytes, pos + 12);
        const byteRate = u32le(bytes, pos + 16);
        bitrateKbps = byteRate > 0 ? Math.round((byteRate * 8) / 1000) : null;
        break;
      }
      if (size === 0) break;
      pos += 8 + size + (size % 2);
    }
    return success('WAV', 'audio/wav', { sampleRateHz, channels, bitrateKbps });
  }

  // 2. FLAC
  if (ascii(bytes, 0, 4) === 'fLaC') {
    let sampleRateHz: number | null = null;
    let channels: number | null = null;
    if (bytes.length >= 21 && (bytes[4]! & 0x7f) === 0) {
      const packed = (bytes[18]! << 16) | (bytes[19]! << 8) | bytes[20]!;
      const sr = (packed >> 4) & 0xfffff;
      if (sr > 0) {
        sampleRateHz = sr;
        channels = ((packed >> 1) & 0x07) + 1;
      }
    }
    return success('FLAC', 'audio/flac', { sampleRateHz, channels });
  }

  // 3. OGG
  if (bytes.length >= 28 && ascii(bytes, 0, 4) === 'OggS' && bytes[4] === 0) {
    let sampleRateHz: number | null = null;
    let channels: number | null = null;
    if (bytes.length >= 44 && bytes[28] === 0x01 && ascii(bytes, 29, 6) === 'vorbis') {
      channels = bytes[39]!;
      sampleRateHz = u32le(bytes, 40);
    } else if (bytes.length >= 38 && ascii(bytes, 28, 8) === 'OpusHead') {
      channels = bytes[37]!;
      sampleRateHz = 48000;
    }
    return success('OGG', 'audio/ogg', { sampleRateHz, channels });
  }

  // 4. MP4 / M4A
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    if (M4A_BRANDS.has(ascii(bytes, 8, 4))) {
      return success('M4A', 'audio/mp4');
    }
    return failure(
      `Contenedor ISO-BMFF con marca "${ascii(bytes, 8, 4)}" no corresponde a un archivo de audio admitido (M4A/AAC).`
    );
  }

  // 5. MP3 con etiqueta(s) ID3v2 (soporta hasta 4 etiquetas ID3v2 consecutivas y relleno posterior)
  const firstId3 = parseId3v2TotalSize(bytes, 0);
  if (firstId3 !== null) {
    let totalId3 = firstId3;
    for (let chain = 0; chain < 3 && totalId3 + 10 <= bytes.length; chain++) {
      let zeroSkip = totalId3;
      while (zeroSkip < bytes.length && zeroSkip - totalId3 < 256 && bytes[zeroSkip] === 0x00) {
        zeroSkip++;
      }
      const nextId3 = parseId3v2TotalSize(bytes, zeroSkip);
      if (nextId3 === null) break;
      totalId3 = zeroSkip + nextId3;
    }

    const frame = findFirstMpegFrame(bytes, totalId3, 131072);
    if (frame) {
      return success('MP3', 'audio/mpeg', {
        hasId3v2: true,
        id3TagSizeBytes: totalId3,
        mpegFrameOffset: frame.offset,
        sampleRateHz: frame.sampleRateHz,
        channels: frame.channels,
        bitrateKbps: frame.bitrateKbps,
      });
    }
    return failure(
      'Se detectó una cabecera ID3v2, pero no se encontró ninguna trama de audio MPEG válida después de la etiqueta. ' +
        'El archivo no es un MP3 reproducible (una cabecera ID3 por sí sola no constituye audio).',
      { hasId3v2: true, id3TagSizeBytes: totalId3 }
    );
  }

  // 6. AAC ADTS crudo
  if (bytes.length >= 7 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) {
    const srIdx = (bytes[2]! >> 2) & 0x0f;
    const chCfg = ((bytes[2]! & 0x01) << 2) | ((bytes[3]! >> 6) & 0x03);
    const frameLen = ((bytes[3]! & 0x03) << 11) | (bytes[4]! << 3) | ((bytes[5]! >> 5) & 0x07);
    if (srIdx < ADTS_SAMPLE_RATES.length && frameLen >= 7) {
      return success('AAC', 'audio/aac', {
        sampleRateHz: ADTS_SAMPLE_RATES[srIdx]!,
        channels: chCfg > 0 ? chCfg : null,
        mpegFrameOffset: 0,
      });
    }
  }

  // 7. MP3 sin ID3 (sincronización de trama MPEG cruda)
  let skip = 0;
  while (skip < 4096 && skip < bytes.length && bytes[skip] === 0x00) skip++;
  const rawFrame = findFirstMpegFrame(bytes, skip, 4096);
  if (rawFrame) {
    return success('MP3', 'audio/mpeg', {
      mpegFrameOffset: rawFrame.offset,
      sampleRateHz: rawFrame.sampleRateHz,
      channels: rawFrame.channels,
      bitrateKbps: rawFrame.bitrateKbps,
    });
  }

  return failure(
    'El archivo no posee una firma válida (magic bytes) de audio: el contenido no coincide con ningún formato admitido ' +
      '(MP3 con/sin ID3, WAV, FLAC, OGG, M4A/AAC).'
  );
}

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.opus'];

export function hasAudioExtension(filename: string): boolean {
  const lower = (filename ?? '').toLowerCase().trim();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function audioFormatFamilyFromMime(mime: string | undefined | null): AudioFormat | 'GENERIC' | 'UNKNOWN' {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return 'GENERIC';
  if (
    m === 'audio/mpeg' ||
    m === 'audio/mp3' ||
    m === 'audio/x-mp3' ||
    m === 'audio/x-mpeg' ||
    m === 'audio/mpeg3' ||
    m === 'audio/x-mpeg-3'
  ) {
    return 'MP3';
  }
  if (m === 'audio/wav' || m === 'audio/wave' || m === 'audio/x-wav' || m === 'audio/vnd.wave') return 'WAV';
  if (m === 'audio/flac' || m === 'audio/x-flac') return 'FLAC';
  if (m === 'audio/ogg' || m === 'audio/opus' || m === 'application/ogg' || m === 'audio/vorbis') return 'OGG';
  if (m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/m4a' || m === 'audio/mp4a-latm') return 'M4A';
  if (m === 'audio/aac' || m === 'audio/aacp') return 'AAC';
  return 'UNKNOWN';
}

/**
 * Valida la firma binaria de un buffer y opcionalmente comprueba coherencia con el MIME declarado.
 * Lanza ValidationError si el archivo no es un audio admitido o si hay conflicto MIME.
 */
export function validateAudioBuffer(buffer: Buffer | Uint8Array, declaredMimeType?: string): AudioSignatureResult {
  const result = inspectAudioSignature(buffer);
  if (!result.valid || !result.format) {
    throw new ValidationError(
      result.reason ?? 'El archivo no posee una firma binaria de audio válida o está corrupto.'
    );
  }

  if (declaredMimeType) {
    const family = audioFormatFamilyFromMime(declaredMimeType);
    if (family !== 'GENERIC' && family !== 'UNKNOWN' && family !== result.format) {
      throw new ValidationError(
        `Inconsistencia MIME: el archivo contiene datos binarios ${result.format} pero fue declarado como '${declaredMimeType}'.`
      );
    }
  }

  return result;
}

/**
 * Función compatible con AudioIngestionAdapter.detectAudioFormatFromBytes().
 */
export function detectAudioFormatFromBytes(buffer: Buffer | Uint8Array): {
  format: AudioFormat;
  mimeType: string;
  durationEstimateSeconds?: number;
} {
  const result = validateAudioBuffer(buffer);
  let durationEstimateSeconds: number | undefined;

  if (result.format === 'WAV' && buffer.length >= 32) {
    try {
      const byteRate = u32le(buffer, 28);
      if (byteRate > 0) {
        durationEstimateSeconds = Math.round((buffer.length - 44) / byteRate);
      }
    } catch {
      // Ignorar fallo de estimación
    }
  } else if (result.format === 'MP3' && result.bitrateKbps && result.bitrateKbps > 0) {
    const audioBytes = buffer.length - result.id3TagSizeBytes;
    if (audioBytes > 0) {
      durationEstimateSeconds = Math.round((audioBytes * 8) / (result.bitrateKbps * 1000));
    }
  }

  return {
    format: result.format!,
    mimeType: result.mimeType!,
    ...(durationEstimateSeconds !== undefined ? { durationEstimateSeconds } : {}),
  };
}
