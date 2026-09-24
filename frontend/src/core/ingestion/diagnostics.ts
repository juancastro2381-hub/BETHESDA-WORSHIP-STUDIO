/**
 * @file diagnostics.ts
 * @description Recolector y gestor de diagnósticos estructurados de ingesta musical.
 * Proporciona información de origen (compás, voz, elemento XML, línea, columna)
 * sin descartar silenciosamente información musical no soportada.
 */

import {
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticSourceLocation,
  type IngestionStatus,
} from './types.ts';

export class DiagnosticCollector {
  private readonly _diagnostics: Diagnostic[] = [];

  public add(diagnostic: Diagnostic): void {
    this._diagnostics.push(diagnostic);
  }

  public addInfo(
    code: string,
    message: string,
    location?: DiagnosticSourceLocation,
    context?: Record<string, unknown>
  ): void {
    const d: Diagnostic = { code, severity: 'INFO', message };
    if (location) d.location = location;
    if (context) d.context = context;
    this._diagnostics.push(d);
  }

  public addWarning(
    code: string,
    message: string,
    location?: DiagnosticSourceLocation,
    context?: Record<string, unknown>
  ): void {
    const d: Diagnostic = { code, severity: 'WARNING', message };
    if (location) d.location = location;
    if (context) d.context = context;
    this._diagnostics.push(d);
  }

  public addError(
    code: string,
    message: string,
    location?: DiagnosticSourceLocation,
    context?: Record<string, unknown>
  ): void {
    const d: Diagnostic = { code, severity: 'ERROR', message };
    if (location) d.location = location;
    if (context) d.context = context;
    this._diagnostics.push(d);
  }

  public get hasErrors(): boolean {
    return this._diagnostics.some((d) => d.severity === 'ERROR');
  }

  public get hasWarnings(): boolean {
    return this._diagnostics.some((d) => d.severity === 'WARNING');
  }

  public determineStatus(): IngestionStatus {
    if (this.hasErrors) {
      return 'FAILED';
    }
    if (this.hasWarnings) {
      return 'SUCCESS_WITH_WARNINGS';
    }
    return 'SUCCESS';
  }

  public get diagnostics(): readonly Diagnostic[] {
    return Object.freeze([...this._diagnostics]);
  }
}
