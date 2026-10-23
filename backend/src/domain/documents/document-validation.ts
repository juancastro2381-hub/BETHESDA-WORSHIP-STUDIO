/**
 * @file document-validation.ts
 * @description Validación server-side de firmas binarias ("magic bytes"), tipos MIME, límites de tamaño
 * y saneamiento estricto de nombres de archivo para documentos visuales (PDF, PNG, JPG, WEBP, TIFF) (Fase B).
 */

import path from 'node:path';
import { ValidationError } from '../errors.ts';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES,
  type DocumentDetectedFormat,
} from './document-types.ts';

/**
 * Sanea el nombre original del archivo para prevenir ataques de Path Traversal,
 * caracteres de control o inyección en encabezados HTTP.
 */
export function sanitizeSafeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'partitura_importada';
  }

  // Normalizar barras invertidas a barras diagonales para manejo consistente en Windows y Linux
  const normalized = filename.replace(/\\/g, '/');
  const base = path.posix.basename(normalized).trim();

  // Reemplazar caracteres peligrosos o de control preservando letras, números, guiones, puntos y espacios
  const sanitized = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/_+/g, '_') // colapsar guiones bajos repetidos
    .replace(/\.+/g, '.') // prevenir dobles puntos consecutivos
    .trim();

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return 'partitura_importada';
  }

  // Limitar longitud a 255 caracteres
  return sanitized.length > 255 ? sanitized.slice(0, 255) : sanitized;
}

/**
 * Valida la firma binaria real ("magic bytes") del archivo contra el tipo MIME declarado
 * para prevenir suplantación (MIME spoofing), ejecutables camuflados o archivos corruptos.
 */
export function validateDocumentFileSignature(
  buffer: Buffer,
  mimeType: string,
  maxSizeBytes: number = DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES
): DocumentDetectedFormat {
  if (!buffer || buffer.length < 8) {
    throw new ValidationError(
      'El archivo es demasiado pequeño o está dañado para contener una cabecera de documento válida (mínimo 8 bytes).'
    );
  }

  if (buffer.length > maxSizeBytes) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    throw new ValidationError(
      `El documento (${sizeMb} MB) supera el límite máximo permitido de ${maxMb} MB configurado para el sistema.`
    );
  }

  const normalizedMime = (mimeType || '').toLowerCase().trim();

  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(normalizedMime)) {
    throw new ValidationError(
      `Tipo MIME no soportado: '${mimeType}'. Formatos permitidos: PDF (.pdf) e imágenes raster (.png, .jpg, .jpeg, .webp, .tiff).`
    );
  }

  // 1. PDF: Debe iniciar exactamente con "%PDF-" (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (normalizedMime === 'application/pdf') {
    const isPdf =
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2d;

    if (!isPdf) {
      throw new ValidationError(
        'Firma binaria de PDF inválida (no inicia con el encabezado %PDF-). Posible archivo corrupto o suplantación MIME.'
      );
    }
    return 'PDF';
  }

  // 2. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (normalizedMime === 'image/png') {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;

    if (!isPng) {
      throw new ValidationError(
        'Firma binaria de imagen PNG inválida. El contenido binario no coincide con la cabecera estándar de PNG.'
      );
    }
    return 'IMAGE';
  }

  // 3. JPEG / JPG: 0xFF 0xD8 0xFF
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    if (!isJpeg) {
      throw new ValidationError(
        'Firma binaria de imagen JPEG/JPG inválida. El contenido binario no coincide con la cabecera estándar de JPEG.'
      );
    }
    return 'IMAGE';
  }

  // 4. TIFF: "II*\0" (little-endian: 0x49 0x49 0x2A 0x00) o "MM\0*" (big-endian: 0x4D 0x4D 0x00 0x2A)
  if (normalizedMime === 'image/tiff') {
    const isTiffLE =
      buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
    const isTiffBE =
      buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;

    if (!isTiffLE && !isTiffBE) {
      throw new ValidationError(
        'Firma binaria de imagen TIFF inválida. El contenido binario no coincide con la cabecera estándar de TIFF.'
      );
    }
    return 'IMAGE';
  }

  // 5. WEBP: Comienza con 'RIFF' (bytes 0..3) y contiene 'WEBP' (bytes 8..11)
  if (normalizedMime === 'image/webp') {
    const isRiff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
    const isWebp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isRiff || !isWebp) {
      throw new ValidationError(
        'Firma binaria de imagen WEBP inválida. El contenido binario no coincide con el contenedor RIFF/WEBP.'
      );
    }
    return 'IMAGE';
  }

  throw new ValidationError(`Formato de archivo no reconocido o no soportado: '${mimeType}'.`);
}
