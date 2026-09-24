/**
 * @file use-music-renderer.ts
 * @description Hook de integración React para el ciclo de vida de renderizado musical (Fase 1F).
 * Frontera no negociable: Este hook NO realiza cálculos musicales; únicamente
 * gestiona el ciclo de vida, target de renderizado, redibujado y disposición de recursos.
 */

import { useEffect, useRef, useState } from 'react';
import { type DerivedMusicalView } from '../../projection/derived-musical-view.ts';
import { type IMusicRenderer } from '../renderer-contract.ts';
import { RendererRegistry } from '../renderer-registry.ts';
import {
  type RendererDiagnostic,
  type RendererId,
  type RendererStatus,
} from '../types.ts';

export interface UseMusicRendererOptions {
  view: DerivedMusicalView | null;
  preferredRendererId?: RendererId | undefined;
  onDiagnostic?: ((diagnostic: RendererDiagnostic) => void) | undefined;
  onError?: ((error: RendererDiagnostic) => void) | undefined;
}

export interface UseMusicRendererResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeRendererId: RendererId | null;
  status: RendererStatus | 'IDLE';
  diagnostics: readonly RendererDiagnostic[];
  error: RendererDiagnostic | null;
}

const defaultRegistry = new RendererRegistry();

export function useMusicRenderer(options: UseMusicRendererOptions): UseMusicRendererResult {
  const { view, preferredRendererId, onDiagnostic, onError } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<IMusicRenderer | null>(null);

  const [activeRendererId, setActiveRendererId] = useState<RendererId | null>(null);
  const [status, setStatus] = useState<RendererStatus | 'IDLE'>('IDLE');
  const [diagnostics, setDiagnostics] = useState<readonly RendererDiagnostic[]>([]);
  const [error, setError] = useState<RendererDiagnostic | null>(null);

  useEffect(() => {
    if (!view || !containerRef.current) {
      setStatus('IDLE');
      return;
    }

    // 1. Determinar el renderizador a utilizar
    let targetRendererId: RendererId | undefined;
    if (preferredRendererId) {
      targetRendererId = preferredRendererId;
    } else {
      const best = defaultRegistry.selectBestRenderer(view.activeRepresentations);
      targetRendererId = best?.id;
    }

    if (!targetRendererId) {
      const errDiag: RendererDiagnostic = {
        severity: 'ERROR',
        code: 'UNSUPPORTED_RENDERER_CAPABILITY',
        message: `No se encontró ningún renderizador compatible para las representaciones: ${view.activeRepresentations.join(', ')}`,
      };
      setError(errDiag);
      setStatus('ERROR');
      if (onError) onError(errDiag);
      return;
    }

    // Reutilizar instancia si coincide en ID y está activa; crear fresca si cambió o fue desechada
    let renderer = rendererRef.current;
    if (!renderer || renderer.id !== targetRendererId || renderer.status === 'DISPOSED') {
      if (renderer && renderer.status !== 'DISPOSED') {
        try {
          renderer.dispose();
        } catch {
          // Ignorar fallos de limpieza previa
        }
      }
      try {
        renderer = defaultRegistry.createRenderer(targetRendererId);
        rendererRef.current = renderer;
      } catch (err: unknown) {
        const errDiag: RendererDiagnostic = {
          severity: 'ERROR',
          code: 'RENDERER_INITIALIZATION_FAILED',
          message: err instanceof Error ? err.message : String(err),
        };
        setError(errDiag);
        setStatus('ERROR');
        if (onError) onError(errDiag);
        return;
      }
    }

    setActiveRendererId(renderer.id);
    setStatus('RENDERING');
    setError(null);

    // 2. Inicializar renderizador con el target DOM si no está ya listo
    try {
      if (renderer.status === 'UNINITIALIZED') {
        renderer.initialize({
          id: `render-target-${renderer.id}`,
          container: containerRef.current,
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    } catch (err: unknown) {
      const errDiag: RendererDiagnostic = {
        severity: 'ERROR',
        code: 'RENDERER_INITIALIZATION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
      setError(errDiag);
      setStatus('ERROR');
      if (onError) onError(errDiag);
      return;
    }

    // 3. Ejecutar renderizado
    Promise.resolve(renderer.render(view))
      .then((output) => {
        setDiagnostics(output.diagnostics);

        if (output.diagnostics.length > 0 && onDiagnostic) {
          for (const d of output.diagnostics) {
            onDiagnostic(d);
          }
        }

        if (!output.success) {
          const firstErr = output.diagnostics.find((d: RendererDiagnostic) => d.severity === 'ERROR') ?? null;
          setError(firstErr);
          setStatus('ERROR');
          if (firstErr && onError) onError(firstErr);
        } else {
          setStatus('READY');
        }
      })
      .catch((err: unknown) => {
        const errDiag: RendererDiagnostic = {
          severity: 'ERROR',
          code: 'RENDERER_RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
        };
        setError(errDiag);
        setStatus('ERROR');
        if (onError) onError(errDiag);
      });

    // 4. Limpieza al desmontar
    return () => {
      // Si el componente se desmonta, liberar recursos
    };
  }, [view, preferredRendererId, onDiagnostic, onError]);

  // Limpieza total al desmontar el hook
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  return {
    containerRef,
    activeRendererId,
    status,
    diagnostics,
    error,
  };
}
