/**
 * @file python-audio-worker-bridge.ts
 * @description Puente de comunicación IPC seguro (stdin/stdout JSON lines) entre el backend TypeScript
 * y el worker local de audio en Python (WS-AUDIO-01).
 *
 * Principios:
 * 1. Proceso local aislado y reproducible (virtualenv dedicado en workers/audio_worker/.venv).
 * 2. CERO llamadas a APIs comerciales externas ni transcripción en la nube.
 * 3. Timeout acotado y cancelación determinista (kill por desborde o bloqueo).
 * 4. Captura estructurada de eventos de progreso y errores tipados.
 * 5. CERO filtración de rutas sensibles, credenciales o datos binarios en logs.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PythonWorkerPingResult {
  readonly status: string;
  readonly workerVersion: string;
  readonly pythonVersion: string;
}

export interface PythonWorkerInspectResult {
  readonly contractVersion: string;
  readonly workerVersion: string;
  readonly verifiedSha256: string;
  readonly fileSizeBytes: number;
  readonly detectedFormat: string;
  readonly mimeType: string;
  readonly hasId3v2: boolean;
  readonly id3TagSizeBytes: number;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
  readonly bitrateKbps: number | null;
  readonly durationMs: number | null;
  readonly mpegFrameCount: number | null;
  readonly pcmDecodeVerified: boolean;
  readonly decoderUsed: string;
  readonly derivativePcmPath: string | null;
  readonly derivativePcmSha256: string | null;
  readonly derivativePcmBytes: number | null;
  readonly warnings: readonly string[];
  readonly pythonVersion: string;
}

export interface WorkerProgressCallback {
  (progressPercent: number, stage: string): void;
}

export interface InspectAudioOptions {
  readonly derivativeWavPath?: string;
  readonly timeoutMs?: number;
  readonly onProgress?: WorkerProgressCallback;
}

export class PythonWorkerError extends Error {
  public readonly errorCode: string;

  public constructor(message: string, errorCode = 'PYTHON_WORKER_ERROR') {
    super(message);
    this.name = 'PythonWorkerError';
    this.errorCode = errorCode;
  }
}

export class PythonAudioWorkerBridge {
  private pythonExecutable: string | null = null;
  private workerScriptPath: string;

  public constructor(customPythonPath?: string, customScriptPath?: string) {
    const repoRoot = path.resolve(__dirname, '../../../../');
    this.workerScriptPath =
      customScriptPath ?? path.resolve(repoRoot, 'workers/audio_worker/main.py');
    if (customPythonPath) {
      this.pythonExecutable = customPythonPath;
    }
  }

  /**
   * Resuelve el ejecutable de Python priorizando el entorno virtual local de workers/audio_worker.
   */
  public resolvePythonExecutable(): string {
    if (this.pythonExecutable && fs.existsSync(this.pythonExecutable)) {
      return this.pythonExecutable;
    }

    const repoRoot = path.resolve(__dirname, '../../../../');
    const venvWindows = path.resolve(repoRoot, 'workers/audio_worker/.venv/Scripts/python.exe');
    const venvUnix = path.resolve(repoRoot, 'workers/audio_worker/.venv/bin/python');

    if (process.env.PYTHON_WORKER_PATH && fs.existsSync(process.env.PYTHON_WORKER_PATH)) {
      this.pythonExecutable = process.env.PYTHON_WORKER_PATH;
      return this.pythonExecutable;
    }

    if (fs.existsSync(venvWindows)) {
      this.pythonExecutable = venvWindows;
      return this.pythonExecutable;
    }

    if (fs.existsSync(venvUnix)) {
      this.pythonExecutable = venvUnix;
      return this.pythonExecutable;
    }

    // Fallback a python disponible en el sistema
    this.pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
    return this.pythonExecutable;
  }

  /**
   * Envía un comando PING al worker para verificar su disponibilidad y versión.
   */
  public async ping(timeoutMs = 5000): Promise<PythonWorkerPingResult> {
    const pythonExe = this.resolvePythonExecutable();
    const jobId = `ping-${Date.now()}`;
    const requestPayload = {
      contractVersion: '1.0',
      jobId,
      command: 'PING',
    };

    const data = await this.executeSubprocess(pythonExe, requestPayload, timeoutMs);
    return data as unknown as PythonWorkerPingResult;
  }

  /**
   * Solicita al worker inspección binaria profunda, hash SHA-256 y decodificación PCM.
   */
  public async inspectAndVerifyAudio(
    jobId: string,
    sourcePath: string,
    expectedSha256: string,
    options: InspectAudioOptions = {}
  ): Promise<PythonWorkerInspectResult> {
    const pythonExe = this.resolvePythonExecutable();
    const timeoutMs = options.timeoutMs ?? 30000;

    const requestPayload = {
      contractVersion: '1.0',
      jobId,
      command: 'INSPECT_AND_VERIFY_AUDIO',
      sourcePath: path.resolve(sourcePath),
      expectedSha256,
      ...(options.derivativeWavPath ? { derivativeWavPath: path.resolve(options.derivativeWavPath) } : {}),
    };

    const data = await this.executeSubprocess(
      pythonExe,
      requestPayload,
      timeoutMs,
      options.onProgress
    );

    return data as unknown as PythonWorkerInspectResult;
  }

  private executeSubprocess(
    pythonExe: string,
    requestPayload: Record<string, unknown>,
    timeoutMs: number,
    onProgress?: WorkerProgressCallback
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      let timer: NodeJS.Timeout | null = null;
      let childStdout = '';
      let childStderr = '';

      const settle = (err?: Error, result?: Record<string, unknown>) => {
        if (isSettled) return;
        isSettled = true;
        if (timer) clearTimeout(timer);
        if (err) {
          reject(err);
        } else {
          resolve(result!);
        }
      };

      const proc = spawn(pythonExe, [this.workerScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      timer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 2000);
        } catch {
          // ignore kill errors
        }
        settle(new PythonWorkerError(`Tiempo de espera agotado (${timeoutMs}ms) en el worker de audio Python.`, 'WORKER_TIMEOUT'));
      }, timeoutMs);

      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });

      let finalResult: Record<string, unknown> | null = null;
      let caughtError: PythonWorkerError | null = null;

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'PROGRESS' && onProgress && typeof parsed.progress === 'number') {
            onProgress(parsed.progress, parsed.stage || '');
          } else if (parsed.type === 'RESULT' && parsed.data) {
            finalResult = parsed.data;
          } else if (parsed.type === 'ERROR') {
            caughtError = new PythonWorkerError(
              parsed.message || 'Error desconocido del worker de audio Python.',
              parsed.errorCode || 'WORKER_ERROR'
            );
          }
        } catch {
          childStdout += trimmed + '\n';
        }
      });

      proc.stderr.on('data', (chunk) => {
        childStderr += chunk.toString();
      });

      proc.on('error', (err) => {
        settle(new PythonWorkerError(`Fallo al iniciar el worker de audio Python (${pythonExe}): ${err.message}`, 'SPAWN_ERROR'));
      });

      proc.on('close', (code) => {
        if (isSettled) return;

        if (caughtError) {
          return settle(caughtError);
        }

        if (code !== 0 && !finalResult) {
          return settle(
            new PythonWorkerError(
              `El worker de audio Python finalizó con código de error ${code}. Detalle: ${childStderr.trim() || childStdout.trim() || 'Sin salida.'}`,
              'PROCESS_EXIT_ERROR'
            )
          );
        }

        if (finalResult) {
          return settle(undefined, finalResult);
        }

        settle(
          new PythonWorkerError(
            `El worker finalizó sin emitir ningún resultado estructurado. Detalle: ${childStderr.trim() || childStdout.trim()}`,
            'EMPTY_RESULT'
          )
        );
      });

      // Escribir el payload JSON y cerrar stdin
      proc.stdin.write(JSON.stringify(requestPayload) + '\n');
      proc.stdin.end();
    });
  }
}

export const globalPythonAudioWorkerBridge = new PythonAudioWorkerBridge();
