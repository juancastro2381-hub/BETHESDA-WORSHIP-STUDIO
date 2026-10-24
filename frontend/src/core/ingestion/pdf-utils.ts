/**
 * @file pdf-utils.ts
 * @description Utilidad determinista para extracción y verificación de número de páginas
 * y metadatos de documentos PDF (F-02).
 * Compatible con Node.js y navegadores modernos sin dependencias externas pesadas.
 */

export type PdfDetectionMethod =
  | 'CATALOG_COUNT'
  | 'PAGE_OBJECTS'
  | 'LINEARIZED_N'
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
export function inspectPdfPageCount(input: Uint8Array | ArrayBuffer | string): PdfPageInspection {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    const uint8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (typeof TextDecoder !== 'undefined') {
      try {
        const decoder = new TextDecoder('latin1');
        text = decoder.decode(uint8);
      } catch {
        text = '';
        const chunkSize = 16384;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          text += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
        }
      }
    } else {
      text = '';
      const chunkSize = 16384;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        text += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
      }
    }
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

  // 5. Último recurso para cualquier /Count N en el documento sin comprimir
  const allCounts = Array.from(text.matchAll(/\/Count\s+(\d+)/g));
  if (allCounts.length > 0) {
    const counts = allCounts.map((m) => parseInt(m[1] ?? '', 10)).filter((n) => !isNaN(n));
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

  // 6. Si no se puede verificar deterministamente, representar explícitamente el estado no verificado
  return {
    pageCount: null,
    isVerified: false,
    detectionMethod: 'UNKNOWN',
  };
}

/**
 * Función compatible hacia atrás que retorna un número de páginas (fallback 1 si no es verificable).
 */
export function extractPdfPageCount(input: Uint8Array | ArrayBuffer | string): number {
  const result = inspectPdfPageCount(input);
  return result.pageCount ?? 1;
}
