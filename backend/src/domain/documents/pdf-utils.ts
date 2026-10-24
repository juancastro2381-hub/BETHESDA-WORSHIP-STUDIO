/**
 * @file pdf-utils.ts
 * @description Utilidad determinista para extracción y verificación de número de páginas
 * y metadatos en documentos PDF reales, incluyendo streams de objetos comprimidos (FlateDecode)
 * y diccionarios de linearización (F-02).
 */

import zlib from 'node:zlib';

export type PdfDetectionMethod =
  | 'CATALOG_COUNT'
  | 'PAGE_OBJECTS'
  | 'LINEARIZED_N'
  | 'OBJSTM_DEFLATE'
  | 'UNKNOWN';

export interface PdfPageInspection {
  readonly pageCount: number | null;
  readonly isVerified: boolean;
  readonly detectionMethod: PdfDetectionMethod;
}

/**
 * Inspecciona un documento PDF y determina su número de páginas de manera estricta y verificable.
 * Si el número de páginas no puede verificarse de forma concluyente, retorna isVerified: false
 * en lugar de afirmar silenciosamente que es un documento de una página.
 */
export function inspectPdfPageCount(input: Uint8Array | ArrayBuffer | Buffer | string): PdfPageInspection {
  let text: string;
  let rawBuf: Buffer;

  if (typeof input === 'string') {
    text = input;
    rawBuf = Buffer.from(input, 'latin1');
  } else if (Buffer.isBuffer(input)) {
    rawBuf = input;
    text = input.toString('latin1');
  } else {
    const uint8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    rawBuf = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    text = rawBuf.toString('latin1');
  }

  // Validación básica de encabezado PDF (%PDF-)
  if (!text.includes('%PDF-')) {
    return {
      pageCount: null,
      isVerified: false,
      detectionMethod: 'UNKNOWN',
    };
  }

  // 1. Diccionario de Linearización (/Linearized 1 ... /N <numPages>)
  const linearizedMatch = text.match(/\/Linearized\b[\s\S]{0,350}?\/N\s+(\d+)/) ||
                          text.match(/\/N\s+(\d+)[\s\S]{0,350}?\/Linearized\b/);
  if (linearizedMatch && linearizedMatch[1]) {
    const count = parseInt(linearizedMatch[1], 10);
    if (!isNaN(count) && count > 0) {
      return {
        pageCount: count,
        isVerified: true,
        detectionMethod: 'LINEARIZED_N',
      };
    }
  }

  // 2. Estructura estándar de catálogo /Pages (/Count N)
  const pagesCountRegex = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/;
  const matchPages = text.match(pagesCountRegex);
  if (matchPages && matchPages[1]) {
    const count = parseInt(matchPages[1], 10);
    if (!isNaN(count) && count > 0) {
      return {
        pageCount: count,
        isVerified: true,
        detectionMethod: 'CATALOG_COUNT',
      };
    }
  }

  // 3. Formato alternativo donde /Count precede a /Type /Pages
  const countPagesRegex = /\/Count\s+(\d+)[\s\S]*?\/Type\s*\/Pages/;
  const matchCount = text.match(countPagesRegex);
  if (matchCount && matchCount[1]) {
    const count = parseInt(matchCount[1], 10);
    if (!isNaN(count) && count > 0) {
      return {
        pageCount: count,
        isVerified: true,
        detectionMethod: 'CATALOG_COUNT',
      };
    }
  }

  // 4. Conteo de objetos de página individuales (/Type /Page)
  const pageMatches = text.match(/\/Type\s*\/Page\b(?!\s*s)/g);
  if (pageMatches && pageMatches.length > 0) {
    return {
      pageCount: pageMatches.length,
      isVerified: true,
      detectionMethod: 'PAGE_OBJECTS',
    };
  }

  // 5. Inspección de Object Streams comprimidos (/Type /ObjStm con /Filter /FlateDecode)
  try {
    const streamToken = Buffer.from('stream');
    const endstreamToken = Buffer.from('endstream');
    let searchPos = 0;

    while (searchPos < rawBuf.length) {
      const streamIdx = rawBuf.indexOf(streamToken, searchPos);
      if (streamIdx === -1) break;

      const endstreamIdx = rawBuf.indexOf(endstreamToken, streamIdx + 6);
      if (endstreamIdx === -1) break;

      // Localizar inicio de datos binarios tras el salto de línea de 'stream'
      let dataStart = streamIdx + 6;
      if (rawBuf[dataStart] === 0x0d && rawBuf[dataStart + 1] === 0x0a) {
        dataStart += 2;
      } else if (rawBuf[dataStart] === 0x0a || rawBuf[dataStart] === 0x0d) {
        dataStart += 1;
      }

      let dataEnd = endstreamIdx;
      if (dataEnd > dataStart && (rawBuf[dataEnd - 1] === 0x0a || rawBuf[dataEnd - 1] === 0x0d)) {
        dataEnd -= 1;
        if (dataEnd > dataStart && rawBuf[dataEnd - 1] === 0x0d) dataEnd -= 1;
      }

      if (dataEnd > dataStart) {
        const streamSlice = rawBuf.subarray(dataStart, dataEnd);
        try {
          const decompressed = zlib.inflateSync(streamSlice).toString('latin1');
          
          // Buscar /Count N dentro del stream descomprimido
          const matchCountInStream = decompressed.match(/\/Count\s+(\d+)/);
          if (matchCountInStream && matchCountInStream[1]) {
            const count = parseInt(matchCountInStream[1], 10);
            if (!isNaN(count) && count > 0) {
              return {
                pageCount: count,
                isVerified: true,
                detectionMethod: 'OBJSTM_DEFLATE',
              };
            }
          }

          // Buscar /Type /Page dentro del stream descomprimido
          const pagesInStream = decompressed.match(/\/Type\s*\/Page\b(?!\s*s)/g);
          if (pagesInStream && pagesInStream.length > 0) {
            return {
              pageCount: pagesInStream.length,
              isVerified: true,
              detectionMethod: 'OBJSTM_DEFLATE',
            };
          }
        } catch {
          // El stream actual no era FlateDecode o era una imagen/fuente binaria; continuar con el siguiente
        }
      }

      searchPos = endstreamIdx + 9;
    }
  } catch {
    // Continuar con los métodos de respaldo
  }

  // 6. Último recurso para cualquier /Count N en el texto sin comprimir
  const allCounts = Array.from(text.matchAll(/\/Count\s+(\d+)/g));
  if (allCounts.length > 0) {
    const counts = allCounts.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
    if (counts.length > 0) {
      const maxCount = Math.max(...counts);
      if (maxCount > 0) {
        return {
          pageCount: maxCount,
          isVerified: true,
          detectionMethod: 'CATALOG_COUNT',
        };
      }
    }
  }

  // 7. Si no se puede verificar deterministamente, representar explícitamente el estado no verificado
  return {
    pageCount: null,
    isVerified: false,
    detectionMethod: 'UNKNOWN',
  };
}

/**
 * Función compatible hacia atrás que retorna un número de páginas (fallback 1 si no es verificable).
 */
export function extractPdfPageCount(input: Uint8Array | ArrayBuffer | Buffer | string): number {
  const result = inspectPdfPageCount(input);
  return result.pageCount ?? 1;
}
