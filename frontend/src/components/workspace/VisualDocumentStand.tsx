/**
 * @file VisualDocumentStand.tsx
 * @description Componente accesible para lectura de partituras y documentos visuales (PDF e imágenes) en el atril digital (Fase B / F-02 / F-03).
 *
 * Características avanzadas:
 * - Soporte de recuperación autenticada de documentos seguros vía Blob en memoria (zero 401 auth errors).
 * - Distinción fidedigna entre modo PÁGINA ÚNICA (SINGLE) y FLUJO CONTINUO (CONTINUOUS):
 *   * En modo CONTINUOUS con imágenes multipágina, renderiza la secuencia completa en pila vertical
 *     con tarjetas de página y numeración visible, permitiendo autoscroll continuo (WP-05).
 *   * En modo CONTINUOUS con PDF, habilita el flujo de documento continuo nativo con scroll vertical y anclaje por página.
 *   * En modo SINGLE, aísla estrictamente la página activa en pantalla.
 * - Manejo explícito de estado de verificación de páginas (isVerified): si el PDF tiene páginas no indexadas o comprimidas,
 *   no bloquea la navegación ni afirma falsamente "de 1", permitiendo avanzar libremente.
 * - Desplazamiento inteligente entre páginas en modo continuo (smooth scroll al elemento de página).
 * - Controles ergonómicos de zoom (Ajustar al ancho, 50% a 200%) y rotación (0°, 90°, 180°, 270°).
 * - Tratamiento explícito de TIFF con aviso descriptivo y descarga del archivo original.
 * - Ciclo de vida estricto con revocación automática de Object URLs para evitar fugas de memoria.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BethesdaApiClient } from '../../core/api/api-client.ts';
import { inspectPdfPageCount, extractPdfPageCount } from '../../core/ingestion/pdf-utils.ts';

export interface VisualDocumentStandProps {
  readonly title: string;
  readonly documentUrl?: string | undefined;
  readonly storageKey?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly pageCount?: number | undefined;
  readonly pages?: readonly string[] | undefined;
  readonly isSample?: boolean | undefined;
  readonly onPageChange?: ((page: number) => void) | undefined;
}

export const VisualDocumentStand: React.FC<VisualDocumentStandProps> = ({
  title,
  documentUrl,
  storageKey,
  mimeType = 'application/pdf',
  pageCount = 1,
  pages,
  isSample = false,
  onPageChange,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'SINGLE' | 'CONTINUOUS'>('CONTINUOUS');

  const [resolvedBlobUrl, setResolvedBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedPageCount, setDetectedPageCount] = useState<number>(pageCount || 1);
  const [isPageCountVerified, setIsPageCountVerified] = useState<boolean>(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const createdBlobUrlRef = useRef<string | null>(null);

  const isPdf =
    mimeType.toLowerCase().includes('pdf') ||
    (storageKey && storageKey.toLowerCase().endsWith('.pdf')) ||
    (documentUrl && documentUrl.toLowerCase().includes('.pdf'));

  const isTiff =
    mimeType.toLowerCase().includes('tiff') ||
    mimeType.toLowerCase().includes('tif') ||
    (storageKey && (storageKey.toLowerCase().endsWith('.tif') || storageKey.toLowerCase().endsWith('.tiff'))) ||
    (documentUrl && (documentUrl.toLowerCase().includes('.tif') || documentUrl.toLowerCase().includes('.tiff')));

  // SVG de partitura de muestra de alta fidelidad para pruebas directas en atril visual
  const sampleScoreSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" width="100%" height="100%" style="background:#ffffff; font-family:sans-serif;">
      <text x="400" y="70" font-size="28" font-weight="bold" text-anchor="middle" fill="#0f172a">GRANDE ES TU FIDELIDAD</text>
      <text x="400" y="100" font-size="16" font-style="italic" text-anchor="middle" fill="#475569">Arreglo para Alabanza y Adoración — Bethesda Madrid</text>
      <text x="100" y="140" font-size="14" font-weight="bold" fill="#0f172a">Tono: D Mayor  |  Tempo: ♩ = 84  |  Compás: 3/4</text>
      <text x="700" y="140" font-size="14" text-anchor="end" fill="#64748b">Página 1 de 2</text>

      <g stroke="#334155" stroke-width="1.5">
        <line x1="80" y1="180" x2="720" y2="180"/>
        <line x1="80" y1="195" x2="720" y2="195"/>
        <line x1="80" y1="210" x2="720" y2="210"/>
        <line x1="80" y1="225" x2="720" y2="225"/>
        <line x1="80" y1="240" x2="720" y2="240"/>
        <line x1="80" y1="180" x2="80" y2="240" stroke-width="2"/>
        <line x1="240" y1="180" x2="240" y2="240"/>
        <line x1="400" y1="180" x2="400" y2="240"/>
        <line x1="560" y1="180" x2="560" y2="240"/>
        <line x1="720" y1="180" x2="720" y2="240" stroke-width="2"/>
      </g>
      <text x="90" y="230" font-size="44" fill="#0f172a">𝄞</text>
      <text x="135" y="215" font-size="22" font-weight="bold" fill="#0284c7">D</text>
      <text x="295" y="215" font-size="22" font-weight="bold" fill="#0284c7">G/D</text>
      <text x="455" y="215" font-size="22" font-weight="bold" fill="#0284c7">A7</text>
      <text x="615" y="215" font-size="22" font-weight="bold" fill="#0284c7">D</text>

      <circle cx="170" cy="225" r="7" fill="#0f172a"/>
      <line x1="177" y1="225" x2="177" y2="170" stroke="#0f172a" stroke-width="2"/>
      <text x="170" y="265" font-size="14" text-anchor="middle" fill="#334155">Oh</text>

      <circle cx="330" cy="210" r="7" fill="#0f172a"/>
      <line x1="337" y1="210" x2="337" y2="160" stroke="#0f172a" stroke-width="2"/>
      <text x="330" y="265" font-size="14" text-anchor="middle" fill="#334155">Dios</text>

      <circle cx="490" cy="195" r="7" fill="#0f172a"/>
      <line x1="497" y1="195" x2="497" y2="150" stroke="#0f172a" stroke-width="2"/>
      <text x="490" y="265" font-size="14" text-anchor="middle" fill="#334155">e -</text>

      <circle cx="650" cy="225" r="7" fill="#0f172a"/>
      <line x1="657" y1="225" x2="657" y2="170" stroke="#0f172a" stroke-width="2"/>
      <text x="650" y="265" font-size="14" text-anchor="middle" fill="#334155">ter - no</text>

      <line x1="80" y1="1020" x2="720" y2="1020" stroke="#cbd5e1" stroke-width="1"/>
      <text x="400" y="1050" font-size="12" text-anchor="middle" fill="#94a3b8">© Bethesda Worship Studio — Atril Digital de Notación y Documentos Visuales</text>
    </svg>
  `)}`;

  // Función para resolver y descargar el documento visual de manera autorizada
  const resolveDocument = useCallback(async () => {
    // 1. Limpieza de Object URL previo creado por este componente
    if (createdBlobUrlRef.current) {
      URL.revokeObjectURL(createdBlobUrlRef.current);
      createdBlobUrlRef.current = null;
    }

    // 2. Si ya viene una URL en memoria (blob: o data:) creada en la sesión activa
    if (documentUrl && (documentUrl.startsWith('blob:') || documentUrl.startsWith('data:'))) {
      setResolvedBlobUrl(documentUrl);
      setIsLoading(false);
      setError(null);

      // Si es PDF, intentar inspeccionar el conteo y verificación
      if (isPdf && typeof fetch !== 'undefined') {
        try {
          const res = await fetch(documentUrl);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const inspection = inspectPdfPageCount(buf);
            if (inspection.isVerified && inspection.pageCount && inspection.pageCount > 0) {
              setDetectedPageCount(inspection.pageCount);
              setIsPageCountVerified(true);
            } else {
              setIsPageCountVerified(false);
            }
          }
        } catch {
          setIsPageCountVerified(false);
        }
      }
      return;
    }

    // 3. Si se cuenta con storageKey para documento persistido en servidor
    if (storageKey) {
      setIsLoading(true);
      setError(null);
      try {
        const client = BethesdaApiClient.getInstance();
        const { blob } = await client.downloadDocumentBlob(storageKey);

        if (blob.size === 0) {
          throw new Error('El documento recibido del servidor tiene tamaño binario cero.');
        }

        // Extracción e inspección de número real de páginas para PDF
        if (isPdf) {
          try {
            const arrayBuf = await blob.arrayBuffer();
            const inspection = inspectPdfPageCount(arrayBuf);
            if (inspection.isVerified && inspection.pageCount && inspection.pageCount > 0) {
              setDetectedPageCount(inspection.pageCount);
              setIsPageCountVerified(true);
            } else {
              setIsPageCountVerified(false);
            }
          } catch {
            setIsPageCountVerified(false);
          }
        }

        const objectUrl = URL.createObjectURL(blob);
        createdBlobUrlRef.current = objectUrl;
        setResolvedBlobUrl(objectUrl);
        setIsLoading(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Error al recuperar el documento visual: ${msg}`);
        setIsLoading(false);
      }
      return;
    }

    // 4. Si viene una URL genérica (sin storageKey)
    if (documentUrl) {
      setResolvedBlobUrl(documentUrl);
      setIsLoading(false);
      setError(null);
      return;
    }

    // 5. Fallback a muestra o estado vacío
    if (isSample) {
      setResolvedBlobUrl(sampleScoreSvg);
      setDetectedPageCount(2);
      setIsPageCountVerified(true);
    } else {
      setResolvedBlobUrl(null);
      setIsPageCountVerified(false);
    }
    setIsLoading(false);
    setError(null);
  }, [documentUrl, storageKey, isPdf, isSample, sampleScoreSvg]);

  useEffect(() => {
    // Resetear al cambiar de documento para evitar estado inconsistente o fugas
    setCurrentPage(1);
    setZoomLevel(100);
    setRotationDegrees(0);
    setError(null);
    setDetectedPageCount(pageCount || 1);
    setIsPageCountVerified(true);

    resolveDocument();

    return () => {
      if (createdBlobUrlRef.current) {
        URL.revokeObjectURL(createdBlobUrlRef.current);
        createdBlobUrlRef.current = null;
      }
    };
  }, [documentUrl, storageKey, pageCount, resolveDocument]);

  const totalPages = pages && pages.length > 0 ? pages.length : Math.max(1, detectedPageCount);

  // Desplazamiento suave al elemento de página en modo continuo
  const scrollToPageElement = useCallback((pageNum: number) => {
    if (viewMode === 'CONTINUOUS' && containerRef.current) {
      const pageEl = containerRef.current.querySelector(`#visual-page-${pageNum}`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [viewMode]);

  // Navegación de páginas
  const goToPreviousPage = () => {
    setCurrentPage((prev) => {
      const next = Math.max(1, prev - 1);
      if (onPageChange && next !== prev) onPageChange(next);
      scrollToPageElement(next);
      return next;
    });
  };

  const goToNextPage = () => {
    setCurrentPage((prev) => {
      // Si el conteo no es verificado, permitir avanzar libremente
      const maxLimit = isPageCountVerified ? totalPages : prev + 1;
      const next = Math.min(maxLimit, prev + 1);
      if (onPageChange && next !== prev) onPageChange(next);
      scrollToPageElement(next);
      return next;
    });
  };

  const handleRotate = () => {
    setRotationDegrees((prev) => (prev + 90) % 360);
  };

  const handleZoomIn = () => {
    setFitWidth(false);
    setZoomLevel((prev) => Math.min(200, prev + 25));
  };

  const handleZoomOut = () => {
    setFitWidth(false);
    setZoomLevel((prev) => Math.max(50, prev - 25));
  };

  const toggleFitWidth = () => {
    setFitWidth((prev) => !prev);
    if (!fitWidth) {
      setZoomLevel(100);
    }
  };

  // Atajos de teclado para cambio de página en atril
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        goToPreviousPage();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        goToNextPage();
      } else if (e.key === 'r' || e.key === 'R') {
        handleRotate();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFitWidth();
      } else if (e.key === 'c' || e.key === 'C') {
        setViewMode((prev) => (prev === 'SINGLE' ? 'CONTINUOUS' : 'SINGLE'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalPages, isPageCountVerified, fitWidth]);

  const activePageUrl =
    pages && pages.length > 0
      ? pages[currentPage - 1]
      : resolvedBlobUrl || (isSample ? sampleScoreSvg : sampleScoreSvg);

  const isNextDisabled =
    isLoading || (isPageCountVerified && currentPage >= totalPages);

  return (
    <section
      className="visual-document-stand-wrapper"
      role="region"
      aria-label="Atril de Partitura Visual"
    >
      {/* Barra de Herramientas del Atril Visual */}
      <header className="visual-stand-toolbar" role="toolbar" aria-label="Controles de Partitura Visual">
        {/* Título y Badge */}
        <div className="visual-toolbar-info">
          <span className="visual-doc-badge">
            {isPdf ? '📄 Partitura PDF' : isTiff ? '🖼️ Documento TIFF' : '🖼️ Imagen Escaneada'}
          </span>
          <h2 className="visual-doc-title" title={title}>
            {title}
          </h2>
        </div>

        {/* Controles de Navegación de Página */}
        <div className="visual-toolbar-paging" role="group" aria-label="Navegación de páginas">
          <button
            type="button"
            className="btn-visual-nav"
            onClick={goToPreviousPage}
            disabled={currentPage <= 1 || isLoading}
            aria-label="Página anterior"
            title="Página anterior (Flecha Izquierda)"
          >
            ◀ Anterior
          </button>

          <span className="visual-page-indicator" aria-live="polite">
            {isPageCountVerified ? (
              <>
                Pág. <strong>{currentPage}</strong> de {totalPages}
              </>
            ) : (
              <>
                Pág. <strong>{currentPage}</strong>
                <span className="visual-unverified-tag" title="Número de páginas no verificado por compresión de stream"> (flujo libre)</span>
              </>
            )}
          </span>

          <button
            type="button"
            className="btn-visual-nav"
            onClick={goToNextPage}
            disabled={isNextDisabled}
            aria-label="Página siguiente"
            title="Página siguiente (Flecha Derecha)"
          >
            Siguiente ▶
          </button>
        </div>

        {/* Controles de Zoom, Ajuste y Rotación */}
        <div className="visual-toolbar-actions" role="group" aria-label="Controles de vista">
          <button
            type="button"
            className={`btn-visual-action ${fitWidth ? 'active' : ''}`}
            onClick={toggleFitWidth}
            aria-pressed={fitWidth}
            title="Ajustar al ancho de la pantalla (F)"
          >
            ↔ Ajustar Ancho
          </button>

          <div className="visual-zoom-controls">
            <button
              type="button"
              className="btn-visual-zoom"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 50 || isLoading}
              aria-label="Reducir zoom"
              title="Reducir zoom (-25%)"
            >
              −
            </button>
            <span className="visual-zoom-label">{zoomLevel}%</span>
            <button
              type="button"
              className="btn-visual-zoom"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 200 || isLoading}
              aria-label="Aumentar zoom"
              title="Aumentar zoom (+25%)"
            >
              +
            </button>
          </div>

          <button
            type="button"
            className="btn-visual-action"
            onClick={handleRotate}
            title="Girar partitura 90 grados a la derecha (R)"
            aria-label={`Girar partitura (actual: ${rotationDegrees} grados)`}
          >
            ↻ Girar ({rotationDegrees}°)
          </button>

          <button
            type="button"
            className={`btn-visual-action ${viewMode === 'CONTINUOUS' ? 'active' : ''}`}
            onClick={() => setViewMode((prev) => (prev === 'SINGLE' ? 'CONTINUOUS' : 'SINGLE'))}
            title="Alternar entre página única y flujo continuo para autoscroll (C)"
            aria-pressed={viewMode === 'CONTINUOUS'}
          >
            {viewMode === 'CONTINUOUS' ? '📜 Flujo Continuo' : '📄 Página Única'}
          </button>
        </div>
      </header>

      {/* Viewport del Documento con Soporte de Desplazamiento y Autoscroll (WP-05) */}
      <main
        ref={containerRef}
        className={`visual-document-viewport ${fitWidth ? 'fit-width' : ''} ${viewMode.toLowerCase()}`}
        data-scrollable="true"
        tabIndex={0}
      >
        <div
          className="visual-page-container"
          style={{
            transform: `scale(${fitWidth ? 1 : zoomLevel / 100}) rotate(${rotationDegrees}deg)`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
          }}
        >
          {isLoading ? (
            /* Estado de Carga Autenticada */
            <div className="visual-loading-state" role="status">
              <div className="visual-loading-spinner" aria-hidden="true" />
              <p>Cargando partitura visual autorizada...</p>
            </div>
          ) : error ? (
            /* Estado de Error de Recuperación */
            <div className="visual-error-state" role="alert">
              <div className="visual-error-icon">⚠️</div>
              <h3>No se pudo mostrar el documento</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn-visual-action active"
                onClick={() => resolveDocument()}
              >
                Reintentar carga
              </button>
            </div>
          ) : isTiff ? (
            /* Tratamiento Explícito de TIFF: Formato no decodificable nativamente en navegadores modernos */
            <div className="visual-error-state" role="status">
              <div className="visual-error-icon">🖼️</div>
              <h3>Documento en Formato TIFF</h3>
              <p>
                Los navegadores web modernos no soportan la decodificación nativa de imágenes TIFF directamente en pantalla.
                Puede descargar el archivo original para visualizarlo en una aplicación de diseño o convertirlo a formato PDF/PNG.
              </p>
              {resolvedBlobUrl && (
                <a
                  href={resolvedBlobUrl}
                  download={title.endsWith('.tif') || title.endsWith('.tiff') ? title : `${title}.tiff`}
                  className="btn-visual-action active"
                  style={{ textDecoration: 'none', display: 'inline-flex', marginTop: '1rem' }}
                >
                  ⬇ Descargar archivo original (.tiff)
                </a>
              )}
            </div>
          ) : isPdf && resolvedBlobUrl ? (
            /* Visualización de PDF: Distinción de modo SINGLE vs CONTINUOUS */
            viewMode === 'CONTINUOUS' ? (
              <iframe
                key={`${resolvedBlobUrl}-continuous`}
                src={`${resolvedBlobUrl}#page=${currentPage}&view=FitH&pagemode=none&toolbar=0&navpanes=0`}
                className="visual-pdf-embed continuous"
                title={`Partitura PDF: ${title} — Flujo Continuo`}
              />
            ) : (
              <iframe
                key={`${resolvedBlobUrl}-single-p${currentPage}`}
                src={`${resolvedBlobUrl}#page=${currentPage}&view=Fit&toolbar=0&navpanes=0`}
                className="visual-pdf-embed single"
                title={`Partitura PDF: ${title} — Página ${currentPage} de ${totalPages}`}
              />
            )
          ) : viewMode === 'CONTINUOUS' && pages && pages.length > 1 ? (
            /* Modo CONTINUO para secuencia de imágenes raster multipágina */
            <div className="visual-continuous-wrapper">
              {pages.map((pageUrl, idx) => {
                const pageNum = idx + 1;
                return (
                  <div
                    key={pageNum}
                    id={`visual-page-${pageNum}`}
                    className={`visual-page-card ${currentPage === pageNum ? 'current-page' : ''}`}
                  >
                    <span className="visual-page-number-tag">
                      Página {pageNum} de {totalPages}
                    </span>
                    <img
                      src={pageUrl}
                      alt={`Partitura visual: ${title} — Página ${pageNum} de ${totalPages}`}
                      className="visual-sheet-image"
                      loading={pageNum === 1 ? 'eager' : 'lazy'}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            /* Modo PÁGINA ÚNICA (o imagen única / muestra) */
            <div className="visual-single-page-wrapper">
              <img
                src={resolvedBlobUrl || activePageUrl}
                alt={`Partitura visual: ${title} — Página ${currentPage} de ${totalPages}`}
                className="visual-sheet-image"
                loading="eager"
              />
            </div>
          )}
        </div>
      </main>
    </section>
  );
};

export default VisualDocumentStand;
