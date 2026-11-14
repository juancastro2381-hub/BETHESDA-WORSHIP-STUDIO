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
import { ConversionWorker } from './application/conversion-worker.ts';
import { stopConversionQueue } from './infrastructure/queue/conversion-queue.ts';
import { globalAudioService } from './interfaces/http/routes/audio.routes.ts';

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

    // 3. Construir aplicación y ejecutar recuperación durable controlada de audio tras DB y almacenamiento
    const app = await buildApp();
    const audioRecoveryStatus = await globalAudioService.runStartupRecovery({
      enabled: env.AUDIO_STARTUP_RECOVERY_ENABLED,
      purgeConfirmedOrphans: env.AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS,
      logger: app.log,
    });
    console.log(
      `🛡️ Recuperación durable de audio al arranque: estado=${audioRecoveryStatus.status}, rehidratación=${audioRecoveryStatus.rehydrationSucceeded}, purgaAuto=${env.AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS}`
    );

    const address = await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`\n🎵 Bethesda Worship Studio API escuchando en: ${address}`);
    console.log(`📖 Documentación Swagger disponible en: ${address}/documentation\n`);

    // 4. Iniciar ConversionWorker de segundo plano (CR-01)
    const conversionWorker = new ConversionWorker();
    await conversionWorker.start();
    console.log('⚙️ ConversionWorker de segundo plano iniciado y escuchando la cola de pg-boss.\n');

    // 5. Manejo de señales de terminación segura (Graceful Shutdown)
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Recibida señal ${signal}. Iniciando apagado ordenado...`);
      try {
        await conversionWorker.stop();
        await stopConversionQueue();
        await app.close();
        console.log('✅ Servidor y trabajadores de segundo plano detenidos correctamente.');
        process.exit(0);
      } catch (shutdownErr) {
        console.error('❌ Error durante el apagado ordenado:', shutdownErr);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Error fatal al iniciar el servidor:', err);
    process.exit(1);
  }
}

start();

