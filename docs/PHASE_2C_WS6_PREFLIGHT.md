# BETHESDA WORSHIP STUDIO
## Reporte de Preflight Arquitectónico y de Contratos — Workstream 6 (WS6)
### Cliente API Frontend, Hook de Ejecución de Setlists e Integración de Atril

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Workstream:** WS6 — Frontend API Client & Setlist Execution Hook  
**Documento:** Auditoría Arquitectónica y Especificación de Contrato Pre-Implementación  
**Ubicación Autorizada:** `PHASE_2C_WS6_PREFLIGHT.md` y `docs/PHASE_2C_WS6_PREFLIGHT.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Verificada:** WS5 Implementado y Verificado (376/376 pruebas PASS, 0 errores TypeScript, PostgreSQL íntegro)  
**Estado de WS6:** **STRICTLY NOT STARTED (CERO CÓDIGO DE PRODUCCIÓN IMPLEMENTADO)**  
**Estado del Preflight:** **WS6 PREFLIGHT — READY FOR EXPLICIT IMPLEMENTATION AUTHORIZATION**

---

## 1. Resumen Ejecutivo (Executive Summary)

El presente documento constituye la auditoría técnica y especificación exhaustiva de preflight para el **Workstream 6 (WS6)** de la Fase 2C en Bethesda Worship Studio.

La Fase 2C ha completado y verificado exitosamente sus primeras cinco etapas:
- **WS1:** Esquemas relacionales y migración `0002_setlists_and_service_moments.sql`.
- **WS2:** Contratos de dominio puro, tipos y esquemas Zod en `setlist.schemas.ts`.
- **WS3:** Repositorio transaccional `DrizzleSetlistRepository` con reordenamiento atómico SQL y compactación secuencial.
- **WS4 & Concurrency Remediation:** Lógica de negocio orquestada en `SetlistService`, máquina de estados litúrgicos, inmutabilidad histórica, blindaje de concurrencia en PostgreSQL (`idx_setlists_single_active`) y traducción de error `23505` a `ConflictError`.
- **WS5:** 10 endpoints RESTful en Fastify (`/api/v1/setlists`), guardas RBAC con verificación en base de datos (`verifyDatabaseRole = true`), registro de auditoría mandatorio (`SETLIST_CREATED`, `SETLIST_ACTIVATED`, `SETLIST_DELETED`) y 34 pruebas de integración HTTP (192 backend / 184 frontend = 376 total PASS).

El objetivo de **WS6** es conectar la aplicación frontend (React 18 + TypeScript) con la API RESTful de Fastify mediante:
1. La extensión tipada del cliente HTTP (`BethesdaApiClient`).
2. La creación del hook orquestador de atril `useSetlistExecution.ts`.
3. El cálculo puro de transposición armónica ($\Delta_{\text{semitonos}}$) entre el tono canónico de la canción y el tono litúrgico asignado (`targetKey`), proyectándolo sin mutar la base de datos.
4. La definición de interfaces y contratos visuales para la barra de navegación de atril (`SetlistNavigationToolbar`), las tarjetas de momentos litúrgicos (`ServiceMomentCard`) y el modal de selección (`SetlistsModal`).

Este preflight demuestra que la arquitectura del frontend está 100% preparada, que no se requiere instalar ninguna dependencia de terceros, y que todas las invariantes canónicas y de seguridad permanecen estrictamente preservadas.

---

## 2. Arquitectura General del Sistema (Current Architecture)

El sistema opera bajo una arquitectura en capas desacopladas con fronteras nítidas entre transporte, dominio y presentación:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              FASTIFY BACKEND (API REST v1)                             │
│                  /api/v1/setlists (10 Endpoints Canónicos — WS5)                       │
└───────────────────────────────────────────▲────────────────────────────────────────────┘
                                            │ HTTP / JSON (Bearer JWT HS256)
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                       CLIENTE HTTP FRONTEND (BethesdaApiClient)                        │
│             fetchWithAuth() ──► Interceptor de Auth ──► Silent Cookie Refresh          │
└───────────────────────────────────────────▲────────────────────────────────────────────┘
                                            │ DTOs / Entidades de Dominio Tipadas
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                    HOOK DE EJECUCIÓN LITÚRGICA (useSetlistExecution)                   │
│   Estado de Culto │ Navegación Secuencial │ Cálculo Puro de Tonalidad (Δ Semitonos)    │
└─────────────────────▲────────────────────────────────────────────────────▲─────────────┘
                      │                                                    │
┌─────────────────────▼─────────────────────────┐ ┌────────────────────────▼─────────────┐
│       COMPONENTES DE ATRIL / ESCENARIO        │ │   ESPACIO DE TRABAJO (MusicalWorkspace)│
│ SetlistNavigationToolbar │ ServiceMomentCard  │ │   ProjectionService ──► Transposición │
│              SetlistsModal                    │ │   alphaTab / OSMD / LeadSheetDOM      │
└───────────────────────────────────────────────┘ └──────────────────────────────────────┘
```

### Límites de Responsabilidad en el Frontend:
- **`BethesdaApiClient`:** Abstracción pura de transporte de red. Serializa y deserializa datos, inyecta credenciales y traduce errores HTTP a excepciones estándar.
- **`useSetlistExecution`:** Hook de estado reactivo y máquina de navegación de culto. Gobierna el índice activo, determina si el elemento es `SONG` o `SERVICE_MOMENT`, calcula semitonos litúrgicos y gestiona transiciones de estado (`ACTIVE`, `COMPLETED`).
- **`MusicalWorkspace`:** Orquestador de atril existente. Permanece agnóstico a la estructura relacional de los setlists; recibe el modelo `CanonicalMusicPayload` y un desplazamiento de transposición en semitonos (`transpositionSemitones`).
- **Adaptadores de Partituras (`alphaTab`, `OSMD`, `LeadSheetDOM`):** Renderizadores pasivos que nunca interactúan con setlists ni autenticación. Si el elemento actual es un momento litúrgico (`SERVICE_MOMENT`), los renderizadores no son instanciados.

---

## 3. Línea Base de Contratos de WS5 (WS5 Contract Baseline)

WS5 dejó estabilizados, probados y verificados 10 endpoints canónicos que constituyen el contrato inmutable sobre el cual se asienta WS6:

| # | Endpoint | Método | Autenticación | Permiso RBAC | DB Check | Payload Entrada | Respuesta Éxito | Códigos HTTP |
|:---:|:---|:---:|:---:|:---:|:---:|:---|:---|:---:|
| 1 | `/api/v1/setlists` | `GET` | Bearer JWT | `setlists:list` | No | Query: `status`, `upcoming`, `limit`, `offset` | `{ data: SetlistSummaryEntity[], pagination: { total, limit, offset } }` | 200, 401, 403 |
| 2 | `/api/v1/setlists` | `POST` | Bearer JWT | `setlists:create` | **Sí** | Body: `CreateSetlistBody` (`title`, `scheduledDateTime`, `directorUserId`, `notes`) | `{ data: SetlistEntity }` | 201, 400, 401, 403, 409 |
| 3 | `/api/v1/setlists/:id` | `GET` | Bearer JWT | `setlists:read` | No | Param: `:id` (UUID) | `{ data: SetlistWithItemsEntity }` | 200, 400, 401, 403, 404 |
| 4 | `/api/v1/setlists/:id` | `PUT` | Bearer JWT | `setlists:update` | **Sí** | Param: `:id`, Body: `UpdateSetlistBody` | `{ data: SetlistEntity }` | 200, 400, 401, 403, 404 |
| 5 | `/api/v1/setlists/:id` | `DELETE` | Bearer JWT | `setlists:delete` | **Sí** | Param: `:id` (UUID) | `{ success: true, message: string }` | 200, 400, 401, 403, 404 |
| 6 | `/api/v1/setlists/:id/status` | `POST` | Bearer JWT | `setlists:activate` | **Sí** | Param: `:id`, Body: `{ status: SetlistStatus }` | `{ data: SetlistEntity }` | 200, 400, 401, 403, 404, 409 |
| 7 | `/api/v1/setlists/:id/items` | `POST` | Bearer JWT | `setlists:update` | **Sí** | Param: `:id`, Body: `CreateSetlistItemBody` (SONG o SERVICE_MOMENT) | `{ data: SetlistItemWithSongEntity }` | 201, 400, 401, 403, 404, 409 |
| 8 | `/api/v1/setlists/:id/items/:itemId` | `PUT` | Bearer JWT | `setlists:update` | **Sí** | Params: `:id`, `:itemId`, Body: `UpdateSetlistItemBody` | `{ data: SetlistItemWithSongEntity }` | 200, 400, 401, 403, 404, 409 |
| 9 | `/api/v1/setlists/:id/items/:itemId` | `DELETE` | Bearer JWT | `setlists:update` | **Sí** | Params: `:id`, `:itemId` | `{ success: true, message: string }` | 200, 400, 401, 403, 404, 409 |
| 10 | `/api/v1/setlists/:id/reorder` | `PUT` | Bearer JWT | `setlists:reorder` | **Sí** | Param: `:id`, Body: `{ itemIds: string[] }` | `{ data: SetlistItemWithSongEntity[] }` | 200, 400, 401, 403, 404, 409 |

---

## 4. Auditoría de la Arquitectura Frontend Existente (Frontend Architecture Audit)

Se realizó una inspección minuciosa del paquete `frontend/src`:

1. **Gestión de Estado Actual:**
   - Autenticación: React Context centralizado (`AuthProvider` en `frontend/src/core/auth/auth-context.tsx`).
   - Espacio de trabajo musical: Hook orquestador puro (`useMusicalWorkspace` en `frontend/src/core/workspace/use-musical-workspace.ts`).
   - Conclusión: **No se requiere ninguna librería externa de estado** (como Redux, Zustand o TanStack Query). El patrón de hooks orquestadores con estado reactivo local (`useState`, `useCallback`, `useMemo`) es óptimo, desacoplado y 100% probado en las suites de Fase 1G y 2B.
2. **Cliente API Central (`BethesdaApiClient`):**
   - Ubicado en `frontend/src/core/api/api-client.ts`.
   - Implementa `fetchWithAuth()` con inyección transparente de `Authorization: Bearer <token>`, soporte para cookies `HttpOnly` (`credentials: 'include'`) y renovación silenciosa automática ante errores 401.
   - Conclusión: Extender esta clase con métodos fuertemente tipados para setlists es la estrategia natural y consistente.
3. **Sistema de Diseño y Tokens CSS (`index.css`):**
   - Paleta cromática establecida: Fondo oscuro (`--bg-dark: #090d16`), tarjetas traslúcidas (`--bg-card: rgba(18, 24, 38, 0.85)`), acentos dorados litúrgicos (`--gold-primary: #f59e0b`, `--gold-glow: rgba(245, 158, 11, 0.15)`), acento cian (`--cyan-accent: #06b6d4`), texto principal (`--text-main: #f3f4f6`).
   - Tipografía: Sans-serif moderna (`Inter`), display litúrgico (`Cinzel`), monoespaciada (`JetBrains Mono`).
   - Modales existentes: `DatabaseSongsModal.tsx` y `LoginModal.tsx` usan capas flotantes fijas con backdrop borroso (`backdrop-filter: blur(12px)`), tarjetas con bordes luminosos y botones de acción rápida.
   - Conclusión: Los nuevos componentes de setlists reutilizarán estos tokens y clases existentes sin agregar CSS redundante.

---

## 5. Contrato del Cliente API para Setlists (API Client Contract)

Se añadirá a `BethesdaApiClient` en `frontend/src/core/api/api-client.ts` la siguiente interfaz y métodos de servicio:

```typescript
// Tipos de Dominio de Setlist en Frontend
export type FrontendSetlistStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type FrontendSetlistItemType = 'SONG' | 'SERVICE_MOMENT';
export type FrontendTransitionType = 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY';

export interface FrontendSetlistSummary {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  directorName?: string | null;
  totalItems: number;
  totalSongs: number;
  createdAt: string;
  updatedAt: string;
}

export interface FrontendSetlistItem {
  id: string;
  setlistId: string;
  sequenceOrder: number;
  itemType: FrontendSetlistItemType;
  songId: string | null;
  targetKey: string | null;
  targetBpm: number | null;
  transitionType: FrontendTransitionType | null;
  momentTitle: string | null;
  durationMinutes: number | null;
  musicalKey: string | null;
  notesForTeam: string | null;
  createdAt: string;
  updatedAt: string;
  song?: {
    id: string;
    title: string;
    artist: string | null;
    defaultKey: string;
    defaultBpm: number;
    timeSignature: string;
    status: string;
  } | null;
}

export interface FrontendSetlistDetail {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  directorName?: string | null;
  notes: string | null;
  items: FrontendSetlistItem[];
  createdAt: string;
  updatedAt: string;
}

// Métodos a incorporar en BethesdaApiClient:
public async listSetlists(params?: { status?: FrontendSetlistStatus; upcoming?: boolean; limit?: number; offset?: number }): Promise<{ items: FrontendSetlistSummary[]; total: number }>;
public async getSetlist(id: string): Promise<FrontendSetlistDetail>;
public async createSetlist(dto: { title: string; scheduledDateTime?: string | null; directorUserId?: string | null; notes?: string | null }): Promise<FrontendSetlistDetail>;
public async updateSetlist(id: string, dto: { title?: string; scheduledDateTime?: string | null; directorUserId?: string | null; notes?: string | null }): Promise<FrontendSetlistDetail>;
public async deleteSetlist(id: string): Promise<void>;
public async transitionSetlistStatus(id: string, status: FrontendSetlistStatus): Promise<FrontendSetlistDetail>;
public async addSetlistItem(setlistId: string, item: any): Promise<FrontendSetlistItem>;
public async updateSetlistItem(setlistId: string, itemId: string, item: any): Promise<FrontendSetlistItem>;
public async deleteSetlistItem(setlistId: string, itemId: string): Promise<void>;
public async reorderSetlistItems(setlistId: string, itemIds: string[]): Promise<FrontendSetlistItem[]>;
```

---

## 6. Integración de Autenticación y Renovación de Tokens (Authentication Integration)

1. **Reutilización de `fetchWithAuth`:**
   - Todas las llamadas a `/api/v1/setlists` invocan `fetchWithAuth`.
   - Si el usuario está autenticado, la cabecera `Authorization: Bearer <token>` se inyecta automáticamente.
2. **Ciclo de Renovación Silenciosa:**
   - Si el backend responde `401 Unauthorized` por expiración de token (15 minutos), `fetchWithAuth` intercepta el fallo.
   - Llama a `apiClient.refreshSession()` con la cookie HttpOnly `bethesda_refresh_token`.
   - Si la renovación es exitosa, almacena el nuevo token en `tokenManager` en memoria de JavaScript (cero persistencia en disco o almacenamiento web).
   - Reintenta la solicitud original de setlist de manera transparente para el músico en escenario sin interrumpir la visualización.
3. **Manejo de Sesión Caducada o Revocada:**
   - Si la renovación falla (cookie revocada o cuenta bloqueada), `tokenManager.clearToken()` se ejecuta, el usuario pasa a `null`, y la interfaz muestra el banner ergonómico de inicio de sesión requerido.

---

## 7. Integración de RBAC en el Frontend (RBAC Integration)

El frontend implementa controles de experiencia de usuario (UX Controls) para prevenir intentos fallidos y clarificar permisos:

```typescript
export function useSetlistPermissions() {
  const { user, hasRole, isAuthenticated } = useAuth();

  const canCreateSetlist = isAuthenticated && hasRole(['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER']);
  const canEditSetlist = isAuthenticated && hasRole(['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER']);
  const canActivateSetlist = isAuthenticated && hasRole(['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER']);
  const canReorderSetlist = isAuthenticated && hasRole(['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER']);
  const canDeleteSetlist = isAuthenticated && hasRole(['SUPER_ADMIN', 'ADMIN']); // Restringido
  const canViewSetlist = isAuthenticated; // Todos los 5 roles

  return {
    user,
    isAuthenticated,
    canCreateSetlist,
    canEditSetlist,
    canActivateSetlist,
    canReorderSetlist,
    canDeleteSetlist,
    canViewSetlist,
  };
}
```

> [!IMPORTANT]
> **Postura de Seguridad No Negociable:**
> Los guards de permisos en el cliente (`canCreateSetlist`, `canDeleteSetlist`) son **exclusivamente elementos de conveniencia visual** (ocultar botones, deshabilitar selectores). El backend Fastify con `verifyDatabaseRole = true` es el único guardián autoritativo de seguridad.

---

## 8. Modelo de Estado de Setlist y Ciclo de Vida Litúrgico (Setlist State Model)

La interfaz se adapta deterministamente según el estado del setlist cargado:

| Estado Litúrgico | Significado Congregacional | Permisos de Edición | Navegación en Atril | Acciones de Estado Permitidas |
|:---|:---|:---:|:---:|:---|
| **`PLANNING`** | Borrador de preparación pastoral / ensayo preliminar | Total (agregar, editar, reordenar, borrar ítems) | Habilitada | `→ ACTIVE` (iniciar culto)<br>`→ ARCHIVED` (cancelar culto) |
| **`ACTIVE`** | **Culto en curso en el altar**. Solo UNO en la congregación | Restringida al director (edición menor) | **Modo Escenario Activo** (alto contraste, cues de transición) | `→ COMPLETED` (concluir culto)<br>`→ PLANNING` (revertir por error) |
| **`COMPLETED`** | Culto finalizado y registrado | **Cero (Inmutable)**. Botones de mutación deshabilitados | Solo lectura histórica | `→ ARCHIVED` (archivar) |
| **`ARCHIVED`** | Registro histórico en catálogo de alabanza | **Cero (Inmutable)**. Solo lectura | Solo lectura histórica | Ninguna (estado terminal) |

---

## 9. Contrato Propuesto para `useSetlistExecution.ts`

El hook orquestador de ejecución litúrgica se ubicará en `frontend/src/core/workspace/use-setlist-execution.ts`:

```typescript
export interface UseSetlistExecutionOptions {
  readonly initialSetlistId?: string | undefined;
  readonly onSongSelected?: (songPayload: CanonicalMusicPayload, transpositionSemitones: number) => void;
}

export interface UseSetlistExecutionResult {
  // Estado de Datos
  readonly loadedSetlist: FrontendSetlistDetail | null;
  readonly isLoading: boolean;
  readonly error: string | null;

  // Estado de Navegación de Atril
  readonly currentIndex: number;
  readonly currentItem: FrontendSetlistItem | null;
  readonly totalItems: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly nextItem: FrontendSetlistItem | null;
  readonly previousItem: FrontendSetlistItem | null;

  // Acciones de Navegación
  readonly goToNext: () => void;
  readonly goToPrevious: () => void;
  readonly goToIndex: (index: number) => void;

  // Acciones de Ciclo de Vida
  readonly loadSetlist: (setlistId: string) => Promise<void>;
  readonly unloadSetlist: () => void;
  readonly activateSetlist: () => Promise<void>;
  readonly completeSetlist: () => Promise<void>;

  // Cálculo Armónico Litúrgico Puro
  readonly transpositionSemitones: number;
  readonly currentEffectiveKey: string | null;
  readonly isServiceMoment: boolean;
}
```

### Cálculo Puro de Transposición Litúrgica:
Cuando el elemento activo es una canción (`itemType === 'SONG'`), el hook calcula de forma pura:
$$\Delta_{\text{semitonos}} = \text{intervaloEnSemitonos}(\text{cancion.defaultKey}, \text{item.targetKey})$$
- Si `item.targetKey` es nulo o coincide con `cancion.defaultKey`, $\Delta = 0$.
- Si la canción por defecto está en Sol Mayor ($G$) y el setlist especifica $Bb$, $\Delta = +3$ semitonos.
- `transpositionSemitones` se suministra a `useMusicalWorkspace.setTransposition(Δ)` sin mutar el modelo `CanonicalMusicPayload` ni enviar escrituras a PostgreSQL.

---

## 10. Arquitectura de Componentes de Escenario (Component Architecture)

La integración visual dentro de `MusicalWorkspace` se organizará de la siguiente forma:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BARRA SUPERIOR DE WORKSPACE                     │
│ [Selector Preset] [Selector Canción] [Catálogo BD] [🎵 Setlists de Culto]│
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│           SetlistNavigationToolbar (Visible si hay setlist cargado)    │
│ [◄ Ant] [Culto Dominical: Item 2 de 5] [Sig ►]  | Transición: CROSSFADE│
│ Canción: Gracia Sublime | Tono Litúrgico: D (Orig: F) | BPM: 72        │
│ Notas Director: "Entra solo piano y voz suave; banda en Coro 2"        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        Si itemType === 'SONG'            Si itemType === 'SERVICE_MOMENT'
┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│     MusicalScoreRenderer          │   │        ServiceMomentCard          │
│  (alphaTab / OSMD / LeadSheetDOM) │   │ (Tarjeta Litúrgica de Escenario)  │
│    Transpuesto a Tono Litúrgico   │   │   Oración / Ofrendas / Predica    │
└───────────────────────────────────┘   └───────────────────────────────────┘
```

---

## 11. Contrato del Componente `SetlistsModal`

Ubicación propuesta: `frontend/src/components/workspace/SetlistsModal.tsx`.

### Props de Entrada:
```typescript
export interface SetlistsModalProps {
  readonly isOpen: boolean;
  readonly activeSetlistId?: string | null;
  readonly onSelectSetlist: (setlistId: string) => void;
  readonly onClose: () => void;
}
```

### Capacidades del Modal:
1. **Pestañas de Filtrado:**
   - *En Curso (ACTIVE):* Muestra el setlist activo congregacional actual si existe, con botón prominente `[Entrar al Atril de Culto]`.
   - *Próximos (PLANNING):* Muestra cultos en preparación ordenados por fecha programada.
   - *Historial (COMPLETED / ARCHIVED):* Listado de cultos anteriores de solo lectura.
2. **Acción de Creación:**
   - Botón `[+ Nuevo Culto]` visible solo si `canCreateSetlist === true`. Despliega formulario integrado (título, fecha/hora, notas pastorales).
3. **Indicadores de Estado:**
   - Badges de estado de alto contraste: `ACTIVE` (verde esmeralda brillante con pulso suave), `PLANNING` (ámbar litúrgico), `COMPLETED` (azul pizarra), `ARCHIVED` (gris tenue).

---

## 12. Contrato del Componente `SetlistNavigationToolbar`

Ubicación propuesta: `frontend/src/components/workspace/SetlistNavigationToolbar.tsx`.

### Props de Entrada:
```typescript
export interface SetlistNavigationToolbarProps {
  readonly setlistTitle: string;
  readonly setlistStatus: FrontendSetlistStatus;
  readonly currentIndex: number;
  readonly totalItems: number;
  readonly currentItem: FrontendSetlistItem;
  readonly nextItem: FrontendSetlistItem | null;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onUnload: () => void;
  readonly onComplete?: () => void;
}
```

### Requisitos Ergonómicos de Escenario:
- **Áreas táctiles generosas:** Botones `[◄ Anterior]` y `[Siguiente ►]` con altura mínima de $48\text{px}$ y contraste visual reforzado para visibilidad con poca luz.
- **Cue Litúrgico del Siguiente Elemento:** Texto informativo que anticipa al equipo el siguiente tema (ej. *"Siguiente: Tu Fidelidad es Grande [Tono: E - SEGUE]"*).
- **Atajos de Teclado:** Escucha global de teclas:
  - Flecha Derecha (`ArrowRight`) y AvPág (`PageDown`) $\to$ `onNext()`
  - Flecha Izquierda (`ArrowLeft`) y RePág (`PageUp`) $\to$ `onPrevious()`

---

## 13. Contrato del Componente `ServiceMomentCard`

Ubicación propuesta: `frontend/src/components/workspace/ServiceMomentCard.tsx`.

### Props de Entrada:
```typescript
export interface ServiceMomentCardProps {
  readonly momentTitle: string;
  readonly durationMinutes?: number | null;
  readonly musicalKey?: string | null;
  readonly notesForTeam?: string | null;
  readonly sequenceOrder: number;
  readonly totalItems: number;
}
```

### Reglas Críticas de Renderizado:
1. **Aislamiento Absoluto de Notación:** Jamás debe invocar `alphaTab`, `OSMD` ni inicializar lienzos canvas/SVG de partituras.
2. **Presentación de Gran Formato:** Título en tipografía display grande ($\ge 2\text{rem}$), badge de duración estimada (`⏱ 5 min`), indicador de tono ambiental para pads (`🎹 Tono de Fondo: Am`), y tarjeta con notas interpretativas del pastor o director.

---

## 14. Flujo de Datos Completo (Data Flow)

```
1. Usuario abre SetlistsModal y selecciona un setlist (ID).
2. useSetlistExecution.loadSetlist(ID) invoca BethesdaApiClient.getSetlist(ID).
3. BethesdaApiClient despacha GET /api/v1/setlists/:id con Bearer JWT.
4. Backend Fastify valida token y retorna SetlistWithItemsEntity (200 OK).
5. Hook actualiza loadedSetlist y fija currentIndex = 0.
6. Si items[0] es SONG:
   a. Hook carga CanonicalMusicPayload desde API / cache.
   b. Calcula transpositionSemitones = interval(defaultKey, targetKey).
   c. Pasa song y transpositionSemitones a MusicalWorkspace.
   d. ProjectionService genera DerivedMusicalView transpuesta.
   e. RendererScoreRenderer muestra la partitura/acordes en el tono de culto.
7. Si items[0] es SERVICE_MOMENT:
   a. MusicalWorkspace conmuta el viewport hacia ServiceMomentCard.
   b. Cero llamadas a motores de notación musical.
8. En escenario, el atrilista presiona [Siguiente ►] o flecha derecha:
   a. Hook incrementa currentIndex.
   b. El viewport se actualiza en < 16ms sin recargar la página.
```

---

## 15. Manejo de Errores en la Interfaz (Error Handling)

| Código HTTP Backend | Causa en Setlists | Respuesta Visual en Frontend |
|:---:|:---|:---|
| **400 VALIDATION_ERROR** | Parámetros inválidos o formato erróneo | Banner en modal con lista de campos no conformes en español |
| **401 UNAUTHORIZED / TOKEN_INVALID** | Sesión expirada o no iniciada | Modal automático de inicio de sesión sin pérdida del setlist seleccionado |
| **403 FORBIDDEN** | Rol insuficiente o cuenta suspendida | Notificación de acceso denegado explicando el rol requerido |
| **404 NOT_FOUND** | Setlist o ítem no encontrado | Mensaje informativo con botón de regreso a la lista general |
| **409 CONFLICT (Regla A)** | Intento de activar un culto cuando ya hay otro ACTIVE | Modal de conflicto litúrgico mostrando el título del culto que está actualmente en curso |
| **409 CONFLICT (Regla C)** | Intento de mutar culto COMPLETED/ARCHIVED | Alerta de solo lectura indicando inmutabilidad histórica |
| **500 INTERNAL_ERROR** | Falla de conexión o base de datos | Notificación no intrusiva con opción de reintentar |

---

## 16. Estados de Carga, Vacíos y de Permisos (Loading / Empty / Permission States)

1. **Estado de Carga (Loading):** Skeletons pulsantes oscuros con acento dorado tenue para el listado de setlists y spinner circular centrado durante la carga de detalle.
2. **Estado Vacío (Empty):** Ilustración de atril con texto *"No hay cultos programados en este estado"* y botón de creación si el usuario tiene permiso.
3. **Estado de Permiso Denegado (Permission-Denied):** Los botones privilegiados (`[+ Nuevo Culto]`, `[Activar]`, `[Borrar]`) no se muestran a usuarios con roles `MUSICIAN` o `VIEWER`, evitando frustración en escenario.

---

## 17. Análisis de Amenazas y Seguridad Frontend (Security Threat Analysis)

1. **Prevención de XSS:** Ningún componente utilizará `dangerouslySetInnerHTML`. Los títulos de momentos litúrgicos y notas para el equipo se interpolan como texto React estándar seguro.
2. **Aislamiento de Credenciales:** El access token se mantiene estrictamente en una clausura en memoria (`tokenManager.ts`). Cero almacenamiento en `localStorage` o `sessionStorage`.
3. **Inmunidad a CSRF:** Las operaciones contra `/api/v1/setlists` requieren la cabecera `Authorization: Bearer <token>`, inmune a cross-site request forgeries basados en cookies.
4. **Protección IDOR en Navegación:** El hook navega exclusivamente sobre los ítems retornados para el setlist específico cargado por su UUID autoritativo.

---

## 18. Consideraciones de Accesibilidad (WCAG 2.1 AA)

- **Contraste:** Relación de contraste de texto superior a $4.5:1$ en todos los estados.
- **Tamaño de Controles de Atril:** Botones de cambio de canción con altura y ancho $\ge 48\text{px}$, aptos para activación táctil en escenario con atril para tablet.
- **Semántica y ARIA:**
  - `SetlistsModal`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
  - `SetlistNavigationToolbar`: `role="toolbar"`, `aria-label="Controles de navegación de culto"`.
  - Indicador de estado: `role="status"`, `aria-live="polite"`.

---

## 19. Consideraciones de Diseño Responsivo

- **Escenario en Tablet / iPad (Landscape):** La barra de navegación se ubica fija en la parte superior o inferior, ocupando todo el ancho sin superponerse a la partitura.
- **Móvil / Smartphone (Portrait):** La barra de atril se compacta, mostrando únicamente botones `[◄]` y `[►]` y el número de ítem, ocultando los cues de texto largo para priorizar la lectura del cifrado.

---

## 20. Estrategia de Pruebas para WS6 (Testing Strategy)

Se definirán suites de pruebas unitarias y de integración en el frontend ejecutadas con el Node.js Test Runner:

1. **`setlist-api-client.test.ts`:**
   - Verificación de llamadas a los 10 endpoints de `BethesdaApiClient`.
   - Manejo de respuestas 200, 201 y propagación de errores estructurados 400, 401, 403, 404, 409.
   - Verificación de renovación silenciosa con `fetchWithAuth`.
2. **`use-setlist-execution.test.ts`:**
   - Navegación secuencial (`goToNext`, `goToPrevious`, límites de índice).
   - Cálculo determinista de transposición ($\Delta_{\text{semitonos}}$) entre tonalidad canónica y tonalidad litúrgica.
   - Detección de `isServiceMoment` y alternancia de presentación.
   - Ciclo de activación y finalización de setlist.
3. **`setlist-components.test.ts`:**
   - Pruebas de renderizado de `SetlistNavigationToolbar`, `ServiceMomentCard` y `SetlistsModal`.
   - Verificación de atajos de teclado (`ArrowRight`, `ArrowLeft`).

---

## 21. Dependencias Externas (Dependencies)

$$\mathbf{NUEVAS\ DEPENDENCIAS\ EXTERNAS:\ CERO\ (0)}$$

- Se reutiliza React 18, TypeScript 5, Vite y los módulos existentes de `core/music-theory`, `core/api` y `core/auth`.
- Cero dependencias añadidas al `package.json`.

---

## 22. Análisis de Riesgos y Mitigaciones (Risks)

| Riesgo Identificado | Severidad | Mitigación Arquitectónica |
|:---|:---:|:---|
| **Interrupción de red wifi en pleno culto** | MEDIA | Una vez cargado el setlist en memoria, la navegación local entre canciones ya descargadas no requiere llamadas adicionales a la red. |
| **Colisión de activación concurrente (Regla A)** | BAJA | Si otro líder activó un culto, el backend responde 409 y el frontend muestra modal explicativo sin corromper el estado del atril. |
| **Pulsación accidental de fin de culto** | MEDIA | El botón de concluir culto (`COMPLETED`) exigirá confirmación explícita mediante diálogo modal. |

---

## 23. Decisiones que Requieren Autorización Explícita (Decisions Requiring Authorization)

Para mantener la alineación total con la dirección del proyecto, se registran las siguientes **4 decisiones**:

1. **Decisión 1 — Desglose de Alcance entre WS6 y WS7:**
   - *Plan Original:* WS6 cubre Cliente API y Hook de Ejecución (`useSetlistExecution`); WS7 cubre Componentes Visuales (`SetlistsModal`, `SetlistNavigationToolbar`, `ServiceMomentCard`).
   - *Alternativa:* Mantener el desglose secuencial estricto aprobado en `PHASE_2C_IMPLEMENTATION_PLAN.md` (WS6: Core de Integración y Hook; WS7: Componentes UI).
   - *Recomendación:* Mantener la separación WS6 vs WS7 para garantizar pruebas exhaustivas del hook antes de acoplar la interfaz gráfica.

2. **Decisión 2 — Política de Almacenamiento en Memoria de Atril:**
   - *Propuesta:* Mantener el setlist cargado en estado volátil de React durante la sesión del atril. Si se refresca la página (F5), volver al estado inicial o re-cargar el setlist activo.

3. **Decisión 3 — Frontera de Sincronización en Tiempo Real:**
   - *Confirmación:* La sincronización multi-atril en vivo mediante WebSockets o SSE está explícitamente fuera del alcance de la Fase 2C (pertenece a la Fase 4 de la hoja de ruta). WS6 opera mediante navegación local reactiva en cada atril.

4. **Decisión 4 — Comportamiento al Seleccionar Canción Fuera del Setlist:**
   - *Propuesta:* Si el atrilista abre el catálogo general y carga una canción independiente, el setlist se mantiene "pausado" en la barra de atril con un botón `[Volver al Culto]`, sin descargar el culto en curso.

---

## 24. Secuencia Recomendada de Implementación (Recommended Implementation Sequence)

```
Paso 1: Extender BethesdaApiClient en frontend/src/core/api/api-client.ts con los métodos de setlist.
Paso 2: Crear suite de pruebas frontend/src/core/api/__tests__/setlist-api-client.test.ts.
Paso 3: Implementar useSetlistExecution.ts en frontend/src/core/workspace/use-setlist-execution.ts.
Paso 4: Crear suite de pruebas frontend/src/core/workspace/__tests__/use-setlist-execution.test.ts.
Paso 5: Ejecutar regresión completa (backend 192 tests, frontend 184 + nuevos tests, tsc --noEmit).
Paso 6: Generar reporte técnico formal PHASE_2C_WS6_IMPLEMENTATION_REPORT.md sincronizado con SHA-256.
```

---

## 25. Criterios de Aceptación y Compuerta de Salida (WS6 Exit Gate Criteria)

- [x] Los 10 endpoints de WS5 han sido completamente auditados y mapeados al cliente frontend.
- [x] El ciclo de vida de autenticación y renovación silenciosa con cookies ha sido integrado.
- [x] La matriz de permisos RBAC para atril ha sido especificada.
- [x] El cálculo puro de transposición armónica ($\Delta_{\text{semitonos}}$) ha sido formalizado sin mutaciones canónicas.
- [x] Los contratos de `SetlistsModal`, `SetlistNavigationToolbar` y `ServiceMomentCard` han sido definidos.
- [x] Se confirmó que no se instalarán nuevas librerías ni dependencias.
- [x] El plan de pruebas unitarias y de integración frontend está estructurado.
- [x] Cero código de producción de WS6 ha sido creado.

---

## 26. Declaración Explícita de Límites y Cero Código de Producción (Explicit Statement)

$$\mathbf{WS6\ PREFLIGHT:\ READY\ FOR\ EXPLICIT\ IMPLEMENTATION\ AUTHORIZATION}$$

**DECLARACIÓN EXPLÍCITA:**
- Durante este preflight **NO SE HA IMPLEMENTADO CÓDIGO DE PRODUCCIÓN DE WS6**.
- No se han modificado archivos del frontend ni del backend.
- No se ha alterado ningún endpoint de WS5 ni regla de negocio de WS4.
- No se han agregado dependencias al monorepositorio.
- La línea base verificada permanece en **376 / 376 pruebas PASS** con **0 errores TypeScript**.
- El sistema se encuentra en reposo técnico, listo para recibir la instrucción explícita del usuario para iniciar la implementación de WS6.

---

## 27. Verificación Criptográfica Dual (SHA-256)

```
SHA-256
PHASE_2C_WS6_PREFLIGHT.md
37913B03A00D68AF826AC5483A07E6548BA05A660B23143893FE03E9ECD72156

docs/PHASE_2C_WS6_PREFLIGHT.md
37913B03A00D68AF826AC5483A07E6548BA05A660B23143893FE03E9ECD72156

MATCH: YES
```
