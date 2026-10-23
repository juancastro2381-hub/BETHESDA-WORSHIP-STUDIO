/**
 * @file pdf-utils.ts
 * @description Utilidad determinista para extracción de número de páginas y metadatos de documentos PDF.
 * Compatible con Node.js y buffers de Fastify/Buffer sin dependencias externas pesadas.
 */

export function extractPdfPageCount(input: Uint8Array | ArrayBuffer | Buffer | string): number {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else if (Buffer.isBuffer(input)) {
    text = input.toString('latin1');
  } else {
    const uint8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const decoder = new TextDecoder('latin1');
    text = decoder.decode(uint8);
  }

  // 1. Intentar extraer de la estructura de catálogo /Pages (/Count N)
  const pagesCountRegex = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/;
  const matchPages = text.match(pagesCountRegex);
  if (matchPages && matchPages[1]) {
    const count = parseInt(matchPages[1], 10);
    if (!isNaN(count) && count > 0) return count;
  }

  // 2. Formato alternativo donde /Count precede a /Type /Pages
  const countPagesRegex = /\/Count\s+(\d+)[\s\S]*?\/Type\s*\/Pages/;
  const matchCount = text.match(countPagesRegex);
  if (matchCount && matchCount[1]) {
    const count = parseInt(matchCount[1], 10);
    if (!isNaN(count) && count > 0) return count;
  }

  // 3. Contar ocurrencias de objetos /Type /Page individuales
  const pageMatches = text.match(/\/Type\s*\/Page\b(?!\s*s)/g);
  if (pageMatches && pageMatches.length > 0) {
    return pageMatches.length;
  }

  // 4. Último recurso para cualquier /Count N en el documento
  const allCounts = Array.from(text.matchAll(/\/Count\s+(\d+)/g));
  if (allCounts.length > 0) {
    const counts = allCounts.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
    if (counts.length > 0) {
      const maxCount = Math.max(...counts);
      if (maxCount > 0) return maxCount;
    }
  }

  return 1;
}
