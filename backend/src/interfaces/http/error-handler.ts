/**
 * @file error-handler.ts
 * @description Manejador global de errores para Fastify.
 * Convierte excepciones en respuestas JSON estructuradas y seguras sin filtrar trazas internas.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors.ts';

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(error);

  // 1. Error de Dominio de la Aplicación (AppError)
  if (error instanceof AppError) {
    if (error.statusCode === 416) {
      const totalSize = (error.details as any)?.totalSize ?? '*';
      reply.header('Content-Range', `bytes */${totalSize}`);
    }
    return reply.status(error.statusCode).send(error.toJSON());
  }

  // 2. Errores de Validación Zod
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados en la solicitud no cumplen con el esquema requerido.',
        statusCode: 400,
        details: issues,
      },
    });
  }

  // 3. Errores de validación de Fastify
  if ('validation' in error && (error as any).validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        statusCode: 400,
        details: (error as any).validation,
      },
    });
  }

  // 4. Errores de cliente o análisis de Fastify reconocidos (4xx: parser, media type, bad request)
  const isFastifyClientError =
    ('code' in error && typeof (error as any).code === 'string' && (error as any).code.startsWith('FST_ERR_')) ||
    error.name === 'FastifyError';

  if (
    isFastifyClientError &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    const statusCode = error.statusCode;
    const errorCode = (error as any).code || (statusCode === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
    const safeMessage =
      statusCode === 404
        ? `Ruta no encontrada: ${request.method} ${request.url}`
        : error.message;

    return reply.status(statusCode).send({
      error: {
        code: errorCode,
        message: safeMessage,
        statusCode,
        details: null,
      },
    });
  }

  // 5. Errores 404 de ruta no encontrada
  if ('statusCode' in error && error.statusCode === 404) {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Ruta no encontrada: ${request.method} ${request.url}`,
        statusCode: 404,
        details: null,
      },
    });
  }

  // 5. Errores genéricos no controlados (500)
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno en el servidor.',
      statusCode: 500,
      details: null,
    },
  });
}
