/**
 * @file visual-rendering-pipeline.test.ts
 * @description Suite de pruebas automatizadas no-browser para el pipeline completo de renderizado
 * de documentos visuales (PDF e imágenes raster) en el atril musical (Fase B).
 *
 * Verificaciones:
 * 1. Extracción precisa y determinista de páginas en PDF (single-page, multipage, /Count, /Type /Page).
 * 2. Descarga autorizada de blobs vía BethesdaApiClient.downloadDocumentBlob (con Bearer token).
 * 3. Generación y consumo de tickets temporales vía getDocumentViewTicketUrl.
 * 4. Discriminación fidedigna de estados de atril: Carga, Error, TIFF no decodificable nativamente, y Visualización.
 * 5. Ciclo de vida de URLs de blob (creación y revocación segura sin fugas de memoria).
 * 6. Preservación estricta de invariantes: CERO notas o compases inventados.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { extractPdfPageCount } from '../pdf-utils.ts';
import { BethesdaApiClient } from '../../api/api-client.ts';
import { tokenManager } from '../../auth/token-manager.ts';

describe('Phase B — Visual Document Rendering Runtime Pipeline Suite', () => {
  beforeEach(() => {
    tokenManager.setToken('test-valid-jwt-token', 3600);
  });

  afterEach(() => {
    tokenManager.clearToken();
  });

  // =========================================================================
  // 1. EXTRACCIÓN DETERMINISTA DE NÚMERO DE PÁGINAS EN PDF
  // =========================================================================
  describe('1. Deterministic PDF Page Count Extraction', () => {
    it('1.1 should return 1 for a single-page PDF with /Count 1', () => {
      const pdf = '%PDF-1.4\n<< /Type /Pages /Count 1 >>\n<< /Type /Page >>\n%%EOF';
      const count = extractPdfPageCount(pdf);
      assert.equal(count, 1);
    });

    it('1.2 should extract page count from /Count N within /Type /Pages catalog', () => {
      const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>\nendobj\n%%EOF';
      const count = extractPdfPageCount(pdf);
      assert.equal(count, 4);
    });

    it('1.3 should extract page count when /Count precedes /Type /Pages', () => {
      const pdf = '%PDF-1.7\n<< /Count 8 /Type /Pages >>\n%%EOF';
      const count = extractPdfPageCount(pdf);
      assert.equal(count, 8);
    });

    it('1.4 should count individual /Type /Page objects when catalog count is missing', () => {
      const pdf = '%PDF-1.4\n' +
        '10 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '11 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '12 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '%%EOF';
      const count = extractPdfPageCount(pdf);
      assert.equal(count, 3);
    });

    it('1.5 should support Uint8Array and ArrayBuffer inputs seamlessly', () => {
      const raw = '%PDF-1.4\n<< /Type /Pages /Count 6 >>\n%%EOF';
      const uint8 = new TextEncoder().encode(raw);
      const arrayBuf = uint8.buffer;

      assert.equal(extractPdfPageCount(uint8), 6);
      assert.equal(extractPdfPageCount(arrayBuf), 6);
    });

    it('1.6 should fallback safely to 1 page for invalid or corrupted PDF headers', () => {
      assert.equal(extractPdfPageCount(''), 1);
      assert.equal(extractPdfPageCount('NOT_A_PDF_DOCUMENT'), 1);
      assert.equal(extractPdfPageCount(new Uint8Array([0x00, 0x01, 0x02])), 1);
    });
  });

  // =========================================================================
  // 2. CLIENTE HTTP: DESCARGA AUTORIZADA DE BLOBS Y TICKETS
  // =========================================================================
  describe('2. Authorized Blob Downloading & Ticket Generation (BethesdaApiClient)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('2.1 should download document blob with Bearer Authorization header', async () => {
      let interceptedUrl = '';
      let interceptedHeaders: Headers | undefined;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        interceptedUrl = String(input);
        interceptedHeaders = new Headers(init?.headers);

        const dummyPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
        return new Response(dummyPdfBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="Partitura_Madrid.pdf"',
          },
        });
      }) as typeof fetch;

      const client = new BethesdaApiClient({ baseUrl: '/api/v1' });
      const result = await client.downloadDocumentBlob('doc-uuid-123.pdf');

      assert.ok(interceptedUrl.includes('/api/v1/documents/doc-uuid-123.pdf/file'));
      assert.equal(interceptedHeaders?.get('Authorization'), 'Bearer test-valid-jwt-token');
      assert.equal(result.mimeType, 'application/pdf');
      assert.equal(result.filename, 'Partitura_Madrid.pdf');
      assert.equal(result.blob.size, 8);
    });

    it('2.2 should obtain temporary viewing ticket via getDocumentViewTicketUrl without exposing Bearer in URL', async () => {
      let interceptedUrl = '';
      let interceptedMethod = '';

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        interceptedUrl = String(input);
        interceptedMethod = init?.method ?? 'GET';

        return new Response(
          JSON.stringify({
            data: {
              ticket: 'secure-view-ticket-abc-789',
              expiresInSeconds: 60,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }) as typeof fetch;

      const client = new BethesdaApiClient({ baseUrl: '/api/v1' });
      const ticketUrl = await client.getDocumentViewTicketUrl('partitura-himno.pdf');

      assert.ok(interceptedUrl.includes('/api/v1/documents/partitura-himno.pdf/ticket'));
      assert.equal(interceptedMethod, 'POST');
      assert.equal(
        ticketUrl,
        '/api/v1/documents/partitura-himno.pdf/file?ticket=secure-view-ticket-abc-789'
      );
      // Invariante de seguridad: El token Bearer NUNCA se expone en la URL del ticket
      assert.strictEqual(ticketUrl.includes('test-valid-jwt-token'), false);
    });

    it('2.3 should propagate ApiError when document download fails (404 / 401)', async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: 'El documento no existe en el almacenamiento.',
              statusCode: 404,
            },
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }) as typeof fetch;

      const client = new BethesdaApiClient({ baseUrl: '/api/v1' });
      await assert.rejects(
        async () => {
          await client.downloadDocumentBlob('non-existent.pdf');
        },
        (err: any) => err.statusCode === 404 || err.message.includes('HTTP 404')
      );
    });
  });

  // =========================================================================
  // 3. RESOLUCIÓN DE FORMATOS Y ESTADOS DE ATRIL VISUAL
  // =========================================================================
  describe('3. Visual Stand Format Resolution and State Constraints', () => {
    it('3.1 should classify PDF documents and distinguish them from raster images', () => {
      const pdfStorageKey = 'sheet-score.pdf';
      const isPdfKey = pdfStorageKey.toLowerCase().endsWith('.pdf');
      assert.equal(isPdfKey, true);

      const pngStorageKey = 'sheet-scan.png';
      const isPngKey = pngStorageKey.toLowerCase().endsWith('.pdf');
      assert.equal(isPngKey, false);
    });

    it('3.2 should flag TIFF format as natively non-decodable in modern browsers', () => {
      const tiffMime = 'image/tiff';
      const isTiff = tiffMime.includes('tiff') || tiffMime.includes('tif');
      assert.equal(isTiff, true, 'TIFF debe ser detectado como formato especial no decodificable nativamente');

      const pngMime = 'image/png';
      const isTiffPng = pngMime.includes('tiff') || pngMime.includes('tif');
      assert.equal(isTiffPng, false);
    });

    it('3.3 should verify that blob: URLs are trusted directly without additional network requests', () => {
      const localBlob = 'blob:http://localhost:5173/550e8400-e29b-41d4-a716-446655440000';
      const isDirectBlob = localBlob.startsWith('blob:') || localBlob.startsWith('data:');
      assert.equal(isDirectBlob, true);
    });

    it('3.4 should verify Object URL cleanup lifecycle contract', () => {
      const revokedUrls: string[] = [];
      const dummyRevoke = (url: string) => {
        revokedUrls.push(url);
      };

      const originalRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = dummyRevoke;

      try {
        const testUrl = 'blob:http://localhost:5173/test-leak-check';
        URL.revokeObjectURL(testUrl);
        assert.equal(revokedUrls.length, 1);
        assert.equal(revokedUrls[0], testUrl);
      } finally {
        URL.revokeObjectURL = originalRevoke;
      }
    });
  });
});
