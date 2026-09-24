/**
 * @file api-error.ts
 * @description Clase estructurada para capturar y propagar errores de la API HTTP de Fastify en el frontend (Fase 2C — WS6).
 *
 * Mapea fielmente el formato emitido por el errorHandler del backend:
 * {
 *   error: {
 *     code: string;
 *     message: string;
 *     statusCode: number;
 *     details: unknown;
 *   }
 * }
 */

export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown;

  public constructor(
    message: string,
    statusCode: number,
    code: string = 'UNKNOWN_ERROR',
    details: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Extrae de forma segura el error tipado desde la respuesta HTTP del servidor.
   */
  public static async fromResponse(res: Response): Promise<ApiError> {
    try {
      const json = await res.json();
      if (json?.error) {
        return new ApiError(
          json.error.message || `Error HTTP ${res.status}`,
          json.error.statusCode || res.status,
          json.error.code || 'HTTP_ERROR',
          json.error.details ?? null
        );
      }
    } catch {
      // Si la respuesta no contiene un cuerpo JSON estructurado
    }

    return new ApiError(
      `Error de comunicación con el servidor: HTTP ${res.status}`,
      res.status,
      'HTTP_ERROR'
    );
  }
}
