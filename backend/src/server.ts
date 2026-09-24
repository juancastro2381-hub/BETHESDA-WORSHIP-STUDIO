/**
 * @file server.ts
 * @description Punto de entrada del servidor HTTP de Bethesda Worship Studio (Fases 2A y 2B).
 */

import { buildApp } from './app.ts';
import { env } from './config/env.ts';
import { runMigrations } from './db/migrate.ts';
import { bootstrapSuperAdmin } from './application/bootstrap-service.ts';
import { DrizzleUserRepository } from './repositories/user-repository.ts';
import { Argon2PasswordHasher } from './domain/crypto/password-hasher.ts';
import { DrizzleAuditLogRepository } from './repositories/audit-repository.ts';
import { AuditService } from './application/audit-service.ts';

async function start() {
  try {
    // 1. Ejecutar migraciones automáticas al iniciar
    console.log('📦 Verificando y aplicando migraciones de base de datos...');
    await runMigrations();

    // 2. Ejecutar bootstrap seguro de SUPER_ADMIN si la base de datos está vacía
    if (env.INITIAL_SUPERADMIN_EMAIL && env.INITIAL_SUPERADMIN_PASSWORD) {
      const userRepo = new DrizzleUserRepository();
      const hasher = new Argon2PasswordHasher({
        memoryCost: env.ARGON2_MEMORY_COST,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      });
      const auditService = new AuditService(new DrizzleAuditLogRepository());

      await bootstrapSuperAdmin(userRepo, hasher, auditService);
    }

    // 3. Construir e iniciar servidor Fastify
    const app = await buildApp();
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`\n🎵 Bethesda Worship Studio API escuchando en: ${address}`);
    console.log(`📖 Documentación Swagger disponible en: ${address}/documentation\n`);
  } catch (err) {
    console.error('❌ Error fatal al iniciar el servidor:', err);
    process.exit(1);
  }
}

start();

