/**
 * @file conversion-worker.ts
 * @description Worker autoritativo en segundo plano para el procesamiento de conversiones musicales (Fases 2A-R & 2A-R2).
 *
 * Implementa control estricto de concurrencia, arrendamientos distribuidos (leases),
 * testigo de ejecución (fencing token), latido de renovación (heartbeat),
 * recuperación consciente de arrendamientos expirados y protección de estados terminales / cancelación.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs, type BackgroundJobRow } from '../db/schema.ts';
import {
  LocalFileSystemSourceStorageProvider,
  type ISourceStorageProvider,
} from '../domain/ingestion/source-storage-provider.ts';
import {
  CONVERSION_QUEUE_NAME,
  type ConversionJobPayload,
  enqueueConversionJob,
  getConversionQueue,
  startConversionQueue,
} from '../infrastructure/queue/conversion-queue.ts';
import {
  ConversionEngine,
  FormatCapabilitiesEvaluator,
  type ConversionExportResult,
} from '../../../frontend/src/core/conversion/index.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

export class TransientWorkerError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'TransientWorkerError';
  }
}

export class WorkerLifecycleError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'WorkerLifecycleError';
  }
}

export class WorkerShutdownError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message, originalError !== undefined ? { cause: originalError } : undefined);
    this.name = 'WorkerShutdownError';
    if (originalError !== undefined && !this.cause) {
      (this as any).cause = originalError;
    }
  }
}

export function isTransientError(err: any): boolean {
  if (!err) return false;
  if (err instanceof TransientWorkerError || err?.name === 'TransientWorkerError') return true;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '').toLowerCase();
  return (
    code === 'econnreset' ||
    code === 'econnrefused' ||
    code === 'etimedout' ||
    code === '57p01' || // PostgreSQL admin shutdown
    code === '08006' || // PostgreSQL connection failure
    code === '08001' || // PostgreSQL unable to establish connection
    code === '40001' || // PostgreSQL serialization failure / deadlock
    msg.includes('connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('transient') ||
    msg.includes('transitorio') ||
    msg.includes('econnreset') ||
    msg.includes('deadlock')
  );
}

export type WorkerLifecycleState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR';

export interface WorkerStopOptions {
  timeoutMs?: number;
  throwOnError?: boolean;
}

export interface WorkerStopResult {
  readonly success: boolean;
  readonly state: WorkerLifecycleState;
  readonly offWorkSettled: boolean;
  readonly activeJobsDrained: boolean;
  readonly remainingJobsCount: number;
  readonly timedOut: boolean;
  readonly error?: unknown;
}

export interface ConversionWorkerOptions {
  recoveryIntervalMs?: number;
  onStageReached?: (stage: 'STAGE_A' | 'STAGE_B' | 'STAGE_C' | 'STAGE_D', jobId: string) => Promise<void> | void;
}

export class ConversionWorker {
  public static readonly LEASE_DURATION_MS = 60_000; // 60 segundos de validez de arrendamiento
  public static readonly HEARTBEAT_INTERVAL_MS = 15_000; // 15 segundos entre renovaciones de latido
  public static readonly DEFAULT_RECOVERY_INTERVAL_MS = 60_000; // 60 segundos por defecto entre pasadas de recuperación (WS03)

  public readonly workerId: string;
  private readonly engine: ConversionEngine;
  private readonly storage: ISourceStorageProvider;
  private readonly recoveryIntervalMs: number;
  private readonly onStageReached?: (stage: 'STAGE_A' | 'STAGE_B' | 'STAGE_C' | 'STAGE_D', jobId: string) => Promise<void> | void;
  private readonly activeJobIds = new Set<string>();
  private readonly activeJobCounts = new Map<string, number>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private startupRecoveryCount = 0;
  private periodicRecoveryCycleCount = 0;
  private totalRecoveryExecutions = 0;
  private isRecovering = false;
  private lifecycleState: WorkerLifecycleState = 'IDLE';
  private stoppingPromise: Promise<WorkerStopResult> | null = null;
  private startingPromise: Promise<void> | null = null;
  private pendingUnsubscribePromise: Promise<void> | null = null;
  private unsubscribeSettled = true;
  private lastShutdownError: unknown | null = null;
  private isShutdownTimedOut = false;
  private isQueueSubscribed = false;
  private subscriptionId: string | null = null;
  private lifecycleGeneration = 0;

  public constructor(
    private readonly db: Database = defaultDb,
    customStorage?: ISourceStorageProvider,
    customEngine?: ConversionEngine,
    customWorkerId?: string,
    options?: ConversionWorkerOptions
  ) {
    this.workerId =
      customWorkerId ??
      `worker_${process.pid}_${os.hostname()}_${crypto.randomUUID().slice(0, 8)}`;
    this.storage = customStorage ?? new LocalFileSystemSourceStorageProvider();
    this.engine = customEngine ?? new ConversionEngine();
    this.recoveryIntervalMs = options?.recoveryIntervalMs ?? ConversionWorker.DEFAULT_RECOVERY_INTERVAL_MS;
    this.onStageReached = options?.onStageReached;
  }

  public isActive(): boolean {
    return this.lifecycleState === 'RUNNING';
  }

  public getLifecycleState(): WorkerLifecycleState {
    return this.lifecycleState;
  }

  public getPendingUnsubscribeOperation(): Promise<void> | null {
    return this.pendingUnsubscribePromise;
  }

  public isUnsubscribePending(): boolean {
    return this.pendingUnsubscribePromise !== null && !this.unsubscribeSettled;
  }

  public getLastShutdownError(): unknown | null {
    return this.lastShutdownError;
  }

  public hasShutdownTimedOut(): boolean {
    return this.isShutdownTimedOut;
  }

  public isSubscribed(): boolean {
    return this.isQueueSubscribed;
  }

  public getSubscriptionId(): string | null {
    return this.subscriptionId;
  }

  public getLifecycleGeneration(): number {
    return this.lifecycleGeneration;
  }

  public resetLifecycle(): void {
    if (this.pendingUnsubscribePromise !== null && !this.unsubscribeSettled) {
      throw new WorkerLifecycleError(
        'No se puede restablecer el ciclo de vida mientras exista una operación de desuscripción pendiente.'
      );
    }
    if (this.isQueueSubscribed || (this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
      throw new WorkerLifecycleError(
        'No se puede restablecer el ciclo de vida mediante resetLifecycle(): el worker se encuentra en estado de error de desuscripción y la suscripción previa sigue potencialmente activa. ' +
        'resetLifecycle() no puede eludir esta condición sin una desuscripción confirmada. Ejecute recover() para reintentar la desuscripción o reinicie el proceso.'
      );
    }
    this.lifecycleState = 'STOPPED';
    this.lastShutdownError = null;
    this.isShutdownTimedOut = false;
  }

  public getActiveJobsCount(): number {
    return this.activeJobIds.size;
  }

  public getActiveJobIds(): ReadonlySet<string> {
    return new Set(this.activeJobIds);
  }

  public getStartupRecoveryCount(): number {
    return this.startupRecoveryCount;
  }

  public getPeriodicRecoveryCycleCount(): number {
    return this.periodicRecoveryCycleCount;
  }

  public getRecoveryCycleCount(): number {
    return this.startupRecoveryCount + this.periodicRecoveryCycleCount;
  }

  public getTotalRecoveryExecutions(): number {
    return this.totalRecoveryExecutions;
  }

  public isRecoveryActive(): boolean {
    return this.isRecovering;
  }

  private markJobActive(jobId: string): void {
    const current = this.activeJobCounts.get(jobId) ?? 0;
    this.activeJobCounts.set(jobId, current + 1);
    this.activeJobIds.add(jobId);
  }

  private markJobInactive(jobId: string): void {
    const current = this.activeJobCounts.get(jobId) ?? 1;
    if (current <= 1) {
      this.activeJobCounts.delete(jobId);
      this.activeJobIds.delete(jobId);
    } else {
      this.activeJobCounts.set(jobId, current - 1);
    }
  }

  /**
   * Inicia el worker y se suscribe autoritativamente a la cola pg-boss (CR-01).
   * Ejecuta además la recuperación segura y consciente de arrendamientos expirados al arranque (CR-04, WS03).
   * Idempotente ante llamadas repetidas de inicio y consciente del ciclo de vida.
   */
  public async start(): Promise<void> {
    // Si hay un stop() en progreso, esperar a que culmine su plazo
    if (this.stoppingPromise) {
      await this.stoppingPromise;
    }

    // Idempotencia ante llamadas repetidas en estado de ejecución activo
    if (this.lifecycleState === 'RUNNING') {
      return;
    }

    // Si ya existe una operación de inicio en curso, compartir la promesa (WS-R31-06)
    if (this.startingPromise) {
      return this.startingPromise;
    }

    // Si la desuscripción sigue pendiente (por timeout de stop previo o desuscripción lenta)
    if (this.pendingUnsubscribePromise !== null || !this.unsubscribeSettled) {
      throw new WorkerLifecycleError(
        'No se puede iniciar el worker: una operación previa de desuscripción (offWork) aún se encuentra pendiente de resolución.'
      );
    }

    // Si el worker quedó en estado ERROR por fallo de desuscripción
    if ((this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
      throw new WorkerLifecycleError(
        'No se puede iniciar el worker: el worker se encuentra en estado ERROR debido a un fallo previo de desuscripción. Ejecute recover() o stop() para recuperar el estado antes de iniciar.',
        this.lastShutdownError
      );
    }

    // Si la cola sigue potencialmente suscrita a pg-boss sin confirmación de remoción
    if (this.isQueueSubscribed) {
      throw new WorkerLifecycleError(
        'No se puede iniciar el worker: una suscripción previa a la cola pg-boss no ha sido removida de forma autoritativa. Ejecute recover() para reintentar la desuscripción antes de reiniciar.',
        this.lastShutdownError
      );
    }

    this.lifecycleState = 'STARTING';

    this.startingPromise = (async () => {
      try {
        await this.performStart();
      } finally {
        this.startingPromise = null;
      }
    })();

    return this.startingPromise;
  }

  private async performStart(): Promise<void> {
    try {
      // 1. Recuperar únicamente trabajos con arrendamiento expirado al arranque (CR-04, WS03)
      try {
        this.startupRecoveryCount++;
        await this.recoverStaleJobs();
      } catch (err) {
        console.warn('[ConversionWorker] Error no fatal en recuperación inicial de stale jobs al arrancar:', err);
      }

      // 2. Programar recuperación periódica recurrente y segura (WS03)
      if (!this.recoveryTimer && this.recoveryIntervalMs > 0) {
        this.recoveryTimer = setInterval(async () => {
          try {
            this.periodicRecoveryCycleCount++;
            await this.recoverStaleJobs();
          } catch (err) {
            console.error('[ConversionWorker] Error en ciclo periódico de recuperación de stale jobs:', err);
          }
        }, this.recoveryIntervalMs);
        if (this.recoveryTimer.unref) {
          this.recoveryTimer.unref();
        }
      }

      // 3. Iniciar pg-boss y registrar handler de trabajo
      const boss = await startConversionQueue();
      const subId = await boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, async (jobs) => {
        for (const job of jobs) {
          await this.processJob(job.data);
        }
      });

      this.subscriptionId = typeof subId === 'string' ? subId : null;
      this.isQueueSubscribed = true;
      this.lifecycleState = 'RUNNING';
    } catch (err) {
      this.lifecycleState = 'STOPPED';
      if (this.recoveryTimer) {
        clearInterval(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      throw err;
    }
  }

  /**
   * Detiene el worker de forma segura, acotada e idempotente (WS01/WS02):
   * 1. Cómputo del plazo límite (deadline) inmediato previo a cualquier espera asíncrona.
   * 2. Desactivación de banderas y cancelación inmediata de temporizador periódico (WS03).
   * 3. Desuscripción de pg-boss acotada por el plazo restante con rastreo autoritativo de la operación en segundo plano.
   * 4. Drenaje acotado de trabajos activos por el plazo restante.
   * 5. Si expira el plazo, no se bloquea indefinidamente; los trabajos incompletos
   *    permanecen en PROCESSING para que sus arrendamientos expiren naturalmente y sean recuperados.
   * 6. Idempotencia ante llamadas paralelas o secuenciales y compartición de la misma operación en curso.
   */
  public async stop(options?: number | WorkerStopOptions): Promise<WorkerStopResult> {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeoutMs ?? 5000);
    const throwOnError = typeof options === 'object' ? (options?.throwOnError ?? false) : false;

    // Si hay un arranque en curso, esperar a que culmine antes de apagar
    if (this.startingPromise) {
      try {
        await this.startingPromise;
      } catch {
        // Ignorar fallos de inicio para permitir que stop() limpie recursos
      }
    }

    // Si ya hay un apagado en curso, compartir la misma operación (WS02 / WS-R31-07)
    if (this.stoppingPromise) {
      return this.stoppingPromise;
    }

    // Si ya está detenido y limpio, retornar éxito de inmediato
    if (this.lifecycleState === 'IDLE' || this.lifecycleState === 'STOPPED') {
      if (this.activeJobIds.size === 0 && this.pendingUnsubscribePromise === null && !this.isQueueSubscribed) {
        if (this.recoveryTimer) {
          clearInterval(this.recoveryTimer);
          this.recoveryTimer = null;
        }
        return {
          success: true,
          state: this.lifecycleState,
          offWorkSettled: true,
          activeJobsDrained: true,
          remainingJobsCount: 0,
          timedOut: false,
        };
      }
    }

    this.lifecycleState = 'STOPPING';
    this.isShutdownTimedOut = false;

    this.stoppingPromise = (async () => {
      try {
        return await this.performStop(timeoutMs, throwOnError);
      } finally {
        this.stoppingPromise = null;
      }
    })();

    return this.stoppingPromise;
  }

  /**
   * Intenta una recuperación explícita y segura del ciclo de vida tras un fallo o timeout de desuscripción (WS01 / Regla C).
   * Reintenta de forma autoritativa la desuscripción de pg-boss y la remoción del consumidor.
   * Si la desuscripción tiene éxito y se verifica la remoción, restablece el worker a 'STOPPED'.
   * Si la desuscripción falla, preserva estrictamente el estado 'ERROR'.
   */
  public async recover(timeoutMs: number = 5000): Promise<WorkerStopResult> {
    if (this.lifecycleState === 'STOPPED' && !this.isQueueSubscribed && this.pendingUnsubscribePromise === null) {
      return {
        success: true,
        state: 'STOPPED',
        offWorkSettled: true,
        activeJobsDrained: true,
        remainingJobsCount: 0,
        timedOut: false,
      };
    }
    return this.stop({ timeoutMs, throwOnError: false });
  }

  private async performStop(timeoutMs: number, throwOnError: boolean = false): Promise<WorkerStopResult> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const operationGen = ++this.lifecycleGeneration;

    // 1. Detener ciclo recurrente de recuperación inmediatamente (WS02/WS03)
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    // 2. Cancelar suscripción a la cola en pg-boss de forma acotada y sin fugas de temporizadores (WS01/WS02)
    let timedOutDuringOffWork = false;
    let offWorkSettledThisCall = false;
    let offWorkErrorThisCall: unknown = null;

    try {
      const boss = getConversionQueue();

      if (!this.pendingUnsubscribePromise) {
        this.unsubscribeSettled = false;
        this.lastShutdownError = null;

        const unsubscribeTask = (async () => {
          try {
            // Invocar offWork dirigido específicamente a esta suscripción si se dispone de su id
            if (this.subscriptionId) {
              await boss.offWork(CONVERSION_QUEUE_NAME, { id: this.subscriptionId, wait: true });
            } else {
              await boss.offWork(CONVERSION_QUEUE_NAME, { wait: true });
            }

            // Verificación autoritativa obligatoria de remoción de consumidor (FAIL-CLOSED)
            // AC-01 / AC-02 / AC-03: La capacidad de verificación NO es opcional
            if (typeof (boss as any).getWipData !== 'function') {
              throw new WorkerShutdownError(
                'Fallo autoritativo de verificación de shutdown: la instancia de pg-boss no implementa getWipData() para auditar el estado de los consumidores.'
              );
            }

            const activeWorkers = (boss as any).getWipData();
            if (!Array.isArray(activeWorkers)) {
              throw new WorkerShutdownError(
                'Fallo autoritativo de verificación de shutdown: getWipData() retornó una respuesta malformada o inesperada (no es un arreglo).'
              );
            }

            // Verificar si el consumidor correspondiente a este worker aún permanece activo o no detenido en pg-boss
            const isTargetWorkerStillActive = activeWorkers.some((w: any) => {
              if (w.name !== CONVERSION_QUEUE_NAME) return false;
              if (this.subscriptionId) {
                return w.workId === this.subscriptionId || w.id === this.subscriptionId;
              }
              return true;
            });

            if (isTargetWorkerStillActive) {
              throw new WorkerShutdownError(
                `Fallo autoritativo de verificación de shutdown: pg-boss reporta que el consumidor (${this.subscriptionId ?? 'global'}) sigue activo o en estado no detenido tras offWork().`
              );
            }

            // Si esta operación pertenece a una generación previa que ya fue superada por una nueva, descartar mutación
            if (this.lifecycleGeneration !== operationGen) {
              return;
            }

            this.subscriptionId = null;
            this.isQueueSubscribed = false;
            this.unsubscribeSettled = true;
            this.pendingUnsubscribePromise = null;
            this.lastShutdownError = null;
            if (this.lifecycleState === 'STOPPING' || (this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
              this.lifecycleState = 'STOPPED';
            }
          } catch (err) {
            if (this.lifecycleGeneration !== operationGen) {
              return;
            }
            this.isQueueSubscribed = true;
            this.unsubscribeSettled = true;
            this.pendingUnsubscribePromise = null;
            this.lastShutdownError = err;
            this.lifecycleState = 'ERROR';
            throw err;
          }
        })();

        this.pendingUnsubscribePromise = unsubscribeTask.catch(() => {});
      }

      const remainingForOffWork = Math.max(0, deadline - Date.now());
      if (this.pendingUnsubscribePromise && !this.unsubscribeSettled) {
        if (remainingForOffWork > 0) {
          let offWorkTimer: NodeJS.Timeout | null = null;
          const timeoutPromise = new Promise<'TIMED_OUT'>((resolve) => {
            offWorkTimer = setTimeout(() => resolve('TIMED_OUT'), remainingForOffWork);
          });

          try {
            const raceResult = await Promise.race([
              this.pendingUnsubscribePromise.then(() => 'SETTLED'),
              timeoutPromise,
            ]);

            if (raceResult === 'TIMED_OUT') {
              timedOutDuringOffWork = true;
              this.isShutdownTimedOut = true;
            } else {
              offWorkSettledThisCall = true;
            }
          } finally {
            if (offWorkTimer) {
              clearTimeout(offWorkTimer);
              offWorkTimer = null;
            }
          }
        } else {
          timedOutDuringOffWork = true;
          this.isShutdownTimedOut = true;
        }
      } else {
        offWorkSettledThisCall = true;
      }
    } catch (err) {
      this.lastShutdownError = err;
      offWorkErrorThisCall = err;
      this.lifecycleState = 'ERROR';
    }

    // 3. Espera acotada para que trabajos activos terminen (Graceful Drain)
    while (this.activeJobIds.size > 0 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const step = Math.min(50, Math.max(1, remaining));
      await new Promise((resolve) => setTimeout(resolve, step));
    }

    const drained = this.activeJobIds.size === 0;
    const remainingJobsCount = this.activeJobIds.size;
    if (remainingJobsCount > 0) {
      console.warn(
        `[ConversionWorker] Graceful shutdown timeout (${timeoutMs}ms) alcanzado con ${remainingJobsCount} trabajo(s) aún en ejecución. Los arrendamientos expirarán para recuperación segura.`
      );
    }

    if (this.lastShutdownError || offWorkErrorThisCall) {
      this.lifecycleState = 'ERROR';
      const result: WorkerStopResult = {
        success: false,
        state: 'ERROR',
        offWorkSettled: true,
        activeJobsDrained: drained,
        remainingJobsCount,
        timedOut: false,
        error: this.lastShutdownError ?? offWorkErrorThisCall,
      };
      if (throwOnError) {
        throw new WorkerShutdownError(
          'Error durante la desuscripción de la cola en stop()',
          this.lastShutdownError ?? offWorkErrorThisCall
        );
      }
      return result;
    }

    if (timedOutDuringOffWork) {
      this.lifecycleState = 'STOPPING';
      const result: WorkerStopResult = {
        success: false,
        state: 'STOPPING',
        offWorkSettled: false,
        activeJobsDrained: drained,
        remainingJobsCount,
        timedOut: true,
      };
      if (throwOnError) {
        throw new WorkerShutdownError('Timeout durante la desuscripción de la cola');
      }
      return result;
    }

    if (!drained) {
      this.lifecycleState = 'STOPPED';
      const result: WorkerStopResult = {
        success: false,
        state: 'STOPPED',
        offWorkSettled: true,
        activeJobsDrained: false,
        remainingJobsCount,
        timedOut: true,
      };
      return result;
    }

    this.lifecycleState = 'STOPPED';
    return {
      success: true,
      state: 'STOPPED',
      offWorkSettled: true,
      activeJobsDrained: true,
      remainingJobsCount: 0,
      timedOut: false,
    };
  }

  /**
   * Procesa un trabajo de conversión con control de arrendamiento, testigo de ejecución (fencing)
   * y verificación de cancelación en cada etapa crítica (CR-02 & CR-03).
   */
  public async processJob(payload: ConversionJobPayload): Promise<ConversionExportResult> {
    const { jobId, storageKey, checksumSha256, filename, targetFormat, options } = payload;
    const executionToken = crypto.randomUUID(); // Testigo de ejecución único (fencing token)

    this.markJobActive(jobId);
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // =========================================================================
      // 1. Adquisición atómica de procesamiento y arrendamiento (CR-02)
      // =========================================================================
      const acquiredJob = await this.acquireJob(jobId, executionToken);

      if (!acquiredJob) {
        // El trabajo ya fue adquirido por otro worker activo, o fue cancelado / completado previamente
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: 'JOB_NOT_ACQUIRED',
              severity: 'WARNING',
              message: `El trabajo ${jobId} no pudo ser adquirido: se encuentra activo bajo otro arrendamiento o en estado terminal.`,
            },
          ],
        };
      }

      // =========================================================================
      // 2. Latido periódico de renovación de arrendamiento (Heartbeat)
      // =========================================================================
      let isCancelledOrSuperseded = false;
      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await this.renewHeartbeat(jobId, executionToken);
          if (!renewed) {
            isCancelledOrSuperseded = true;
          }
        } catch {
          // Ignorar fallas transitorias de red en latidos individuales
        }
      }, ConversionWorker.HEARTBEAT_INTERVAL_MS);

      // -----------------------------------------------------------------------
      // Etapa A (30%): Verificación de propiedad activa y lectura de fuente
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_A', jobId);
      }

      const sourceBuffer = await this.storage.getBuffer(storageKey);
      const computedHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

      if (computedHash !== checksumSha256) {
        throw new Error(
          `Violación de Integridad Criptográfica: El hash del archivo en disco (${computedHash}) no coincide con el registrado (${checksumSha256}).`
        );
      }

      await this.updateProgressFenced(jobId, executionToken, 30);

      // -----------------------------------------------------------------------
      // Etapa B (50%): Detección de formato y categoría
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_B', jobId);
      }

      const sourceCategory = FormatCapabilitiesEvaluator.detectSourceCategory(filename, sourceBuffer);

      if (sourceCategory === 'UNKNOWN_UNSUPPORTED') {
        const errCode = 'UNKNOWN_OR_UNSUPPORTED_FORMAT';
        const unsupportedMsg = `El archivo "${filename}" no es un formato musical soportado o su contenido no contiene datos de notación musical válidos. Se rechaza por fail-closed format validation.`;
        await this.failJobFenced(jobId, executionToken, errCode, unsupportedMsg);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: unsupportedMsg,
            },
          ],
        };
      }

      if (
        sourceCategory === 'AUDIO_RECORDING' ||
        sourceCategory === 'VIDEO_REFERENCE' ||
        sourceCategory === 'PDF_SCORE' ||
        sourceCategory === 'IMAGE_SCORE' ||
        sourceCategory === 'TABLATURE_ASCII'
      ) {
        const isTab = sourceCategory === 'TABLATURE_ASCII';
        const errCode = isTab ? 'TABLATURE_INGESTION_UNSUPPORTED' : 'SOURCE_CATEGORY_DEFERRED_PHASE';
        const deferredError = isTab
          ? `La ingesta y conversión directa de tablaturas ASCII (.tab) no está soportada en esta versión. El motor de tablatura está planificado para la Fase 2B.`
          : `La fuente "${filename}" (${sourceCategory}) requiere transcripción o digitalización óptica diferida para Fase 2B.`;
        await this.failJobFenced(jobId, executionToken, errCode, deferredError);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: deferredError,
            },
          ],
        };
      }

      // Validar viabilidad de conversión frente al principio de Cero Fabricación
      const caps = FormatCapabilitiesEvaluator.getFormatCapabilities(sourceCategory);
      const requestedCap = caps.find((c) => c.format === targetFormat);
      if (!requestedCap || !requestedCap.isAvailable) {
        const errCode = requestedCap?.statusBadge === 'BLOCKED_ZERO_FABRICATION'
          ? 'ZERO_FABRICATION_VIOLATION'
          : 'UNSUPPORTED_CONVERSION';
        const capMsg = requestedCap?.blockingReason ?? `Conversión de "${sourceCategory}" hacia "${targetFormat}" no es viable o carece de información musical esencial.`;
        await this.failJobFenced(jobId, executionToken, errCode, capMsg);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: capMsg,
            },
          ],
        };
      }

      const contentString = new TextDecoder('utf-8', { fatal: false }).decode(sourceBuffer);
      await this.updateProgressFenced(jobId, executionToken, 70);

      // -----------------------------------------------------------------------
      // Etapa C (70% - 90%): Transpilación musical y opciones de transposición
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_C', jobId);
      }

      const exportResult = this.engine.convertSource(contentString, filename, {
        targetFormat,
        transposeSemitones: options?.transposeSemitones,
        keyOverride: options?.keyOverride,
        bpmOverride: options?.bpmOverride,
        timeSignatureOverride: options?.timeSignatureOverride,
      });

      await this.updateProgressFenced(jobId, executionToken, 90);

      // -----------------------------------------------------------------------
      // Etapa D (100%): Evaluación final y persistencia de resultados con Fencing
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_D', jobId);
      }

      if (!exportResult.success) {
        await this.failJobFenced(
          jobId,
          executionToken,
          'CONVERSION_FAILED',
          'Error durante la serialización al formato destino',
          { diagnostics: exportResult.diagnostics }
        );
        return exportResult;
      }

      const hasWarnings = exportResult.diagnostics.some((d) => d.severity === 'WARNING');
      const finalStatus = hasWarnings ? 'REVIEW_REQUIRED' : 'COMPLETED';

      const isBinary = exportResult.content instanceof Uint8Array;
      const dataStr = isBinary
        ? Buffer.from(exportResult.content as Uint8Array).toString('base64')
        : (exportResult.content as string);

      const canonicalPayloadJSON = exportResult.canonicalPayload
        ? CanonicalSerializer.serialize(exportResult.canonicalPayload)
        : null;

      // Actualización atómica terminal sujeta al testigo de ejecución (CR-02 & CR-03)
      const [finalizedJob] = await this.db
        .update(backgroundJobs)
        .set({
          status: finalStatus,
          progress: 100,
          outputRef: exportResult.filename,
          errorDetails: {
            targetFormat: exportResult.targetFormat,
            mimeType: exportResult.mimeType,
            isBinary,
            data: dataStr,
            diagnostics: exportResult.diagnostics,
            canonicalPayload: canonicalPayloadJSON, // CR-06
            storageKey,
            checksumSha256,
            options: options ?? {},
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(backgroundJobs.id, jobId),
            eq(backgroundJobs.leaseToken, executionToken),
            eq(backgroundJobs.status, 'PROCESSING')
          )
        )
        .returning({ id: backgroundJobs.id });

      if (!finalizedJob) {
        // La actualización terminal falló porque el trabajo fue cancelado o el arrendamiento expiró
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      return exportResult;
    } catch (err: any) {
      const isTransient = isTransientError(err);
      let attempts = 1;
      let maxAttempts = 3;

      try {
        const [currentJob] = await this.db
          .select({ attempts: backgroundJobs.attempts, maxAttempts: backgroundJobs.maxAttempts })
          .from(backgroundJobs)
          .where(eq(backgroundJobs.id, jobId));
        if (currentJob) {
          attempts = currentJob.attempts;
          maxAttempts = currentJob.maxAttempts;
        }
      } catch {
        // Fallback a valores por defecto
      }

      if (isTransient && attempts < maxAttempts) {
        // Error transitorio con reintentos disponibles: resetear arrendamiento y propagar a pg-boss
        await this.db
          .update(backgroundJobs)
          .set({
            status: 'PENDING',
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            progress: 0,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(backgroundJobs.id, jobId),
              eq(backgroundJobs.leaseToken, executionToken),
              eq(backgroundJobs.status, 'PROCESSING')
            )
          )
          .catch((dbErr) => {
            console.error(`[ConversionWorker] Error al resetear arrendamiento para reintento de job ${jobId}:`, dbErr);
          });

        throw err;
      }

      // Fallo permanente o reintentos agotados
      const errorCode = isTransient ? 'RETRIES_EXHAUSTED' : 'WORKER_PROCESSING_EXCEPTION';
      await this.failJobFenced(jobId, executionToken, errorCode, err.message);
      return {
        success: false,
        targetFormat,
        filename,
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: errorCode,
            severity: 'ERROR',
            message: err.message,
          },
        ],
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      this.markJobInactive(jobId);
    }
  }

  /**
   * Recupera trabajos que hayan quedado en estado PROCESSING con arrendamiento genuinamente expirado (CR-04).
   * Emplea un reclamo atómico de recuperación para evitar colisiones y garantiza que si el reencolado
   * en pg-boss falla, el trabajo no quede en el limbo sino inmediatamente recoverable en la siguiente pasada.
   */
  public async recoverStaleJobs(): Promise<number> {
    if (this.isRecovering) return 0;
    this.isRecovering = true;

    try {
      this.totalRecoveryExecutions++;
      const now = new Date();
      const expiredJobs = await this.db
        .select()
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.jobType, 'CONVERSION'),
            eq(backgroundJobs.status, 'PROCESSING'),
            lt(backgroundJobs.leaseExpiresAt, now)
          )
        );

      let recoveredCount = 0;

      for (const job of expiredJobs) {
        if (job.attempts >= job.maxAttempts) {
          // Excedió el límite de reintentos: marcar definitivamente como FAILED
          await this.db
            .update(backgroundJobs)
            .set({
              status: 'FAILED',
              progress: 100,
              errorCode: 'LEASE_EXPIRED_MAX_ATTEMPTS',
              errorDetails: {
                code: 'LEASE_EXPIRED_MAX_ATTEMPTS',
                message: `El trabajo excedió el límite máximo de reintentos (${job.maxAttempts}) tras expiración de arrendamiento.`,
                previousDetails: job.errorDetails,
              },
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(backgroundJobs.id, job.id),
                eq(backgroundJobs.status, 'PROCESSING'),
                lt(backgroundJobs.leaseExpiresAt, now)
              )
            );
          recoveredCount++;
        } else {
          // Reclamo atómico de recuperación con testigo y tiempo acotado
          const recoveryToken = crypto.randomUUID();
          const recoveryLeaseExpires = new Date(Date.now() + 30_000); // 30s de ventana

          const [claimed] = await this.db
            .update(backgroundJobs)
            .set({
              leaseOwner: `recovery_${this.workerId}`,
              leaseToken: recoveryToken,
              leaseExpiresAt: recoveryLeaseExpires,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(backgroundJobs.id, job.id),
                eq(backgroundJobs.status, 'PROCESSING'),
                lt(backgroundJobs.leaseExpiresAt, now)
              )
            )
            .returning();

          if (claimed) {
            const details = job.errorDetails as any;
            if (details?.storageKey && details?.checksumSha256) {
              try {
                await enqueueConversionJob({
                  jobId: job.id,
                  userId: job.userId ?? 'system',
                  tenantId: job.tenantId,
                  storageKey: details.storageKey,
                  checksumSha256: details.checksumSha256,
                  filename: job.inputRef,
                  targetFormat: details.targetFormat ?? 'CHORD_PRO',
                  options: details.options,
                });

                // Reencolado exitoso: resetear a PENDING y liberar arrendamiento
                await this.db
                  .update(backgroundJobs)
                  .set({
                    status: 'PENDING',
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    progress: 0,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(backgroundJobs.id, job.id),
                      eq(backgroundJobs.leaseToken, recoveryToken)
                    )
                  );
                recoveredCount++;
              } catch (reEnqueueErr) {
                console.warn(`[ConversionWorker] Fallo al reencolar trabajo ${job.id}, liberando arrendamiento:`, reEnqueueErr);
                // Si falla el reencolado, expirar de inmediato el arrendamiento para reintentarlo en el próximo ciclo
                await this.db
                  .update(backgroundJobs)
                  .set({
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: new Date(Date.now() - 10_000),
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(backgroundJobs.id, job.id),
                      eq(backgroundJobs.leaseToken, recoveryToken)
                    )
                  );
              }
            } else {
              // Metadatos insuficientes para reencolado
              await this.db
                .update(backgroundJobs)
                .set({
                  status: 'FAILED',
                  progress: 100,
                  errorCode: 'RECOVERY_MISSING_METADATA',
                  errorDetails: {
                    code: 'RECOVERY_MISSING_METADATA',
                    message: 'El trabajo no cuenta con storageKey o checksumSha256 para ser reencolado.',
                  },
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(backgroundJobs.id, job.id),
                    eq(backgroundJobs.leaseToken, recoveryToken)
                  )
                );
              recoveredCount++;
            }
          }
        }
      }

      return recoveredCount;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Adquisición atómica de procesamiento y arrendamiento (CR-02).
   */
  public async acquireJob(
    jobId: string,
    executionToken: string
  ): Promise<BackgroundJobRow | null> {
    const leaseExpiresAt = new Date(Date.now() + ConversionWorker.LEASE_DURATION_MS);
    const now = new Date();

    const [acquiredJob] = await this.db
      .update(backgroundJobs)
      .set({
        status: 'PROCESSING',
        leaseOwner: this.workerId,
        leaseToken: executionToken,
        leaseExpiresAt,
        heartbeatAt: now,
        attempts: sql`${backgroundJobs.attempts} + 1`,
        progress: 10,
        startedAt: sql`COALESCE(${backgroundJobs.startedAt}, NOW())`,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          or(
            eq(backgroundJobs.status, 'PENDING'),
            and(
              eq(backgroundJobs.status, 'PROCESSING'),
              lt(backgroundJobs.leaseExpiresAt, now)
            )
          )
        )
      )
      .returning();

    return acquiredJob ?? null;
  }

  /**
   * Renueva el latido de arrendamiento de un trabajo en ejecución (CR-02).
   */
  public async renewHeartbeat(
    jobId: string,
    executionToken: string
  ): Promise<boolean> {
    const [renewed] = await this.db
      .update(backgroundJobs)
      .set({
        leaseExpiresAt: new Date(Date.now() + ConversionWorker.LEASE_DURATION_MS),
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning({ id: backgroundJobs.id });

    return !!renewed;
  }

  /**
   * Verifica que el worker aún mantenga la propiedad activa del trabajo (CR-02 & CR-03).
   */
  public async verifyOwnershipAndActive(jobId: string, executionToken: string): Promise<boolean> {
    const [row] = await this.db
      .select({
        status: backgroundJobs.status,
        leaseToken: backgroundJobs.leaseToken,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId));

    if (!row) return false;
    if (row.status !== 'PROCESSING') return false;
    if (row.leaseToken !== executionToken) return false;
    return true;
  }

  /**
   * Actualiza el progreso de forma vallada (fenced) verificando testigo y estado activo (CR-02).
   */
  public async updateProgressFenced(
    jobId: string,
    executionToken: string,
    progress: number
  ): Promise<boolean> {
    const [updated] = await this.db
      .update(backgroundJobs)
      .set({
        progress,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning({ id: backgroundJobs.id });

    return !!updated;
  }

  private async failJobFenced(
    jobId: string,
    executionToken: string,
    errorCode: string,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'FAILED',
        progress: 100,
        errorCode,
        errorDetails: {
          code: errorCode,
          message,
          ...(extra ?? {}),
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      );
  }

  private abortDueToCancellation(
    targetFormat: any,
    filename: string,
    jobId: string
  ): ConversionExportResult {
    return {
      success: false,
      targetFormat,
      filename,
      mimeType: 'text/plain',
      content: '',
      diagnostics: [
        {
          code: 'JOB_CANCELLED_OR_LEASE_LOST',
          severity: 'WARNING',
          message: `El procesamiento del trabajo ${jobId} fue abortado de forma segura debido a cancelación o pérdida de arrendamiento.`,
        },
      ],
    };
  }
}
