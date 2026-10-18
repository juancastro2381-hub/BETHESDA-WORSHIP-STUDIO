/**
 * @file app.ts
 * @description Fábrica de la aplicación Fastify configurada con middleware, OpenAPI Swagger y rutas (Fases 2A y 2B).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import sensible from '@fastify/sensible';
import { env } from './config/env.ts';
import { errorHandler } from './interfaces/http/error-handler.ts';
import { healthRoutes } from './interfaces/http/routes/health.routes.ts';
import { songRoutes } from './interfaces/http/routes/song.routes.ts';
import { authRoutes } from './interfaces/http/routes/auth.routes.ts';
import { userRoutes } from './interfaces/http/routes/user.routes.ts';
import { setlistRoutes } from './interfaces/http/routes/setlist.routes.ts';
import { audioRoutes } from './interfaces/http/routes/audio.routes.ts';
import { realtimeRoutes } from './interfaces/http/routes/realtime.routes.ts';
import { multitrackRoutes } from './interfaces/http/routes/multitrack.routes.ts';
import { JwtTokenService } from './application/token-service.ts';
import { DrizzleUserRepository } from './repositories/user-repository.ts';
import { AuthGuard } from './interfaces/http/middlewares/auth-middleware.ts';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    bodyLimit: 10 * 1024 * 1024, // 10 MB límite para archivos MusicXML grandes
  });

  // 1. Manejo de Errores Global
  fastify.setErrorHandler(errorHandler);

  // 2. Plugins de Seguridad de Encabezados (Helmet)
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    noSniff: true,
  });

  // 3. Plugins de Utilidad, Cookies y CORS Estricto
  await fastify.register(sensible);
  await fastify.register(cookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Permitir solicitudes sin origin (como herramientas internas, curl, pruebas) o el origin configurado
      if (!origin || origin === env.CORS_ORIGIN || env.NODE_ENV !== 'production') {
        cb(null, true);
        return;
      }
      cb(new Error('No autorizado por política CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // 4. OpenAPI / Swagger Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Bethesda Worship Studio — API de Persistencia Canónica y Seguridad RBAC',
        description:
          'API RESTful v1 para la persistencia, versionamiento, catálogo musical, autenticación y control de acceso basado en roles.',
        version: '1.0.0',
        contact: {
          name: 'Iglesia Cristiana Bethesda — Madrid, Cundinamarca',
        },
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: 'Servidor Local de Desarrollo',
        },
      ],
      tags: [
        { name: 'health', description: 'Diagnóstico de conectividad y estado del servicio' },
        { name: 'auth', description: 'Autenticación, sesiones HttpOnly, recuperación e invitaciones' },
        { name: 'users', description: 'Gestión y asignación de roles de usuarios (RBAC)' },
        { name: 'songs', description: 'Gestión de canciones maestras, versiones y fuentes' },
        { name: 'setlists', description: 'Gestión de setlists, momentos litúrgicos y flujo de culto' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // 5. Hook de Autenticación Contextual
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  fastify.addHook('onRequest', async (request, reply) => {
    // Si viene encabezado de autorización, extraer usuario sin bloquear si es opcional
    try {
      await authGuard.authenticate(request, reply);
    } catch {
      // Si el formato es erróneo se procesará en las rutas que exigen autenticación
    }
  });

  // 6. Registro de Rutas API v1
  await fastify.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(userRoutes, { prefix: '/users' });
      await v1.register(songRoutes, { prefix: '/songs' });
      await v1.register(setlistRoutes, { prefix: '/setlists' });
      await v1.register(audioRoutes);
      await v1.register(realtimeRoutes, { prefix: '/realtime' });
      await v1.register(multitrackRoutes, { prefix: '/multitrack' });
    },
    { prefix: '/api/v1' }
  );

  return fastify;
}
