/**
 * @file errors.ts
 * @description Modelo jerárquico estructurado de errores y diagnósticos para el backend (Fases 2A & 2B).
 */

export type BackendErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_MUSIC_PAYLOAD'
  | 'UNSUPPORTED_SOURCE'
  | 'PERSISTENCE_ERROR'
  | 'INTERNAL_ERROR'
  // Errores de Seguridad y Autenticación (Fase 2B)
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'ACCOUNT_LOCKED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'RATE_LIMIT_EXCEEDED'
  | 'RANGE_NOT_SATISFIABLE';

export class AppError extends Error {
  public readonly code: BackendErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown;
  public readonly isOperational: boolean;

  public constructor(
    code: BackendErrorCode,
    message: string,
    statusCode: number = 500,
    details?: unknown,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details ?? null,
      },
    };
  }
}

export class ValidationError extends AppError {
  public constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  public constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `El recurso '${resource}' con identificador '${identifier}' no fue encontrado.`
      : `El recurso '${resource}' solicitado no existe.`;
    super('NOT_FOUND', message, 404, { resource, identifier });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  public constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class InvalidMusicPayloadError extends AppError {
  public constructor(message: string, validationErrors?: unknown) {
    super('INVALID_MUSIC_PAYLOAD', message, 422, validationErrors);
    this.name = 'InvalidMusicPayloadError';
  }
}

export class UnsupportedSourceError extends AppError {
  public constructor(message: string, details?: unknown) {
    super('UNSUPPORTED_SOURCE', message, 415, details);
    this.name = 'UnsupportedSourceError';
  }
}

export class PersistenceError extends AppError {
  public constructor(message: string, details?: unknown) {
    super('PERSISTENCE_ERROR', message, 500, details);
    this.name = 'PersistenceError';
  }
}

export class InternalError extends AppError {
  public constructor(message: string = 'Ha ocurrido un error interno en el servidor.') {
    super('INTERNAL_ERROR', message, 500, undefined, false);
    this.name = 'InternalError';
  }
}

// ============================================================================
// ERRORES DE AUTENTICACIÓN Y AUTORIZACIÓN (FASE 2B)
// ============================================================================

export class UnauthorizedError extends AppError {
  public constructor(message: string = 'No autenticado. Se requiere una sesión válida.') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class InvalidCredentialsError extends AppError {
  public constructor(message: string = 'Credenciales inválidas o cuenta inaccesible.') {
    super('INVALID_CREDENTIALS', message, 401);
    this.name = 'InvalidCredentialsError';
  }
}

export class ForbiddenError extends AppError {
  public constructor(message: string = 'Acceso denegado. No posee permisos suficientes para esta operación.') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class AccountLockedError extends AppError {
  public constructor(message: string = 'Cuenta bloqueada temporalmente por exceso de intentos fallidos.') {
    super('ACCOUNT_LOCKED', message, 423);
    this.name = 'AccountLockedError';
  }
}

export class TokenExpiredError extends AppError {
  public constructor(message: string = 'El token ha expirado. Renueve su sesión.') {
    super('TOKEN_EXPIRED', message, 401);
    this.name = 'TokenExpiredError';
  }
}

export class TokenInvalidError extends AppError {
  public constructor(message: string = 'Token inválido o firma corrupta.') {
    super('TOKEN_INVALID', message, 401);
    this.name = 'TokenInvalidError';
  }
}

export class RateLimitExceededError extends AppError {
  public constructor(message: string = 'Límite de solicitudes superado. Intente más tarde.') {
    super('RATE_LIMIT_EXCEEDED', message, 429);
    this.name = 'RateLimitExceededError';
  }
}

export class RangeNotSatisfiableError extends AppError {
  public constructor(
    message: string = 'El rango solicitado no es satisfacible.',
    totalSize: number = 0
  ) {
    super('RANGE_NOT_SATISFIABLE', message, 416, { totalSize });
    this.name = 'RangeNotSatisfiableError';
  }
}

