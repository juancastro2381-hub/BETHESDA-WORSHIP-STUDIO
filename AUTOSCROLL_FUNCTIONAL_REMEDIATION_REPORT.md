# AUTOSCROLL FUNCTIONAL REMEDIATION REPORT
## Bethesda Worship Studio — Digital Music Stand (WP-05)

**Rama:** `feature/phase-1a-core-foundation`  
**Fecha:** 2026-11-17  
**Estado de validación en navegador:** **PENDING MANUAL VALIDATION**

---

## 1. Causas Raíz Identificadas

1. **Contenedor desplazable incorrecto (`maxScroll <= 0` inmediato):**
   - `<main ref={viewportRef} className="workspace-viewport-area">` en [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L851-L862) solo define `width: 100%` en [`index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css#L1091-L1093) sin `height`/`max-height` ni `overflow-y: auto`.
   - El contenido musical expande `<main>`, de modo que `scrollHeight - clientHeight === 0` y el desplazamiento real ocurre en el documento raíz (`document.scrollingElement` / `window`).
   - `resolveScrollTarget(viewportRef.current)` devolvía `viewportRef.current` cuando ningún descendiente tenía overflow, haciendo que `scrollLoop` terminara en el primer frame con `COMPLETED` sin desplazar la pantalla.
2. **Condición de carrera síncrona con `statusRef`:**
   - `start()` llamaba `setStatus('SCROLLING')` (asíncrono en React) y lanzaba `requestAnimationFrame(scrollLoop)` antes de actualizar `statusRef.current`. Si el frame se ejecutaba antes del re-render, `statusRef.current !== 'SCROLLING'` cancelaba el bucle inmediatamente.
3. **Truncamiento subpíxel en pantallas de 60Hz–144Hz:**
   - `container.scrollTop += deltaSeconds * baseSpeed * speedRef.current` producía incrementos `< 0.5px` por frame en `0.5x`/`0.75x`/`1.0x`, truncándose a `0` al asignarse a `scrollTop`.
4. **Escucha de interacción manual limitada al `<main>` no desplazable:**
   - Los listeners de `wheel`/`touchstart` no escuchaban sobre `window` cuando el scroll ocurría en el documento raíz, y la barra `.autoscroll-control-bar` salía de pantalla al bajar por la partitura.

---

## 2. Archivos Modificados

1. [`frontend/src/core/autoscroll/use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts)
2. [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css#L5550-L5565)
3. [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts)

---

## 3. Corrección Técnica Implementada

- **Arquitectura de resolución de contenedor (`resolveScrollTarget`):**
  1. Prioriza contenedores anidados explícitamente desplazables (`.visual-document-viewport`, `.score-viewport-container`, `[data-scrollable="true"]`) cuando tienen `overflow-y: auto/scroll` y `scrollHeight - clientHeight > 2`.
  2. Verifica si el propio elemento `containerRef.current` posee `overflow-y: auto/scroll` y desbordamiento vertical real.
  3. En caso contrario (layout estándar de flujo en página para Partitura, Cifrado con Letra, Letra Sola y Tablatura), resuelve a `document.scrollingElement ?? document.documentElement`.
- **Cálculo de velocidad basado en tiempo (`requestAnimationFrame`):**
  - Base `35 px/s` multiplicada por el selector (`0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x`).
  - `deltaSeconds` acotado a `[0, 0.1]` s (máximo `100 ms` por frame) para evitar saltos tras cambios de pestaña o pausas del hilo.
  - Acumulador flotante `virtualScrollTopRef` que preserva fracciones subpíxel entre frames y solo escribe `container.scrollTop` (nunca `scrollLeft`, evitando scroll horizontal).
- **Ciclo de vida y limpieza:**
  - Actualización síncrona de `statusRef.current` en `start()`, `pause()`, `stop()` y `reset()`.
  - Idempotencia en `start()` (cancela cualquier frame previo y evita loops duplicados).
  - Detención automática exacta en `maxScroll` (`COMPLETED`, `100%`) y reinicio limpio al volver a pulsar `Autoscroll` desde el final.
  - Pausa automática en `visibilitychange` cuando `document.hidden === true`, limpieza de `requestAnimationFrame` y `setTimeout` en desmontaje, y escucha de `wheel`/`touchstart` en `containerRef.current` y `window`.
  - `.autoscroll-control-bar` con `position: sticky; top: 0.5rem; z-index: 40;` para mantener controles siempre accesibles durante la lectura.

---

## 4. Validación Estática y Unitaria

- `npm --prefix frontend run typecheck`: **PASS** (`0` errores).
- `npx tsx --test "src/core/autoscroll/__tests__/autoscroll.test.ts"` (en `frontend/`): **9/9 PASS** (`0` fallos, `0` omitidos), incluyendo la nueva prueba #9 de `resolveScrollTarget`.

---

## 5. Procedimiento de Aceptación Manual en Navegador (**PENDING MANUAL VALIDATION**)

1. Abrir una canción extensa en el Atril Digital y pulsar **▶ Autoscroll**: confirmar que la barra permanece visible (`sticky`) arriba y la partitura/letra avanza suavemente hacia abajo.
2. Pulsar **⏸ Pausar**: confirmar que el movimiento se detiene en la posición actual.
3. Pulsar **▶ Reanudar**: confirmar que continúa desde la posición actual sin saltar al inicio.
4. Probar las 6 velocidades (`0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x`): confirmar diferencia visible de rapidez, fluidez en `0.5x` y ausencia de saltos.
5. Dejar llegar hasta el final: confirmar detención automática al final del contenido musical (`100%`).
6. Cambiar entre **Partitura**, **Cifrado con Letra**, **Letra Sola** y **Tablatura** y repetir inicio/pausa.
7. Cambiar entre instrumentos (**Guitarra**, **Bajo**, **Piano**) y repetir inicio/pausa.
8. Realizar scroll manual con rueda o pantalla táctil mientras Autoscroll está activo: confirmar pausa temporal durante el período de gracia y reanudación desde la nueva posición manual sin retrocesos.
9. Cambiar de pestaña del navegador y regresar: confirmar que Autoscroll se pausó sin saltos bruscos.
10. Verificar ausencia total de scroll horizontal y de bucles duplicados.

---

## 6. Limitaciones Conocidas

- Si el contenido completo de una canción cabe dentro de la altura de la ventana (`maxScroll <= 2px`), Autoscroll pasa a estado `COMPLETED` (`100%`) porque no existe desbordamiento vertical que desplazar.
- La validación interactiva en navegador real queda pendiente de ejecución manual por el Project Owner.
