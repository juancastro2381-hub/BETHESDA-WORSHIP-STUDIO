# DIGITAL MUSIC STAND — ISOLATED SCROLL ARCHITECTURE REPORT
## Bethesda Worship Studio

**Rama:** `feature/phase-1a-core-foundation`  
**Fecha:** 2026-11-17  
**Estado de validación en navegador:** **PENDING MANUAL VALIDATION**

---

## 1. Comportamiento Previo y Causa Raíz

- En el layout original, `.workspace-viewport-area` (`<main ref={viewportRef}>`) no tenía `height`/`max-height` ni `overflow-y: auto`. Como resultado, la partitura expandía el documento entero y el único desplazamiento posible ocurría en la ventana global del navegador, moviendo cabecera, metadatos, controles de instrumento, barra de Autoscroll y navegación junto con la partitura.
- Al intentar hacer fallback hacia `document.scrollingElement`, Autoscroll movía toda la página de la aplicación en lugar de mover únicamente el área de lectura musical.

---

## 2. Nueva Arquitectura DOM / Viewport Aislado

```text
+-------------------------------------------------------------------+
| Cabecera / SongHeader / Selector de Canción y Versión (ESTACIONARIO)
+-------------------------------------------------------------------+
| MusicalControls / RendererStatus (ESTACIONARIO)                   |
+-------------------------------------------------------------------+
| AutoscrollControl (Toolbar flotante fuera del scroll musical)     |
+-------------------------------------------------------------------+
| <main ref={viewportRef} class="workspace-viewport-area"           |
|       data-scrollable="true">                                     |
|   -> overflow-y: auto; overflow-x: hidden;                        |
|   -> overscroll-behavior-y: contain;                              |
|   -> ÚNICO contenedor desplazado por Autoscroll y scroll manual   |
|   [ MusicalScoreRenderer / VisualDocumentStand ]                  |
+-------------------------------------------------------------------+
```

- **Propiedad del scroll:** `.workspace-viewport-area` posee su propio `scrollTop` y `scrollHeight` acotados por viewport (`clamp(440px, calc(100dvh - 240px), 820px)` en desktop; `calc(100dvh - 150px)` en modo Atril; `clamp(400px, calc(100dvh - 210px), 780px)` en tablet; `calc(100dvh - 265px - env(safe-area-inset-bottom))` en móvil).
- **Motor exclusivo (`useAutoscroll`):** `resolveScrollTarget()` apunta únicamente al visor visual anidado (`.visual-document-viewport` / `.score-viewport-container` cuando existe) o al propio `viewportRef.current` (`.workspace-viewport-area`). No existen llamadas a `window.scrollTo()` ni referencias a `document.scrollingElement`.
- **Controles e interacciones:** `wheel`, `touchstart` y `scroll` se escuchan directamente sobre el viewport musical aislado; **Inicio (`reset()`)** restablece exclusivamente `container.scrollTop = 0`; **Detener (`stop()`)** cancela el frame preservando la posición de lectura dentro del viewport.

---

## 3. Archivos Modificados en el Alcance

1. [`frontend/src/components/workspace/MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L850-L862) — Atributo `data-scrollable="true"` sobre `<main ref={viewportRef} className="workspace-viewport-area">`.
2. [`frontend/src/components/workspace/AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx) — Barra de controles fuera del contenedor desplazable con estados accesibles.
3. [`frontend/src/core/autoscroll/use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts) — Resolución aislada sobre el viewport musical dedicado, acumulador subpíxel basado en delta de tiempo, limpieza idempotente y listeners exclusivos sobre el contenedor.
4. [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css) — Altura responsiva acotada y `overflow-y: auto` en `.workspace-viewport-area` para desktop, modo Atril, tablet y móvil con `safe-area-inset`.
5. [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts) — Pruebas #9 y #10 validando aislamiento estricto del viewport musical y ausencia de `window.scrollTo` / `document.scrollingElement`.

---

## 4. Validación Estática y Unitaria (Resultados Observados)

- `npm --prefix frontend run typecheck`: **PASS** (`0` errores).
- `npx tsx --test "src/core/autoscroll/__tests__/autoscroll.test.ts" "src/core/workspace/__tests__/reading-format-selector.test.ts" "src/core/workspace/__tests__/musical-completeness-remediation.test.ts"`: **24/24 PASS** (`3/3` suites, `0` fallos, `0` omitidos).

---

## 5. Checklist de Aceptación Manual en Navegador (**PENDING MANUAL VALIDATION**)

1. Iniciar Autoscroll y confirmar que **solo** el área de lectura musical (`.workspace-viewport-area`) se desplaza verticalmente.
2. Confirmar que cabecera (`SongHeader`), navegación, controles de instrumento (`MusicalControls`) y barra de Autoscroll permanecen estacionarios.
3. Realizar scroll manual dentro del viewport musical y confirmar pausa temporal con reanudación desde la nueva posición.
4. Verificar **Pausar**, **Reanudar**, **Detener** (mantiene posición) e **Inicio** (reinicia solo el viewport musical a `0%`).
5. Probar las 6 velocidades (`0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x`) y confirmar llegada a `100%` al final del contenido musical.
6. Repetir en los 4 formatos (`PARTITURE`, `CHORDS_WITH_LYRICS`, `LYRICS_ONLY`, `TABLATURE`) y en desktop, tablet y móvil.

---

## 6. Limitaciones Conocidas

- En pantallas muy pequeñas en orientación horizontal, la altura útil dentro de `.workspace-viewport-area` se ajusta al mínimo de `300px` para mantener visibles la barra de controles y el área de lectura.
- La validación visual interactiva en navegador queda pendiente de ejecución manual por el Project Owner.
