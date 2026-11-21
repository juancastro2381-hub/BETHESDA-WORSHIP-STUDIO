# DIGITAL MUSIC STAND FLOATING CONTROLS REPORT
## Bethesda Worship Studio

**Rama:** `feature/phase-1a-core-foundation`  
**Fecha:** 2026-11-17  
**Estado de validación en navegador:** **PENDING MANUAL VALIDATION**

---

## 1. Arquitectura y Motor Único de Autoscroll

La barra flotante [`AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx) se conecta directamente a una única instancia autoritativa de [`useAutoscroll`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts) en [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx):

- **Sin reproducción de audio:** Opera exclusivamente sobre el desplazamiento visual de lectura (`scrollTop`).
- **Un único bucle `requestAnimationFrame`:** `start()` cancela cualquier frame huérfano previo, mantiene idempotencia mediante `statusRef` síncrono y actualiza `virtualScrollTopRef` con acumulador subpíxel basado en tiempo transcurrido (`deltaSeconds <= 0.1s`).
- **Sincronización en pausa/redimensionamiento:** El listener pasivo de `scroll` y `resize` mantiene actualizado el porcentaje de progreso (`0%`–`100%`) sin disparar re-renders innecesarios.

---

## 2. Comportamiento de la Barra Flotante

| Control | Comportamiento implementado |
| :--- | :--- |
| **Autoscroll / Pausar / Reanudar** | Inicia desde la posición actual (`IDLE`/`COMPLETED`), cambia a **⏸ Pausar** con estado activo (`aria-pressed="true"`, `.is-active`) y permite **▶ Reanudar** desde la misma posición tras pausar. |
| **Detener (`⏹ Detener`)** | Cancela el `requestAnimationFrame` activo y pasa a `IDLE` **preservando la posición actual de lectura**; deshabilitado cuando ya está detenido/completado para evitar activación accidental. |
| **Inicio (`⏮ Inicio`)** | Detiene el desplazamiento activo, posiciona el viewport en `scrollTop = 0` y reinicia el progreso a `0%`. |
| **Selector de Velocidad** | Mantiene `0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x` con resaltado visual (`active`) y `aria-pressed`. |
| **Indicador de Progreso** | Barra horizontal (`role="progressbar"`) + porcentaje numérico (`0%`–`100%`) calculado sobre `scrollHeight - clientHeight` del contenedor real. |

---

## 3. Posicionamiento Responsivo y Accesibilidad

Implementado en [`index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css#L5550-L5610):
- **Desktop (`>= 1024px`) y Tablet (`768px–1023px`):** `position: sticky; top: 0.5rem; z-index: 40;` con contraste para tema oscuro y claro (`[data-theme="light"]`), borde dinámico según estado (`status-scrolling`, `status-paused`) y altura táctil mínima de `40px` en tablet/móvil.
- **Teléfonos móviles (`<= 767px`):** Dock flotante inferior fijo (`position: fixed; bottom: max(0.5rem, env(safe-area-inset-bottom)); left/right: max(0.5rem, env(safe-area-inset-*)); z-index: 60`), distribución compacta sin obstruir notas ni letras gracias a `padding-bottom: calc(8.5rem + env(safe-area-inset-bottom))` en `.musical-workspace-root`.
- **Accesibilidad:** Atributos `role="toolbar"`, `aria-label`, `aria-pressed`, `role="progressbar"`, `:focus-visible` visible (`2px solid #f59e0b`) y atajos `Espacio` / `Escape`.

---

## 4. Archivos Modificados

1. [`frontend/src/components/workspace/AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx)
2. [`frontend/src/core/autoscroll/use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts)
3. [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css)
4. [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts)

---

## 5. Validación Estática y Unitaria (Resultados Observados)

- `npm --prefix frontend run typecheck`: **PASS** (`0` errores).
- `npx tsx --test "src/core/autoscroll/__tests__/autoscroll.test.ts" "src/core/workspace/__tests__/reading-format-selector.test.ts" "src/core/workspace/__tests__/musical-completeness-remediation.test.ts"`: **24/24 PASS** (`3/3` suites, `0` fallos, `0` omitidos).

---

## 6. Lista de Aceptación Manual en Navegador (**PENDING MANUAL VALIDATION**)

1. Iniciar desplazamiento con **▶ Autoscroll** / **▶ Reanudar**.
2. Pausar con **⏸ Pausar** y reanudar desde la misma posición.
3. Pulsar **⏹ Detener** y verificar que detiene el bucle manteniendo la posición actual.
4. Pulsar **⏮ Inicio** y confirmar retorno a `0%` arriba del todo.
5. Probar las 6 velocidades (`0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x`).
6. Verificar progreso continuo de `0%` a `100%` y detención al final.
7. Confirmar que la barra permanece accesible durante todo el desplazamiento.
8. Confirmar al `100%` en móvil que la barra inferior no tapa la última línea de notas o letra.
9. Probar en **Partitura**, **Cifrado con Letra**, **Letra Sola** y **Tablatura**.
10. Probar en viewport de teléfono móvil (`< 768px`), tablet (`768px–1023px`) y desktop (`>= 1024px`).
11. Cambiar de instrumento y de canción comprobando ausencia de saltos.
12. Confirmar que no quedan bucles duplicados activos tras cambios rápidos de estado o formato.

---

## 7. Limitaciones Conocidas

- Si la obra completa cabe dentro del viewport (`maxScroll <= 2px`), no existe desplazamiento vertical y el progreso permanece en `0%` (o `100%` al intentar iniciar Autoscroll).
- La verificación visual interactiva en dispositivos reales queda pendiente de aceptación manual.
