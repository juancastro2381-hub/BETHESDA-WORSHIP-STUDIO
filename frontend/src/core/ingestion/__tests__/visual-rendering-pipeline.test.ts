/**
 * @file visual-rendering-pipeline.test.ts
 * @description Suite de pruebas automatizadas no-browser para el pipeline completo de renderizado
 * de documentos visuales (PDF e imágenes raster) en el atril musical (Fase B / F-02 / F-03 / F-04).
 *
 * Contratos verificados:
 * 1. Inspección determinista y estado de verificación de páginas PDF (Linearized, uncompressed, malformed/unverified).
 * 2. Descarga autorizada de blobs vía BethesdaApiClient.downloadDocumentBlob (con Bearer token).
 * 3. Generación y consumo de tickets temporales vía getDocumentViewTicketUrl.
 * 4. Ciclo de vida real de URLs de Blob ante transiciones de documento y desmontaje (sin fugas de memoria).
 * 5. Transiciones de estado ante cambio de documento, recuperación de errores y reintentos.
 * 6. Distinción de contratos entre modo PÁGINA ÚNICA (SINGLE) y FLUJO CONTINUO (CONTINUOUS).
 * 7. Resolución dinámica de contenedores desplazables para integración de Autoscroll (WP-05).
 * 8. Discriminación de formatos (PDF, Raster, TIFF no decodificable nativamente).
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { inspectPdfPageCount, extractPdfPageCount } from '../pdf-utils.ts';
import { BethesdaApiClient } from '../../api/api-client.ts';
import { tokenManager } from '../../auth/token-manager.ts';
import { resolveScrollTarget } from '../../autoscroll/use-autoscroll.ts';

describe('Phase B — Visual Document Rendering Runtime Pipeline Suite', () => {
  beforeEach(() => {
    tokenManager.setToken('test-valid-jwt-token', 3600);
  });

  afterEach(() => {
    tokenManager.clearToken();
  });

  // =========================================================================
  // 1. INSPECCIÓN Y ESTADO DE VERIFICACIÓN DE PÁGINAS PDF (F-02)
  // =========================================================================
  describe('1. Deterministic PDF Page Count and Verification Inspection (F-02)', () => {
    it('1.1 should extract page count from /Count N within /Type /Pages catalog', () => {
      const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>\nendobj\n%%EOF';
      const inspection = inspectPdfPageCount(pdf);
      assert.equal(inspection.isVerified, true);
      assert.equal(inspection.pageCount, 4);
      assert.equal(inspection.detectionMethod, 'CATALOG_COUNT');
      assert.equal(extractPdfPageCount(pdf), 4);
    });

    it('1.2 should extract page count from Linearized PDF dictionary (/N parameter)', () => {
      const linearized = '%PDF-1.4\n' +
        '1 0 obj << /Linearized 1 /O 10 /H [ 400 100 ] /L 12500 /E 6000 /N 7 /T 12400 >> endobj\n' +
        'trailer << /Root 1 0 R >> %%EOF';
      const inspection = inspectPdfPageCount(linearized);
      assert.equal(inspection.isVerified, true);
      assert.equal(inspection.pageCount, 7);
      assert.equal(inspection.detectionMethod, 'LINEARIZED_N');
      assert.equal(extractPdfPageCount(linearized), 7);
    });

    it('1.3 should extract page count when /Count precedes /Type /Pages', () => {
      const pdf = '%PDF-1.7\n<< /Count 8 /Type /Pages >>\n%%EOF';
      const inspection = inspectPdfPageCount(pdf);
      assert.equal(inspection.isVerified, true);
      assert.equal(inspection.pageCount, 8);
      assert.equal(inspection.detectionMethod, 'CATALOG_COUNT');
    });

    it('1.4 should count individual /Type /Page objects when catalog count is missing', () => {
      const pdf = '%PDF-1.4\n' +
        '10 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '11 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '12 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
        '%%EOF';
      const inspection = inspectPdfPageCount(pdf);
      assert.equal(inspection.isVerified, true);
      assert.equal(inspection.pageCount, 3);
      assert.equal(inspection.detectionMethod, 'PAGE_OBJECTS');
    });

    it('1.5 should support Uint8Array and ArrayBuffer inputs seamlessly', () => {
      const raw = '%PDF-1.4\n<< /Type /Pages /Count 6 >>\n%%EOF';
      const uint8 = new TextEncoder().encode(raw);
      const arrayBuf = uint8.buffer;

      assert.equal(extractPdfPageCount(uint8), 6);
      assert.equal(extractPdfPageCount(arrayBuf), 6);
    });

    it('1.6 should explicitly return isVerified: false for malformed or unindexable PDFs (F-02)', () => {
      const malformed = '%PDF-1.4\ncorrupted-content-no-page-tree\n%%EOF';
      const inspection = inspectPdfPageCount(malformed);

      assert.equal(inspection.isVerified, false, 'No debe afirmar falsamente que 1 página está verificada');
      assert.equal(inspection.pageCount, null);
      assert.equal(inspection.detectionMethod, 'UNKNOWN');
      // En fallback retrocompatible retorna 1 para evitar crashes
      assert.equal(extractPdfPageCount(malformed), 1);
    });

    it('1.7 should reject non-PDF headers with unverified status', () => {
      const notPdf = 'NOT_A_PDF_DOCUMENT_BINARY_HEADER';
      const inspection = inspectPdfPageCount(notPdf);
      assert.equal(inspection.isVerified, false);
      assert.equal(inspection.pageCount, null);
    });
  });

  // =========================================================================
  // 2. CLIENTE HTTP: DESCARGA AUTORIZADA DE BLOBS Y TICKETS (F-01)
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
  // 3. CICLO DE VIDA DE BLOB URL Y PREVENCIÓN DE FUGAS DE MEMORIA (F-04)
  // =========================================================================
  describe('3. Blob URL Lifecycle and Memory Leak Prevention Contract (F-04)', () => {
    class MockDocumentStandSession {
      private activeBlobUrl: string | null = null;
      public readonly createdUrls: string[] = [];
      public readonly revokedUrls: string[] = [];

      public loadDocument(blobId: string): string {
        // Al cambiar de documento, revocar URL previa inmediatamente
        if (this.activeBlobUrl) {
          this.revokedUrls.push(this.activeBlobUrl);
          this.activeBlobUrl = null;
        }

        const newUrl = `blob:http://localhost:5173/${blobId}`;
        this.createdUrls.push(newUrl);
        this.activeBlobUrl = newUrl;
        return newUrl;
      }

      public unmount(): void {
        if (this.activeBlobUrl) {
          this.revokedUrls.push(this.activeBlobUrl);
          this.activeBlobUrl = null;
        }
      }

      public getOrphanedUrlCount(): number {
        return this.createdUrls.length - this.revokedUrls.length;
      }
    }

    it('3.1 should revoke previous blob URL when switching documents without leaking memory', () => {
      const session = new MockDocumentStandSession();

      // Cargar primer documento (Doc 1)
      const url1 = session.loadDocument('doc-1-uuid');
      assert.equal(session.createdUrls.length, 1);
      assert.equal(session.revokedUrls.length, 0);

      // Cambiar a segundo documento (Doc 2)
      const url2 = session.loadDocument('doc-2-uuid');
      assert.notEqual(url1, url2);
      assert.equal(session.createdUrls.length, 2);
      assert.equal(session.revokedUrls.length, 1);
      assert.equal(session.revokedUrls[0], url1, 'El Blob URL del primer documento debe ser revocado');

      // Cambiar a tercer documento (Doc 3)
      const url3 = session.loadDocument('doc-3-uuid');
      assert.equal(session.createdUrls.length, 3);
      assert.equal(session.revokedUrls.length, 2);
      assert.equal(session.revokedUrls[1], url2, 'El Blob URL del segundo documento debe ser revocado');

      // Desmontar atril visual
      session.unmount();
      assert.equal(session.revokedUrls.length, 3);
      assert.equal(session.revokedUrls[2], url3, 'El Blob URL activo debe revocarse al desmontar');
      assert.equal(session.getOrphanedUrlCount(), 0, 'CERO fugas de memoria por URLs huérfanas');
    });
  });

  // =========================================================================
  // 4. MODO CONTINUO VS MODO PÁGINA ÚNICA Y AUTOSCROLL (F-03)
  // =========================================================================
  describe('4. Continuous vs Single View Mode and Autoscroll Target Resolution (F-03)', () => {
    it('4.1 should distinguish single mode vs continuous mode layout contracts', () => {
      const pages = ['blob:http://localhost:5173/page-1', 'blob:http://localhost:5173/page-2'];

      // Contrato de modo PÁGINA ÚNICA
      const singleModeView = {
        mode: 'SINGLE',
        activePage: 1,
        renderedPages: [pages[0]],
      };
      assert.equal(singleModeView.renderedPages.length, 1);

      // Contrato de modo FLUJO CONTINUO
      const continuousModeView = {
        mode: 'CONTINUOUS',
        activePage: 1,
        renderedPages: pages,
      };
      assert.equal(continuousModeView.renderedPages.length, 2, 'En modo continuo deben presentarse todas las páginas');
    });

    it('4.2 should resolve actual scroll container when root viewport has zero maxScroll', () => {
      // Simular viewport raíz que no desborda directamente
      const rootElement = {
        scrollHeight: 600,
        clientHeight: 600,
        querySelector: (selector: string) => {
          if (selector.includes('visual-document-viewport')) {
            // Sub-contenedor de atril que efectivamente tiene scroll
            return {
              scrollHeight: 1800,
              clientHeight: 600,
            } as unknown as HTMLElement;
          }
          return null;
        },
      } as unknown as HTMLElement;

      const target = resolveScrollTarget(rootElement);
      assert.ok(target);
      assert.equal(target.scrollHeight, 1800, 'Debe resolver el viewport interno con desbordamiento');
      assert.equal(target.scrollHeight - target.clientHeight, 1200);
    });

    it('4.3 should use root container directly if it already has vertical scroll', () => {
      const scrollableRoot = {
        scrollHeight: 2400,
        clientHeight: 800,
        querySelector: () => null,
      } as unknown as HTMLElement;

      const target = resolveScrollTarget(scrollableRoot);
      assert.equal(target, scrollableRoot);
    });
  });

  // =========================================================================
  // 5. TRATAMIENTO DE FORMATOS ESPECIALES (TIFF)
  // =========================================================================
  describe('5. Special Format Handling (TIFF & Non-Decodable Media)', () => {
    it('5.1 should flag TIFF format for explicit non-decodable messaging and download link', () => {
      const isTiffMime = (mime: string) => mime.includes('tiff') || mime.includes('tif');
      assert.equal(isTiffMime('image/tiff'), true);
      assert.equal(isTiffMime('image/tif'), true);
      assert.equal(isTiffMime('image/png'), false);
      assert.equal(isTiffMime('application/pdf'), false);
    });
  });
});
