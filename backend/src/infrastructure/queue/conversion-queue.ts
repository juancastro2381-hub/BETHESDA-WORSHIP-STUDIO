/**
 * @file conversion-queue.ts
 * @description Gestión de cola persistente en PostgreSQL con pg-boss para el Centro de Conversión (Fase 2A-R).
 *
 * Implementa la arquitectura de ejecución en segundo plano para conversiones asíncronas,
 * garantizando persistencia en PostgreSQL, reintentos controlados, recuperación ante caídas
 * y desacoplamiento del ciclo de vida HTTP.
 */

import { PgBoss } from 'pg-boss';
import { env } from '../../config/env.ts';
import { PersistenceError } from '../../domain/errors.ts';

export type ConversionTargetFormat =
  | 'MUSIC_XML'
  | 'MIDI'
  | 'CHORD_PRO'
  | 'LYRICS_ONLY'
  | 'ENGRAVED_PDF'
  | 'TABLATURE';

export interface ConversionOptions {
  targetFormat?: ConversionTargetFormat;
  title?: string;
  artist?: string;
  keyOverride?: string;
  timeSignatureOverride?: string;
  bpmOverride?: number;
  transposeSemitones?: number;
  quantizationGrid?: 'NONE' | 'QUARTER' | 'EIGHTH' | 'SIXTEENTH' | 'TRIPLET';
  preserveOriginalLayout?: boolean;
  strictTemporalValidation?: boolean;
}

export const CONVERSION_QUEUE_NAME = 'music-conversion';

export interface ConversionJobPayload {
  jobId: string;
  userId: string;
  tenantId: string;
  storageKey: string;
  checksumSha256: string;
  filename: string;
  targetFormat: ConversionTargetFormat;
  options?: ConversionOptions;
}

let bossInstance: PgBoss | null = null;
let isStarted = false;
let startPromise: Promise<PgBoss> | null = null;

/**
 * Obtiene o crea la instancia singleton de PgBoss conectada a la base de datos correspondiente.
 */
export function getConversionQueue(): PgBoss {
  if (!bossInstance) {
    const isTest = env.NODE_ENV === 'test';
    const connectionString = (isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL) as string;

    if (!connectionString) {
      throw new Error('Cadena de conexión de base de datos no configurada para pg-boss.');
    }

    bossInstance = new PgBoss({
      connectionString,
      max: 10,
    });
  }
  return bossInstance;
}

/**
 * Verifica si la cola de conversión está iniciada y lista para operar.
 */
export function isConversionQueueReady(): boolean {
  return isStarted && bossInstance !== null;
}

/**
 * Inicia la infraestructura de colas de pg-boss y crea la cola de conversión si no existe.
 * Idempotente y seguro ante llamadas concurrentes múltiples.
 */
export async function startConversionQueue(): Promise<PgBoss> {
  if (isStarted && bossInstance) {
    return bossInstance;
  }

  if (startPromise) {
    return await startPromise;
  }

  startPromise = (async () => {
    try {
      const boss = getConversionQueue();
      await boss.start();
      await boss.createQueue(CONVERSION_QUEUE_NAME);
      isStarted = true;
      return boss;
    } catch (err: any) {
      isStarted = false;
      bossInstance = null;
      throw new PersistenceError(`Fallo al inicializar cola pg-boss: ${err.message}`);
    } finally {
      startPromise = null;
    }
  })();

  return await startPromise;
}

/**
 * Detiene la instancia de colas de forma segura (graceful shutdown).
 */
export async function stopConversionQueue(): Promise<void> {
  if (bossInstance && isStarted) {
    await bossInstance.stop({ graceful: true, timeout: 2000 });
    isStarted = false;
    bossInstance = null;
  }
}

/**
 * Encola un nuevo trabajo de conversión en pg-boss como mecanismo autoritativo (CR-01).
 * Si la cola no está disponible o el encolado falla, lanza PersistenceError sin bypass en memoria.
 */
export async function enqueueConversionJob(payload: ConversionJobPayload): Promise<string> {
  const boss = await startConversionQueue();
  try {
    const jobId = await boss.send(CONVERSION_QUEUE_NAME, payload, {
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 300, // 5 minutos de tiempo límite por trabajo
    });

    if (!jobId) {
      throw new PersistenceError('pg-boss rechazó el encolado del trabajo (retornó null).');
    }

    return jobId;
  } catch (err: any) {
    if (err instanceof PersistenceError) throw err;
    throw new PersistenceError(`Fallo al encolar trabajo en pg-boss: ${err.message}`);
  }
}
