/**
 * @file health.routes.ts
 * @description Ruta de diagnóstico de salud del servidor y conexión a PostgreSQL (Fase 2A).
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.ts';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_request, reply) => {
    try {
      // Verificación activa de conectividad con PostgreSQL
      const result = await db.execute(sql`SELECT 1 as alive`);
      const isAlive = (result.rows[0] as any)?.alive === 1;

      return reply.status(200).send({
        status: isAlive ? 'ok' : 'degraded',
        database: isAlive ? 'connected' : 'unreachable',
        service: 'Bethesda Worship Studio Backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(503).send({
        status: 'error',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Error desconocido de base de datos',
        timestamp: new Date().toISOString(),
      });
    }
  });
};
