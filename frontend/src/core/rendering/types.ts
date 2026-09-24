/**
 * @file types.ts
 * @description Tipos fundamentales, contratos y definiciones de error para la capa
 * de adaptadores de renderizado (Fase 1E).
 *
 * Invariante arquitectónico: Los motores de renderizado son consumidores puros
 * de DerivedMusicalView. NUNCA son fuentes de verdad musical.
 */

import { type ViewRepresentation } from '../projection/types.ts';

/**
 * Identificadores oficiales de los motores de renderizado integrados.
 */
export type RendererId = 'ALPHATAB' | 'OSMD' | 'LEADSHEET_DOM';

/**
 * Estados del ciclo de vida de un adaptador de renderizado.
 */
export type RendererStatus =
  | 'UNINITIALIZED'
  | 'READY'
  | 'RENDERING'
  | 'ERROR'
  | 'DISPOSED';

/**
 * Códigos estructurados de error para la arquitectura de renderizado.
 */
export type RendererErrorCode =
  | 'UNSUPPORTED_RENDERER_CAPABILITY'
  | 'INVALID_DERIVED_VIEW'
  | 'RENDERER_INITIALIZATION_FAILED'
  | 'RENDERER_DATA_CONVERSION_FAILED'
  | 'RENDERER_RUNTIME_ERROR';

/**
 * Diagnóstico estructurado reportado por un adaptador de renderizado.
 */
export interface RendererDiagnostic {
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: RendererErrorCode | string;
  readonly message: string;
  readonly context?: Record<string, unknown> | undefined;
}

/**
 * Descriptor de capacidades formal de un motor de renderizado.
 */
export interface RendererCapabilities {
  readonly rendererId: RendererId;
  readonly name: string;
  readonly supportedRepresentations: readonly ViewRepresentation[];
  readonly supportsPolyphony: boolean;
  readonly supportsTablature: boolean;
  readonly supportsGrandStaff: boolean;
  readonly supportsLyrics: boolean;
  readonly supportsChords: boolean;
  readonly supportsPercussion: boolean;
  /**
   * Determina si el adaptador puede satisfacer el conjunto de representaciones solicitadas.
   */
  canRender(requested: readonly ViewRepresentation[]): boolean;
}

/**
 * Objetivo de montaje abstracto y desacoplado del DOM de navegador.
 * Permite inicialización en entornos headless/Node sin depender de `HTMLElement` o `window`.
 */
export interface IRenderTarget {
  readonly id?: string | undefined;
  readonly container?: unknown | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/**
 * Resultado estructurado emitido por un adaptador tras procesar una vista derivada.
 */
export interface RenderOutput<TData = unknown> {
  readonly rendererId: RendererId;
  readonly success: boolean;
  readonly diagnostics: readonly RendererDiagnostic[];
  readonly data: TData;
  readonly timestamp: number;
}
