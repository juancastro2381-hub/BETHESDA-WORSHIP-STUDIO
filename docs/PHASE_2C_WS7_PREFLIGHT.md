# BETHESDA WORSHIP STUDIO
## Reporte Técnico de Pre-Vuelo Arquitectónico — Workstream 7 (WS7)
### Componentes Visuales de Setlist e Integración Litúrgica en Atril

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Workstream:** WS7 — Visual Setlist Components & Liturgical Atril Integration  
**Documento:** Reporte Autoritativo de Pre-Vuelo y Análisis de Impacto Arquitectónico  
**Ubicación Autorizada:** `PHASE_2C_WS7_PREFLIGHT.md` y `docs/PHASE_2C_WS7_PREFLIGHT.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Verificada (Cierre WS6):** **405 / 405 PASS** (Backend: 192, Frontend: 213), 0 errores TypeScript  
**Estado del Workstream:** **WS7 — PRE-FLIGHT COMPLETED (IMPLEMENTATION PENDING AUTHORIZATION)**  
**Compuerta de Pre-Vuelo:** **WS7 PREFLIGHT — PASSED**  

---

## 1. Executive Summary

El presente informe constituye el estudio técnico exhaustivo y pre-vuelo arquitectónico obligatorio para el **Workstream 7 (WS7)** de la Fase 2C en Bethesda Worship Studio.

Habiéndose cerrado formalmente el Workstream 6 (cliente API, DTOs, tipado fuerte, manejo de errores `ApiError`, orquestador de ejecución y hook reactivo `useSetlistExecution`), WS7 tiene como objetivo diseñar e integrar la **experiencia visual e interactiva del atril litúrgico** para los músicos y directores de alabanza de la congregación.

### Principios Rectores del Pre-Vuelo WS7:
1. **Preservación Arquitectónica Intacta:** No reescribir ni desestabilizar `MusicalWorkspace.tsx`, el motor de proyección ni los renderizadores de partitura (`alphaTab`, `OSMD`, `LeadSheetDOM`).
2. **Consumo Estricto de WS6:** Reutilizar íntegramente `useSetlistExecution`, `setlist-execution-orchestrator.ts`, `transposition-helper.ts` y `BethesdaApiClient` sin duplicar lógica de transporte, transposición o estado.
3. **Frontera Litúrgica SONG vs SERVICE_MOMENT:** Discriminar visualmente las canciones (con partitura interactiva y transposición) de los momentos de servicio (oración, bienvenida, ofrenda, prédica), evitando renderizar partituras en momentos no musicales.
4. **UX Mobile-First y Atril de Escenario:** Controles táctiles de navegación con área efectiva mínima de $48\text{px}$, alto contraste en fondos oscuros (`#090d16`), legibilidad óptima bajo condiciones de iluminación tenue y soporte de teclado para pase de ítems.
5. **Cero Dependencias y Cero Tiempo Real:** WS7 no agregará dependencias a `package.json` y respetará la frontera estricta de la Fase 2C (memoria volátil local en React, sin WebSockets ni polling).
6. **Decisiones Requeridas Identificadas:** Se clasifican formalmente 3 decisiones de integración para autorización explícita del usuario antes de iniciar la implementación.

---

## 2. Pre-Flight Baseline & Status

Se confirma el estado de congelación y solidez matemática de la línea base heredada del cierre de WS6:

| Parámetro de Verificación | Estado Autorizado | Observaciones / Registro |
|:---|:---:|:---|
| **Pruebas de Backend Fastify** | 192 / 192 PASS | 10 endpoints de setlists, RBAC de 5 roles, concurrencia (Rule A) |
| **Pruebas de Frontend React** | 213 / 213 PASS | 184 heredadas + 29 de WS6 (17 API client + 12 execution hook) |
| **Consolidado Global de Pruebas** | **405 / 405 PASS** | 100% de la suite pasando en verde |
| **Compilación TypeScript Backend** | 0 errores | `tsc --noEmit` exit code 0 |
| **Compilación TypeScript Frontend** | 0 errores | `tsc --noEmit` exit code 0 |
| **Dependencias Añadidas en WS6** | 0 | `package.json` congelado en frontend y backend |
| **Código Productivo Modificado en Preflight** | 0 | Cero líneas de código alteradas |
| **Pruebas Modificadas en Preflight** | 0 | Cero pruebas alteradas |
| **Estado de Implementación de WS7** | **ESTRICTAMENTE NO INICIADO** | Componentes visuales no creados en el árbol de código |

---

## 3. Files Inspected & Repository Source of Truth

La inspección física en el monorepositorio arrojó la siguiente ubicación y estructura de archivos canónicos:

### A. Capa de Transporte, Tipos y Manejo de Errores (WS6)
- `frontend/src/core/api/api-client.ts`: Instancia de `BethesdaApiClient` con los 10 métodos canónicos de setlists (`listSetlists`, `getSetlist`, `createSetlist`, `updateSetlist`, `deleteSetlist`, `updateSetlistStatus`, `addSetlistItem`, `updateSetlistItem`, `deleteSetlistItem`, `reorderSetlistItems`).
- `frontend/src/core/api/setlist-types.ts`: DTOs tipados, unión discriminada (`FrontendSetlistItemSong` vs `FrontendSetlistItemServiceMoment`), enums litúrgicos.
- `frontend/src/core/api/api-error.ts`: Jerarquía tipada de errores (`VALIDATION_ERROR`, `CONFLICT`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_ERROR`).

### B. Capa de Orquestación y Estado Litúrgico (WS6)
- `frontend/src/core/workspace/use-setlist-execution.ts`: Hook de atril que encapsula estado volátil, navegación con protección de fronteras, ciclo de vida (`PLANNING`, `ACTIVE`, `COMPLETED`), estrategia A de metadatos y off-setlist.
- `frontend/src/core/workspace/setlist-execution-orchestrator.ts`: Funciones de transición pura e inmutable desacopladas de React.
- `frontend/src/core/workspace/transposition-helper.ts`: Helper armónico que usa `MusicalKey` y `PitchClass` en $[-6, +6]$ semitonos.

### C. Espacio de Trabajo Musical Preexistente (Fase 1G & 2A/2B)
- `frontend/src/components/workspace/MusicalWorkspace.tsx`: Componente de orquestación de producción. Actualmente es autónomo (`React.FC` sin props) y aloja `useMusicalWorkspace()`.
- `frontend/src/core/workspace/use-musical-workspace.ts`: Hook que administra `activeSong` (`CanonicalMusicPayload`), preferencias de visualización, transposición, capo, instrumento y renderizador activo.
- `frontend/src/core/workspace/workspace-orchestrator.ts`: Transiciones puras de vista musical.
- `frontend/src/components/workspace/DatabaseSongsModal.tsx`: Modal existente para explorar canciones persistidas en PostgreSQL (`client.getSong(songId)` y `client.toCanonicalPayload()`).
- `frontend/src/components/auth/LoginModal.tsx` y `UserProfileBadge.tsx`: Subsistema de autenticación en memoria y presentación de roles RBAC.

### D. Tokens de Diseño y Estilos
- `frontend/src/index.css`: Sistema de diseño basado en variables CSS (`--bg-dark: #090d16`, `--bg-card: rgba(18, 24, 38, 0.85)`, `--gold-primary: #f59e0b`, `--cyan-accent: #06b6d4`, tipografía `Inter`, `Cinzel`, `JetBrains Mono`).

---

## 4. WS7 Scope & Objectives

WS7 tiene por responsabilidad diseñar e implementar la **capa visual e interactiva** que permite a los músicos de Bethesda ejecutar setlists de alabanza de forma fluida y sin fricción.

### Componentes Principales a Desarrollar:
1. `SetlistsModal`: Catálogo y administración visual de setlists según el rol del usuario.
2. `SetlistNavigationToolbar`: Barra persistente de control de atril con navegación secuencial, indicador de posición, detalles litúrgicos, botón "Volver al Culto" y accesibilidad táctil.
3. `ServiceMomentCard`: Tarjeta de visualización litúrgica para momentos que no contienen partitura musical (oraciones, bienvenidas, ofrendas, transiciones).

---

## 5. Critical Architectural Boundary: Integration Strategy

El principio arquitectónico fundamental es:
$$\mathbf{WS7\ Visual\ Components} \longrightarrow \mathbf{useSetlistExecution} \longrightarrow \mathbf{MusicalWorkspace\ Integration} \longrightarrow \mathbf{Existing\ Renderers}$$

### Prohibiciones Arquitectónicas Estrictas:
1. **NO duplicar máquinas de estado:** No crear un segundo orquestador de navegación; toda acción debe invocar `goToNext()`, `goToPrevious()`, `goToIndex()`, `loadSetlist()`, `unloadSetlist()`, `notifyOffSetlistSongSelected()` o `returnToCurrentSetlistItem()`.
2. **NO duplicar el cálculo de transposición:** Utilizar el valor `transpositionSemitones` provisto por `useSetlistExecution`, que a su vez consume `calculateTranspositionSemitones()`.
3. **NO mutar el modelo canónico:** `CanonicalMusicPayload` es inmutable. Cualquier alteración de tono en el atril es una proyección en tiempo de ejecución acotada a $[-6, +6]$.
4. **NO desestabilizar los Escenarios Dorados:** La suite de regresión preexistente de Fases 1 y 2B debe continuar pasando al 100%.

---

## 6. Detailed Component Specifications

### 6.1 SetlistsModal (`frontend/src/components/workspace/SetlistsModal.tsx`)

| Dimensión | Especificación Técnica WS7 |
|:---|:---|
| **Montaje** | Montado condicionalmente en `MusicalWorkspace` o `App.tsx` controlado por el estado booleano `showSetlistsModal`. |
| **Disparador de Apertura** | Botón dedicado en la barra de catálogo: `📋 Repertorios de Culto (Setlists)`. |
| **Carga de Datos** | Invoca `BethesdaApiClient.getInstance().listSetlists({ limit: 50 })` al abrir el modal. |
| **Filtrado por Pestañas** | Pestañas visuales: `Todos`, `Activo / En Curso`, `En Planificación`, `Historial (Completados / Archivados)`. |
| **Representación del Estado** | Badges de estado con paleta canónica: <br>• `ACTIVE`: Verde esmeralda (`#10b981`) con resplandor pulsante (`glow`). <br>• `PLANNING`: Ámbar/Oro (`#f59e0b`). <br>• `COMPLETED`: Azul cian (`#06b6d4`). <br>• `ARCHIVED`: Gris pizarra (`#64748b`). |
| **Selección y Carga** | Botón `Cargar en Atril` en cada ítem: invoca `loadSetlist(setlist.id)` de `useSetlistExecution` y cierra el modal. |
| **Acciones por Rol (RBAC UX)** | • `SUPER_ADMIN` / `ADMIN` / `WORSHIP_LEADER`: Botón `+ Crear Setlist`, botón `Activar para Culto` en setlists `PLANNING`, botón `Finalizar Culto` en setlist `ACTIVE`, botón de eliminación.<br>• `MUSICIAN` / `VIEWER`: Solo lectura y acción `Cargar en Atril`. |
| **Accesibilidad** | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="setlists-modal-title"`, tecla `Escape` para cerrar, trampa de foco y foco restaurado al botón disparador. |

---

### 6.2 SetlistNavigationToolbar (`frontend/src/components/workspace/SetlistNavigationToolbar.tsx`)

| Dimensión | Especificación Técnica WS7 |
|:---|:---|
| **Ubicación en el Layout** | Barra sticky persistente superior (o inferior de atril) visible siempre que `loadedSetlist !== null`. |
| **Controles de Navegación** | • Botón `◀ Anterior` (`goToPrevious`): deshabilitado si `hasPrevious === false`. <br>• Botón `Siguiente ▶` (`goToNext`): deshabilitado si `hasNext === false`. |
| **Área Táctil (Touch Targets)** | Botones principales con dimensiones mínimas de $48\text{px} \times 48\text{px}$ para facilitar el toque rápido en escenario. |
| **Indicador de Posición** | Texto destacado: `Ítem X de Y` (ej. `Ítem 2 de 5`) acompañado de una barra de progreso sutil. |
| **Identificación Litúrgica** | • Título del Setlist cargado con su badge de estado (`[ACTIVO]`). <br>• Título del ítem actual (`currentItem`). <br>• Badge discriminador: `🎵 CANCIÓN` o `🕊️ MOMENTO LITÚRGICO`. |
| **Detalles Musicales y Litúrgicos** | • Para Canción: Tono objetivo (ej. `Tono: Sol Mayor (G)`), $\Delta$ Transposición (ej. `+2 st`), BPM objetivo (ej. `♩ = 128`). <br>• Para Momento: Duración estimada (ej. `⏱️ 10 min`), Tono base de acompañamiento (Pad). |
| **Modo Fuera de Setlist (Off-Setlist)** | Si `isOffSetlistSongActive === true`: <br>• La barra muestra alerta ámbar: `👀 Viendo fuera de setlist: "${offSetlistSongTitle}"`. <br>• Botón destacado: `↩ Volver al Culto (Ítem X de Y)` que invoca `returnToCurrentSetlistItem()`. |
| **Navegación por Teclado** | Listener de eventos de teclado en atril: <br>• `ArrowRight` / `PageDown` / `Space`: Siguiente ítem. <br>• `ArrowLeft` / `PageUp`: Ítem anterior. <br>• `Escape`: Si está en modo off-setlist, vuelve al culto. |

---

### 6.3 ServiceMomentCard (`frontend/src/components/workspace/ServiceMomentCard.tsx`)

| Dimensión | Especificación Técnica WS7 |
|:---|:---|
| **Propósito** | Tarjeta visual solemne para momentos del servicio litúrgico que no corresponden a canciones. |
| **Prohibición de Renderizado** | **NO inicializa ni monta** `MusicalScoreRenderer`, `alphaTab`, `OSMD`, ni `LeadSheetDOM`. |
| **Contenido Visual** | • Encabezado: Icono litúrgico (`🕊️`), Badge `Momento de Culto`, Título del momento (`momentTitle`). <br>• Metadatos: Duración estimada (`durationMinutes`), Tono sugerido para fondo musical/Pad (`musicalKey`). <br>• Indicaciones Pastorales / Notas: Bloque de texto formateado para notas litúrgicas (`notes`). <br>• Notas de Transición: Bloque destacado para modulación o cambio de atmósfera (`transitionNotes`). |
| **Estética y Ambiente** | Tarjeta centrada en el viewport con borde activo sutil (`rgba(245, 158, 11, 0.3)`), fondo translúcido (`--bg-card`) y tipografía display (`Cinzel`) para el título. |

---

## 7. Song Execution & Workspace Connection

Respuestas exhaustivas a las 8 preguntas contractuales de ejecución de canciones:

1. **¿Cómo se carga la canción canónica?**  
   Cuando `currentItem.itemType === 'SONG'`, el componente recupera el `songId`. Si la canción no está en la memoria del atril, se solicita a la API mediante `BethesdaApiClient.getInstance().getSong(songId)`. La respuesta se deserializa mediante `BethesdaApiClient.toCanonicalPayload(response)` obteniendo un `CanonicalMusicPayload` íntegro.
2. **¿Cómo se aplica el `targetKey` del setlist?**  
   El setlist item define `targetKey` (ej. `"G"`). El metadato de la canción define `defaultKey` (ej. `"E"`).
3. **¿Cómo se transfiere el delta de transposición a la capa de proyección?**  
   `useSetlistExecution` expone `transpositionSemitones`, calculado mediante `calculateTranspositionSemitones(defaultKey, targetKey)`. Este valor numérico se inyecta directamente al orquestador de workspace llamando a `setTransposition(transpositionSemitones)`.
4. **¿Cómo se representa el BPM objetivo?**  
   Si `currentItem.targetBpm` está presente, se proyecta visualmente en `SongHeader` y en `SetlistNavigationToolbar` (ej. `♩ = 130 BPM (Litúrgico) [Original: 120]`), sin mutar el `tempoMap` canónico.
5. **¿Cómo se representan las notas de transición?**  
   Si `currentItem.transitionNotes` está poblado, se muestra un banner litúrgico contextual sobre la partitura: `Indicación de Enlace: "Modular a A en el coro final"`.
6. **¿Cómo actualiza el espacio de trabajo la navegación entre canciones?**  
   Al ejecutar `goToNext()` o `goToPrevious()`, el cambio en `currentIndex` dispara un efecto reactivo que carga la nueva canción canónica, ajusta la transposición y actualiza los controles sin recargar la página.
7. **¿Cómo se preserva el estado del espacio de trabajo cuando corresponde?**  
   Las preferencias de visualización del músico (instrumento seleccionado, capo manual complementario, sistema de cifrado estándar vs latino) se mantienen estables en `IWorkspaceState` a través de la navegación entre canciones del setlist.
8. **¿Cómo se distingue una canción fuera del setlist de la del setlist activo?**  
   Mediante la bandera `isOffSetlistSongActive`. Si es `true`, `SongHeader` exhibe una insignia distintiva `[FUERA DE SETLIST]` y `SetlistNavigationToolbar` activa el botón de retorno rápido `Volver al Culto`.

---

## 8. Transposition UI Architecture

- **Cálculo Centralizado Exclusivo:** Todo valor numérico proviene estrictamente de `transposition-helper.ts` (WS6).
- **Proyección sin Mutaciones:** El modelo canónico permanece inmutable en memoria; el delta $\Delta \in [-6, +6]$ solo ajusta la proyección de notas y acordes en pantalla.
- **Representación Visual en UI:**
  - Tono Original (Canónico): `Tono Base: E Mayor`
  - Tono Objetivo Litúrgico: `Tono de Culto: G Mayor`
  - Desplazamiento Armónico: `Transposición: +3 semitonos`

---

## 9. Off-Setlist Execution UX Architecture

El contrato de WS6 para canciones fuera de setlist se preserva íntegramente:

```
Musician en Atril (Setlist Activo en Ítem 2)
              │
              ▼ Abre Catálogo General o Importador
              │
    Carga Canción Independiente
              │
              ▼
  isOffSetlistSongActive = true
  (loadedSetlist e index 2 PERMANECEN INTACTOS EN MEMORIA)
              │
              ▼ Aparece Banner y Botón "Volver al Culto"
              │
    Clic en "Volver al Culto"
              │
              ▼
  returnToCurrentSetlistItem()
              │
              ▼
  Restaura de inmediato la Canción del Ítem 2 con su Tono y Transposición
```

---

## 10. Service Moment Behavior

Cuando `currentItem.itemType === 'SERVICE_MOMENT'`:
- El área principal del atril oculta `MusicalScoreRenderer`, `MusicalControls`, `InstrumentSelector` y `CapoControl`.
- Se monta en su lugar `ServiceMomentCard`.
- Los controles de navegación (`SetlistNavigationToolbar`) se mantienen completamente operativos y accesibles en la parte superior/inferior, permitiendo avanzar al siguiente ítem del culto con un solo clic o pulsación de tecla (`Space` / `ArrowRight`).

---

## 11. Setlist Lifecycle & RBAC UX Matrix

| Acción en UI de WS7 | SUPER_ADMIN | ADMIN | WORSHIP_LEADER | MUSICIAN | VIEWER |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Ver catálogo de setlists** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Cargar setlist en atril** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Navegar ítems en atril** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Ver transposición litúrgica** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Crear nuevo setlist** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ❌ No |
| **Editar metadatos de setlist** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ❌ No |
| **Activar setlist (`PLANNING` $\rightarrow$ `ACTIVE`)** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ❌ No |
| **Completar setlist (`ACTIVE` $\rightarrow$ `COMPLETED`)** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ❌ No |
| **Archivar setlist** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ❌ No |
| **Eliminar setlist** | ✅ Sí | ✅ Sí | ✅ Si creador | ❌ No | ❌ No |

*Nota:* Los controles restringidos se ocultan o deshabilitan visualmente en la interfaz según `user.role`, pero la autorización definitiva reside de forma inexpugnable en el backend Fastify (WS5).

---

## 12. Mobile-First & Responsive UX Architecture

| Dispositivo | Breakpoint | Comportamiento del Atril Litúrgico |
|:---|:---:|:---|
| **Mobile (Smartphones)** | $< 640\text{px}$ | Toolbar sticky fija inferior con botones de navegación gigantes ($\ge 48\text{px}$), título colapsable en una línea con elipsis, modal en pantalla completa (`width: 100%`, `height: 100%`). |
| **Tablet (iPads / Atriles)** | $640\text{px} - 1024\text{px}$ | Formato horizontal o vertical optimizado; toolbar en cabecera o pie con acceso directo a la lista de ítems mediante dropdown accesible; controles de transposición compactos. |
| **Desktop / Laptop** | $> 1024\text{px}$ | Vista de atril expandida; accesos directos por teclado (`ArrowRight`, `ArrowLeft`, `Space`); modal centrado con ancho acotado ($720\text{px}$). |

---

## 13. Accessibility Requirements (WCAG 2.1 AA)

1. **Semántica HTML5:** Botones nativos `<button type="button">`, cero `<div onClick>`.
2. **Nombres Accesibles:** `aria-label` descriptivos (ej. `aria-label="Ir al ítem siguiente del repertorio: Alabanza al Rey"`).
3. **Gestión de Foco:** Atrapamiento de foco (`focus trap`) en `SetlistsModal` y restauración de foco al cerrar.
4. **Estados Dinámicos:** `role="status"` o `aria-live="polite"` para notificar cambios de canción o activación del modo off-setlist a lectores de pantalla.
5. **Contraste de Color:** Mínimo ratio 4.5:1 para texto normal y 3:1 para controles sobre fondo `#090d16`.

---

## 14. Visual Design & Design Token Alignment

### A. Reutilización de Tokens Existentes (`index.css`):
- Colores base: `--bg-dark`, `--bg-card`, `--border-subtle`, `--border-active`, `--gold-primary`, `--cyan-accent`.
- Tipografías: `--font-sans` (`Inter`), `--font-display` (`Cinzel`), `--font-mono` (`JetBrains Mono`).
- Botones: `.action-button.primary`, `.action-button.secondary`, `.btn-toggle-db-modal`.

### B. Brechas de Estilos Identificadas (Gaps to Document):
- Falta una clase formal `.setlist-navigation-toolbar` con sticky positioning y padding móvil.
- Falta la clase `.service-moment-card` para el diseño litúrgico no musical.
- Falta la clase `.setlist-status-badge` con variantes para `ACTIVE`, `PLANNING`, `COMPLETED` y `ARCHIVED`.
- La regla `.source-uploader-overlay` en `DatabaseSongsModal.tsx` requiere estandarización con `.modal-backdrop` en `index.css`.

---

## 15. End-to-End Data Flow & State Ownership Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           useSetlistExecution                           │
│                      (Fuente Autoritativa de Atril)                     │
│  - loadedSetlist        - currentIndex           - currentItem          │
│  - isSong / isService   - transpositionSemitones - isOffSetlist         │
└────────────────┬───────────────────────────────────────┬────────────────┘
                 │                                       │
        [Usuario Selecciona]                    [Atril Navega / Proyecta]
                 │                                       │
                 ▼                                       ▼
        ┌─────────────────┐                     ┌────────────────────────┐
        │  SetlistsModal  │                     │ SetlistNavigationToolbar│
        │ - listSetlists  │                     │ - Prev / Next (48px)   │
        │ - loadSetlist   │                     │ - Título & Posición    │
        │ - RBAC Actions  │                     │ - Volver al Culto      │
        └─────────────────┘                     └────────────────────────┘
                                                         │
                                  ┌──────────────────────┴─────────────────────┐
                                  │                                            │
                           [Si es SONG]                               [Si es SERVICE_MOMENT]
                                  │                                            │
                                  ▼                                            ▼
                     ┌─────────────────────────┐                   ┌───────────────────────┐
                     │    MusicalWorkspace     │                   │   ServiceMomentCard   │
                     │ - CanonicalMusicPayload │                   │ - Título & Duración   │
                     │ - setTransposition(Δ)   │                   │ - Tono Pad & Notas    │
                     │ - MusicalScoreRenderer  │                   │ - Cero partitura      │
                     └─────────────────────────┘                   └───────────────────────┘
```

---

## 16. Error Handling Architecture

Todos los errores provenientes del transporte REST o la base de datos se canalizan a través de `ApiError` (WS6):
- **400 (`VALIDATION_ERROR`):** Alerta en modal indicando los campos inválidos en lenguaje natural.
- **401 (`UNAUTHORIZED`):** Redirección o apertura suave del `LoginModal` para reautenticación en memoria.
- **403 (`FORBIDDEN`):** Mensaje claro: *"No cuenta con privilegios litúrgicos para realizar esta acción."*
- **404 (`NOT_FOUND`):** Mensaje informativo: *"El repertorio solicitado no existe o fue eliminado."*
- **409 (`CONFLICT` - Rule A):** Mensaje litúrgico amigable: *"Ya existe otro repertorio actualmente ACTIVO en la congregación. Finalice o desactive el repertorio en curso antes de activar este."*
- **500 (`INTERNAL_ERROR`):** Mensaje de resiliencia sin fugar detalles de servidor: *"Ocurrió un inconveniente en el servidor. Por favor intente nuevamente."*

---

## 17. Loading, Empty & Transition States

1. **Carga en Modal:** Indicador de carga accesible (`Cargando repertorios litúrgicos...`).
2. **Modal Vacío:** Mensaje guiado: *"No hay repertorios programados aún. Los directores de alabanza pueden crear uno con el botón superior."*
3. **Carga de Canción en Atril:** Transición suave con indicador no invasivo mientras se deserializa el `CanonicalMusicPayload`.
4. **Setlist sin Ítems:** Estado vacío en toolbar: *"Este repertorio no contiene canciones ni momentos litúrgicos aún."*

---

## 18. Real-Time Boundary & Isolation Verification

- **Frontera Congelada de Fase 2C:**
  - Cero WebSockets.
  - Cero Server-Sent Events (SSE).
  - Cero bucles de sondeo (polling).
  - Cero sincronización multi-atril en vivo (agendada formalmente para Fase 4).
- Todo cambio visual es estrictamente reactivo a eventos de usuario locales o invocaciones directas a endpoints HTTP de WS5.

---

## 19. Performance & Lifecycle Considerations

- **Memoización:** Empleo estricto de `useMemo` y `useCallback` para evitar re-renderizados del `MusicalScoreRenderer` cuando solo cambia el título o la posición en la barra de navegación.
- **Cache Local de Canciones Canónicas:** Mantener un mapa volátil `Map<songId, CanonicalMusicPayload>` para que retroceder a una canción previamente ejecutada sea instantáneo y no requiera peticiones HTTP adicionales.
- **Transiciones Limpias:** Desmontar los adaptadores de renderizado de forma ordenada al pasar a un `SERVICE_MOMENT` para evitar fugas de memoria en `alphaTab` o `OSMD`.

---

## 20. Testing Strategy & Test Plan

Se propone una cobertura exhaustiva dividida en 4 suites automatizadas con Node.js Test Runner:

### Suite 1: `SetlistsModal` Unit & Component Tests (8 casos de prueba)
1. Renderizado de lista de setlists obtenidos del cliente API.
2. Filtrado determinista por pestañas de estado (`ACTIVE`, `PLANNING`, `COMPLETED`).
3. Renderizado de estado de carga y estado vacío.
4. Mapeo y visualización estructurada de `ApiError` (403, 409, 500).
5. Invocación de `loadSetlist` al presionar `Cargar en Atril`.
6. Visibilidad de controles RBAC para `WORSHIP_LEADER` / `ADMIN` (Crear, Activar, Finalizar).
7. Restricción de controles de mutación para `MUSICIAN` y `VIEWER`.
8. Accesibilidad ARIA, trampa de foco y cierre con tecla `Escape`.

### Suite 2: `SetlistNavigationToolbar` Component Tests (8 casos de prueba)
1. Renderizado del título del setlist, índice actual y total de ítems.
2. Habilitación/deshabilitación de botones `Anterior` y `Siguiente` en fronteras $[0, \text{total} - 1]$.
3. Invocación correcta de `goToNext()` y `goToPrevious()`.
4. Discriminación del badge visual `CANCIÓN` vs `MOMENTO LITÚRGICO`.
5. Visualización del tono litúrgico, $\Delta$ semitonos y BPM objetivo para canciones.
6. Visualización de alerta y botón `Volver al Culto` cuando `isOffSetlistSongActive === true`.
7. Invocación de `returnToCurrentSetlistItem()` al presionar `Volver al Culto`.
8. Manejo de atajos de teclado (`ArrowRight`, `ArrowLeft`, `Space`, `Escape`).

### Suite 3: `ServiceMomentCard` Component Tests (5 casos de prueba)
1. Renderizado fiel de `momentTitle`, `durationMinutes` y `musicalKey` (Pad).
2. Renderizado de `notes` y `transitionNotes`.
3. Verificación de exclusión: Cero inicialización de adaptadores de partitura musical.
4. Comportamiento accesible y jerarquía de encabezados semántica.
5. Tolerancia a campos nulos u opcionales sin fallos de renderizado.

### Suite 4: Integración Atril Completo (`MusicalWorkspace` + WS7) (6 casos de prueba)
1. Carga de setlist $\rightarrow$ Primera canción proyectada con transposición litúrgica correcta.
2. Navegación de `SONG` a `SERVICE_MOMENT` $\rightarrow$ Reemplazo del viewport por `ServiceMomentCard`.
3. Navegación de `SERVICE_MOMENT` a `SONG` $\rightarrow$ Montaje del viewport de partitura en tono objetivo.
4. Apertura de canción del catálogo general $\rightarrow$ Activación de modo off-setlist con preservación de índice.
5. Clic en `Volver al Culto` $\rightarrow$ Restauración inmediata de la posición y canción del setlist.
6. Inmutabilidad canónica garantizada a lo largo de toda la secuencia de navegación.

$$\mathbf{TOTAL\ NUEVOS\ CASOS\ DE\ PRUEBA\ PLANIFICADOS:\ 27\ CASOS}$$

---

## 21. Answers to the 22 Required Contract Questions

1. **¿Dónde debe montarse `SetlistsModal`?**  
   En `MusicalWorkspace.tsx`, como modal controlado montado junto a `DatabaseSongsModal` y `SourceFileUploader`.
2. **¿Qué componente es dueño del estado abierto/cerrado del modal?**  
   `MusicalWorkspace` a través de un estado booleano `const [showSetlistsModal, setShowSetlistsModal] = useState(false)`.
3. **¿Cómo inicializa la selección de un setlist a `useSetlistExecution`?**  
   El modal recibe el callback `onLoadSetlist: (id: string) => Promise<void>`, el cual ejecuta `loadSetlist(id)` de `useSetlistExecution`.
4. **¿Cómo interactúa el setlist activo con `MusicalWorkspace`?**  
   `MusicalWorkspace` consume `useSetlistExecution()`. Cuando el ítem activo es una canción, carga el `CanonicalMusicPayload` asociado y ajusta la transposición con `setTransposition(transpositionSemitones)`.
5. **¿Requiere modificación `MusicalWorkspace`?**  
   **Sí, una modificación mínima de integración.** Dado que actualmente `MusicalWorkspace.tsx` es autónomo y no recibe props, debe incorporar internamente el hook `useSetlistExecution()`, renderizar `SetlistNavigationToolbar`, alojar el botón disparador de `SetlistsModal` y alternar entre `MusicalScoreRenderer` y `ServiceMomentCard`.
6. **Si requiere modificación, ¿cuál es el cambio de interfaz mínimo?**  
   No altera sus props externas (sigue siendo `React.FC` para `App.tsx`), sino que amplía su composición interna agregando los 3 componentes visuales de WS7.
7. **¿Cómo se proyecta una `SONG` en el espacio de trabajo?**  
   A través de `selectPersistedSong(canonical, meta)` y `setTransposition(transpositionSemitones)`.
8. **¿Cómo se proyecta un `SERVICE_MOMENT` en la interfaz?**  
   Reemplazando temporalmente la sección de partitura por `<ServiceMomentCard item={currentItem} />`.
9. **¿Dónde vive `SetlistNavigationToolbar`?**  
   Dentro de `MusicalWorkspace`, posicionada de forma destacada sobre los controles musicales, sticky en la parte superior del área de atril.
10. **¿Cómo funciona visualmente "Volver al Culto"?**  
    Aparece como un botón flotante/destacado con borde dorado y fondo ámbar en la barra de navegación que reza: `↩ Volver al Culto (Ítem X de Y)`.
11. **¿Cómo se representan las acciones basadas en roles?**  
    Se consultan vía `useAuth()`. Los botones administrativos (Crear, Activar, Completar) se renderizan condicionalmente para roles directivos (`WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN`).
12. **¿Qué ocurre cuando no existe ningún setlist `ACTIVE`?**  
    El atril puede cargar y ejecutar cualquier setlist en estado `PLANNING` en modo ensayo/preparación; la barra indica `[PLANIFICACIÓN]` en lugar de `[ACTIVO]`.
13. **¿Qué ocurre cuando un setlist es completado o archivado?**  
    Se visualiza en modo histórico de solo lectura, con badge `[COMPLETADO]` o `[ARCHIVADO]`.
14. **¿Cómo se exponen los errores de API?**  
    A través de banners estructurados de alerta en el modal o en la cabecera, mapeando los códigos canónicos de `ApiError` a lenguaje amigable.
15. **¿Qué requisitos de accesibilidad aplican?**  
    WCAG 2.1 AA: botones semánticos, `aria-label`, contraste mínimo 4.5:1, trampa de foco y navegación completa por teclado.
16. **¿Qué comportamiento responsivo aplica?**  
    Botones con área táctil $\ge 48\text{px}$, layout colapsable en smartphone ($< 640\text{px}$) y atril expandido en tablet y desktop.
17. **¿Qué pruebas deben añadirse?**  
    27 casos de prueba automatizados distribuidos en 4 suites de pruebas (Modal, Toolbar, Card, Integración).
18. **¿Qué archivos se crearán probablemente?**  
    7 archivos (3 componentes visuales + 4 suites de prueba automatizadas).
19. **¿Qué archivos existentes se modificarán probablemente?**  
    3 archivos: `MusicalWorkspace.tsx`, `frontend/src/components/workspace/index.ts` y `frontend/src/index.css`.
20. **¿Qué archivos NO deben modificarse bajo ninguna circunstancia?**  
    Backend íntegro, base de datos, migraciones, modelos canónicos, adaptadores de partituras, servicios de proyección y suites de prueba preexistentes.
21. **¿Se requiere alguna dependencia externa?**  
    **Ninguna (0 dependencias).** Todo se implementará con React 19, TypeScript nativo y CSS vanilla existente.
22. **¿Hay decisiones de negocio o arquitectónicas aún no resueltas?**  
    Sí, 3 decisiones que se catalogan a continuación.

---

## 22. Identification of Unresolved Decisions (DECISION REQUIRED)

Antes de autorizar la codificación de WS7, se presentan 3 decisiones técnicas y de experiencia de usuario que requieren ratificación del usuario:

### Decisión 1: Estrategia de Ubicación de la Barra de Navegación de Atril
- **Pregunta:** ¿Debe `SetlistNavigationToolbar` fijarse como barra fija inferior en pantalla (estilo atril móvil de pie) o como barra superior sticky debajo del header?
- **Opciones:**
  - **Opción A (Recomendada):** Barra sticky superior sobre los controles musicales en desktop/tablet, convirtiéndose en fija inferior flotante en mobile para facilitar el alcance con el pulgar.
  - **Opción B:** Barra fija exclusivamente en la cabecera en todos los tamaños de pantalla.
- **Impacto Arquitectónico:** Ajusta reglas responsivas en `index.css`.
- **Autorización Requerida:** Aprobación de la Opción A o B.

### Decisión 2: Estrategia de Cache y Prefetch de Canciones Canónicas del Setlist
- **Pregunta:** ¿Cómo debe gestionarse la carga de las canciones canónicas que componen el setlist?
- **Opciones:**
  - **Opción A (Recomendada):** Carga bajo demanda con caché en memoria volátil de sesión (`Map<string, CanonicalMusicPayload>`), precargando el ítem $N+1$ en segundo plano.
  - **Opción B:** Carga bajo demanda pura sin precarga anticipada (solicita la canción al presionar Siguiente).
  - **Opción C:** Descarga masiva anticipada de todas las canciones del setlist al presionar `Cargar en Atril`.
- **Impacto Arquitectónico:** La Opción A ofrece latencia cero entre canciones sin sobrecargar la red inicialmente.
- **Autorización Requerida:** Aprobación de la política de prefetch.

### Decisión 3: Modo de Visualización para Usuarios No Autenticados
- **Pregunta:** Si un usuario no ha iniciado sesión (invitado anónimo), ¿qué debe mostrar el atril de setlists?
- **Opciones:**
  - **Opción A (Recomendada):** Mostrar el botón `Repertorios de Culto`, pero al hacer clic desplegar un banner amigable en el modal invitando a iniciar sesión para ver los repertorios de la iglesia.
  - **Opción B:** Ocultar completamente el botón de setlists si `user === null`.
- **Impacto Arquitectónico:** Condiciona la visibilidad en `MusicalWorkspace.tsx` mediante `useAuth()`.
- **Autorización Requerida:** Aprobación de la opción de visibilidad pública/privada.

---

## 23. Scope Protection & Prohibited Actions

Durante WS7 queda formalmente prohibido:
- Implementar sincronización en tiempo real multi-atril (WebSockets, SSE, polling).
- Alterar la lógica o contratos de backend Fastify o de la base de datos PostgreSQL.
- Modificar las clases de teoría musical o el helper `calculateTranspositionSemitones`.
- Crear dependencias adicionales en `package.json`.
- Almacenar el estado del setlist en `localStorage`, `sessionStorage` o `IndexedDB`.

---

## 24. Dependency Assessment

$$\mathbf{NUEVAS\ DEPENDENCIAS\ EXTERNAS:\ CERO\ (0)}$$

La totalidad de los requerimientos de WS7 (modales, toolbars, tarjetas litúrgicas, navegación accesible y temas visuales) se resolverán aprovechando las capacidades nativas de React 19, TypeScript y CSS vanilla con tokens existentes.

---

## 25. Impact Analysis: Files to Create, Modify & Protect

### Archivos a Crear en WS7 (7 archivos previstos):
1. `frontend/src/components/workspace/SetlistsModal.tsx`
2. `frontend/src/components/workspace/SetlistNavigationToolbar.tsx`
3. `frontend/src/components/workspace/ServiceMomentCard.tsx`
4. `frontend/src/components/workspace/__tests__/setlists-modal.test.ts`
5. `frontend/src/components/workspace/__tests__/setlist-navigation-toolbar.test.ts`
6. `frontend/src/components/workspace/__tests__/service-moment-card.test.ts`
7. `frontend/src/components/workspace/__tests__/setlist-atril-integration.test.ts`

### Archivos a Modificar en WS7 (3 archivos previstos):
1. `frontend/src/components/workspace/MusicalWorkspace.tsx`
2. `frontend/src/components/workspace/index.ts`
3. `frontend/src/index.css`

### Archivos Estrictamente Protegidos (CERO modificaciones permitidas):
- Todo el backend (`backend/src/**`).
- Migraciones SQL y esquemas de base de datos.
- Módulos de WS6 (`use-setlist-execution.ts`, `setlist-execution-orchestrator.ts`, `transposition-helper.ts`, `api-client.ts`, `setlist-types.ts`, `api-error.ts`).
- Motores de teoría musical y renderizado (`core/music-theory/**`, `core/rendering/**`).
- Suites de pruebas preexistentes (405 pruebas).

---

## 26. SHA-256 Verification

The final Markdown preflight report is cryptographically verified through the external checksum manifest:

`PHASE_2C_WS7_PREFLIGHT.sha256`

The manifest contains the SHA-256 hash of the final byte representation of this Markdown preflight report.

The synchronized copy under `docs/` is verified byte-identical to the authoritative report.

Do not insert the actual Markdown file's own SHA-256 into the Markdown file.

---

## 27. Pre-Flight Exit Criteria Checklist

| # | Criterio de Aceptación de Pre-Vuelo WS7 | Estado |
|:---:|:---|:---:|
| 1 | Inspección de implementación WS6 completada | **PASSED** |
| 2 | Inspección de arquitectura de `MusicalWorkspace` completada | **PASSED** |
| 3 | Inspección de componentes frontend completada | **PASSED** |
| 4 | Responsabilidades exactas de componentes WS7 definidas | **PASSED** |
| 5 | Flujo de datos integral definido | **PASSED** |
| 6 | Propiedad del estado litúrgico definida | **PASSED** |
| 7 | Integración de `SONG` definida | **PASSED** |
| 8 | Integración de `SERVICE_MOMENT` definida | **PASSED** |
| 9 | UX de comportamiento Off-Setlist definida | **PASSED** |
| 10 | Comportamiento de navegación definido | **PASSED** |
| 11 | UX de ciclo de vida definida | **PASSED** |
| 12 | Fronteras de UX para RBAC definidas | **PASSED** |
| 13 | Comportamiento en mobile definido ($\ge 48\text{px}$) | **PASSED** |
| 14 | Comportamiento en tablet definido | **PASSED** |
| 15 | Comportamiento en desktop definido | **PASSED** |
| 16 | Requisitos de accesibilidad definidos | **PASSED** |
| 17 | Estados de carga definidos | **PASSED** |
| 18 | Estados vacíos definidos | **PASSED** |
| 19 | Estados de error estructurados definidos | **PASSED** |
| 20 | Presentación de transposición definida | **PASSED** |
| 21 | Frontera de tiempo real preservada | **PASSED** |
| 22 | Consideraciones de rendimiento documentadas | **PASSED** |
| 23 | Estrategia y plan de pruebas definido (27 casos) | **PASSED** |
| 24 | Archivos a crear identificados (7 archivos) | **PASSED** |
| 25 | Archivos a modificar identificados (3 archivos) | **PASSED** |
| 26 | Archivos protegidos identificados | **PASSED** |
| 27 | Evaluación de dependencias realizada (0 nuevas) | **PASSED** |
| 28 | Decisiones no resueltas catalogadas (3 decisiones) | **PASSED** |
| 29 | Cero cambios en código de producción | **PASSED** |
| 30 | Cero cambios en pruebas | **PASSED** |
| 31 | Cero cambios en dependencias | **PASSED** |
| 32 | Reporte autoritativo creado | **PASSED** |
| 33 | Copia sincronizada en `docs/` creada | **PASSED** |
| 34 | Reportes byte-identical verificados | **PASSED** |
| 35 | Manifiesto SHA-256 externo creado y verificado | **PASSED** |

---

## 28. Final Pre-Flight Classification

$$\mathbf{WS7\ PREFLIGHT\ —\ PASSED}$$

### Estado de Autorización:
**WS7 implementation remains pending explicit user authorization.**

El sistema se detiene en reposo técnico en la compuerta de pre-vuelo de WS7. No se implementará código de producción ni componentes hasta recibir la autorización formal del usuario y la resolución de las 3 decisiones planteadas.
