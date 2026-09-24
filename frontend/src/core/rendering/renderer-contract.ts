/**
 * @file renderer-contract.ts
 * @description Contrato común independiente de frameworks y bibliotecas de UI
 * para todos los adaptadores de renderizado de Bethesda Worship Studio.
 */

import { type DerivedMusicalView } from '../projection/derived-musical-view.ts';
import {
  type IRenderTarget,
  type RendererCapabilities,
  type RendererDiagnostic,
  type RendererErrorCode,
  type RendererId,
  type RendererStatus,
  type RenderOutput,
} from './types.ts';

/**
 * Contrato formal obligatorio para cualquier motor de renderizado musical.
 *
 * Responsabilidades:
 * - Declaración de capacidades
 * - Inicialización del renderizador
 * - Conversión y renderizado de una DerivedMusicalView
 * - Actualización eficiente de una vista derivada
 * - Liberación de recursos (dispose)
 * - Reporte estructurado de errores y advertencias
 */
export interface IMusicRenderer<TData = unknown> {
  readonly id: RendererId;
  readonly name: string;
  readonly capabilities: RendererCapabilities;
  readonly status: RendererStatus;

  /**
   * Inicializa el motor de renderizado vinculándolo opcionalmente a un target.
   */
  initialize(target?: IRenderTarget): Promise<void> | void;

  /**
   * Procesa y convierte una DerivedMusicalView en la representación nativa del renderizador.
   */
  render(view: DerivedMusicalView): Promise<RenderOutput<TData>> | RenderOutput<TData>;

  /**
   * Actualiza el renderizado con una vista derivada modificada (ej. cambio de tono o cejilla).
   */
  update(view: DerivedMusicalView): Promise<RenderOutput<TData>> | RenderOutput<TData>;

  /**
   * Libera recursos y listeners asociados al renderizador.
   */
  dispose(): void;

  /**
   * Obtiene la lista histórica o activa de diagnósticos reportados por el adaptador.
   */
  getDiagnostics(): readonly RendererDiagnostic[];
}

/**
 * Clase base abstracta que gestiona ciclo de vida, diagnósticos y validaciones comunes.
 */
export abstract class BaseMusicRenderer<TData = unknown> implements IMusicRenderer<TData> {
  public abstract readonly id: RendererId;
  public abstract readonly name: string;
  public abstract readonly capabilities: RendererCapabilities;

  protected _status: RendererStatus = 'UNINITIALIZED';
  protected _diagnostics: RendererDiagnostic[] = [];
  protected _target?: IRenderTarget | undefined;

  public get status(): RendererStatus {
    return this._status;
  }

  public initialize(target?: IRenderTarget): void {
    if (this._status === 'DISPOSED') {
      throw new Error(`No se puede inicializar un renderizador desechado (${this.id}).`);
    }
    this._target = target;
    this._status = 'READY';
  }

  public render(view: DerivedMusicalView): RenderOutput<TData> {
    if (this._status === 'UNINITIALIZED') {
      this.initialize();
    }
    if (this._status === 'DISPOSED') {
      return this.createErrorOutput(
        'RENDERER_RUNTIME_ERROR',
        `El renderizador ${this.id} ha sido liberado (DISPOSED) y no puede procesar vistas.`
      );
    }

    if (!view || !view.measures) {
      return this.createErrorOutput(
        'INVALID_DERIVED_VIEW',
        'La vista derivada proporcionada es nula o carece de compases válidos.'
      );
    }

    // Validar si el renderizador soporta las representaciones activas de la vista
    if (!this.capabilities.canRender(view.activeRepresentations)) {
      const unsupported = view.activeRepresentations.filter(
        (r) => !this.capabilities.supportedRepresentations.includes(r)
      );
      return this.createErrorOutput(
        'UNSUPPORTED_RENDERER_CAPABILITY',
        `El renderizador ${this.name} (${this.id}) no soporta la(s) representación(es) solicitada(s): ${unsupported.join(', ')}.`,
        { requested: view.activeRepresentations, unsupported }
      );
    }

    this._status = 'RENDERING';
    try {
      const data = this.convertViewToData(view);
      this._status = 'READY';
      return {
        rendererId: this.id,
        success: true,
        diagnostics: this.getDiagnostics(),
        data,
        timestamp: Date.now(),
      };
    } catch (err: unknown) {
      this._status = 'ERROR';
      const message = err instanceof Error ? err.message : String(err);
      return this.createErrorOutput(
        'RENDERER_DATA_CONVERSION_FAILED',
        `Fallo al convertir la vista derivada para ${this.name}: ${message}`,
        { error: message }
      );
    }
  }

  public update(view: DerivedMusicalView): RenderOutput<TData> {
    return this.render(view);
  }

  public dispose(): void {
    this._status = 'DISPOSED';
    this._target = undefined;
  }

  public getDiagnostics(): readonly RendererDiagnostic[] {
    return Object.freeze([...this._diagnostics]);
  }

  protected addDiagnostic(
    severity: 'ERROR' | 'WARNING' | 'INFO',
    code: RendererErrorCode | string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    this._diagnostics.push({ severity, code, message, context });
  }

  protected clearDiagnostics(): void {
    this._diagnostics = [];
  }

  protected createErrorOutput(
    code: RendererErrorCode,
    message: string,
    context?: Record<string, unknown>
  ): RenderOutput<TData> {
    this.addDiagnostic('ERROR', code, message, context);
    return {
      rendererId: this.id,
      success: false,
      diagnostics: this.getDiagnostics(),
      data: null as unknown as TData,
      timestamp: Date.now(),
    };
  }

  /**
   * Método abstracto que convierte la DerivedMusicalView al modelo nativo del renderizador.
   */
  protected abstract convertViewToData(view: DerivedMusicalView): TData;
}
