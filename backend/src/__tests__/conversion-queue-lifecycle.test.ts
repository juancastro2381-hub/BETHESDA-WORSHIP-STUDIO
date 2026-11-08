/**
 * @file conversion-queue-lifecycle.test.ts
 * @description Suite de pruebas para el ciclo de vida de la cola pg-boss y ConversionWorker (CR-01).
 *
 * Valida:
 * 1. Inicialización e idempotencia de la cola pg-boss.
 * 2. Registro y detención limpia del ConversionWorker.
 * 3. Prevención de arranques duplicados concurrentes.
 * 4. Fallo estricto de encolado sin degradación oculta en memoria.
 * 5. Apagado ordenado (graceful shutdown) e idempotencia al detenerse.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startConversionQueue,
  stopConversionQueue,
  isConversionQueueReady,
  enqueueConversionJob,
  getConversionQueue,
  CONVERSION_QUEUE_NAME,
} from '../infrastructure/queue/conversion-queue.ts';
import { ConversionWorker } from '../application/conversion-worker.ts';
import { PersistenceError } from '../domain/errors.ts';
import { pool } from '../db/index.ts';

describe('CR-01 — Conversion Queue and Worker Lifecycle Suite', () => {
  before(async () => {
    // Asegurar estado limpio inicial
    await stopConversionQueue();
  });

  after(async () => {
    await stopConversionQueue();
    await pool.end();
  });

  it('1. should start conversion queue idempotently', async () => {
    assert.strictEqual(isConversionQueueReady(), false, 'La cola no debe estar lista antes de iniciar');

    const boss1 = await startConversionQueue();
    assert.ok(boss1, 'startConversionQueue debe retornar la instancia de pg-boss');
    assert.strictEqual(isConversionQueueReady(), true, 'La cola debe estar marcada como lista');

    // Segunda llamada debe ser idempotente y retornar la misma instancia
    const boss2 = await startConversionQueue();
    assert.strictEqual(boss1, boss2, 'Llamadas sucesivas deben retornar la misma instancia activa');
  });

  it('2. should prevent concurrent duplicate start races', async () => {
    await stopConversionQueue();
    assert.strictEqual(isConversionQueueReady(), false);

    // Disparar dos arranques en paralelo
    const [b1, b2] = await Promise.all([
      startConversionQueue(),
      startConversionQueue(),
    ]);

    assert.strictEqual(b1, b2, 'Arranques concurrentes deben resolver a la misma instancia');
    assert.strictEqual(isConversionQueueReady(), true);
  });

  it('3. should register and stop ConversionWorker cleanly', async () => {
    const worker = new ConversionWorker();
    assert.strictEqual(worker.isActive(), false, 'El trabajador debe iniciar inactivo');

    await worker.start();
    assert.strictEqual(worker.isActive(), true, 'El trabajador debe estar activo tras start()');

    // start() repetido en el mismo worker debe ser idempotente
    await worker.start();
    assert.strictEqual(worker.isActive(), true);

    await worker.stop();
    assert.strictEqual(worker.isActive(), false, 'El trabajador debe estar inactivo tras stop()');

    // stop() repetido debe ser seguro
    await worker.stop();
    assert.strictEqual(worker.isActive(), false);
  });

  it('4. should throw PersistenceError and refuse in-memory fallback when queue send fails', async () => {
    const boss = await startConversionQueue();

    // Simular un fallo forzado en boss.send
    const originalSend = boss.send.bind(boss);
    (boss as any).send = async () => {
      throw new Error('Postgres connection severed simulated failure');
    };

    try {
      await assert.rejects(
        async () => {
          await enqueueConversionJob({
            jobId: '00000000-0000-0000-0000-000000000099',
            userId: '00000000-0000-0000-0000-000000000001',
            tenantId: 'bethesda-default',
            storageKey: 'test-key',
            checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            filename: 'test.chordpro',
            targetFormat: 'LYRICS_ONLY',
          });
        },
        (err: any) => {
          assert.ok(err instanceof PersistenceError, 'Debe lanzar PersistenceError');
          assert.match(err.message, /Fallo al encolar trabajo en pg-boss/);
          return true;
        },
        'No debe haber degradación silenciosa ni bypass en memoria cuando la cola falla'
      );
    } finally {
      // Restaurar método original
      (boss as any).send = originalSend;
    }
  });

  it('5. should handle graceful shutdown cleanly and allow re-starting afterwards', async () => {
    await startConversionQueue();
    assert.strictEqual(isConversionQueueReady(), true);

    await stopConversionQueue();
    assert.strictEqual(isConversionQueueReady(), false, 'La cola no debe estar lista tras stop');

    // Detener nuevamente debe ser no-op seguro
    await stopConversionQueue();
    assert.strictEqual(isConversionQueueReady(), false);

    // Reiniciar nuevamente debe funcionar sin excepciones
    await startConversionQueue();
    assert.strictEqual(isConversionQueueReady(), true);
    await stopConversionQueue();
  });
});
